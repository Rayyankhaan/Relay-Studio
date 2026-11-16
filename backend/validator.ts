import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { VideoValidationMetadata } from '../src/types.js';
import { getThumbnailsDir } from './folders.js';

const execFileAsync = promisify(execFile);

let cachedFfmpegAvailable: boolean | null = null;

export async function checkFfmpegAvailable(): Promise<boolean> {
  if (cachedFfmpegAvailable !== null) return cachedFfmpegAvailable;
  try {
    await execFileAsync('ffprobe', ['-version'], { timeout: 3000 });
    cachedFfmpegAvailable = true;
  } catch {
    cachedFfmpegAvailable = false;
  }
  return cachedFfmpegAvailable;
}

function parseFrameRate(raw?: string): number | null {
  if (!raw) return null;
  const parts = raw.split('/');
  if (parts.length === 2) {
    const num = Number(parts[0]);
    const den = Number(parts[1]);
    if (den > 0 && Number.isFinite(num)) {
      return Number((num / den).toFixed(2));
    }
  }
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Number(n.toFixed(2)) : null;
}

function formatAspectRatio(width: number, height: number): string {
  const ratio = width / height;
  if (Math.abs(ratio - 9 / 16) < 0.06) return '9:16';
  if (Math.abs(ratio - 16 / 9) < 0.06) return '16:9';
  if (Math.abs(ratio - 1) < 0.06) return '1:1';
  if (Math.abs(ratio - 4 / 5) < 0.06) return '4:5';
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const d = gcd(width, height) || 1;
  return `${Math.round(width / d)}:${Math.round(height / d)}`;
}

export async function validateVideoAndGenerateThumbnail(
  videoPath: string,
  videoId: string
): Promise<{ validation: VideoValidationMetadata; hasThumbnail: boolean }> {
  const available = await checkFfmpegAvailable();
  if (!available) {
    return {
      validation: {
        status: 'ffprobe_unavailable',
        width: null,
        height: null,
        aspectRatio: 'Unknown',
        isVertical9x16: false,
        durationSec: null,
        fps: null,
        hasAudio: null,
        formatName: path.extname(videoPath).replace('.', '').toUpperCase() || 'VIDEO',
        videoCodec: 'Unknown',
        notes: ['FFprobe binary not present in runtime; basic file extension validation passed.'],
      },
      hasThumbnail: false,
    };
  }

  try {
    const { stdout } = await execFileAsync(
      'ffprobe',
      [
        '-v',
        'quiet',
        '-print_format',
        'json',
        '-show_format',
        '-show_streams',
        videoPath,
      ],
      { timeout: 15000 }
    );

    const parsed = JSON.parse(stdout) as {
      format?: { format_name?: string; duration?: string };
      streams?: Array<{
        codec_type?: string;
        codec_name?: string;
        width?: number;
        height?: number;
        r_frame_rate?: string;
        avg_frame_rate?: string;
      }>;
    };

    const videoStream = parsed.streams?.find((s) => s.codec_type === 'video');
    const audioStream = parsed.streams?.find((s) => s.codec_type === 'audio');

    if (!videoStream) {
      return {
        validation: {
          status: 'failed',
          width: null,
          height: null,
          aspectRatio: 'None',
          isVertical9x16: false,
          durationSec: null,
          fps: null,
          hasAudio: Boolean(audioStream),
          formatName: parsed.format?.format_name || 'unknown',
          videoCodec: 'none',
          notes: ['No video stream detected inside file.'],
        },
        hasThumbnail: false,
      };
    }

    const width = videoStream.width ?? null;
    const height = videoStream.height ?? null;
    const aspectRatio = width && height ? formatAspectRatio(width, height) : 'Unknown';
    const isVertical9x16 =
      Boolean(width && height && height > width && Math.abs(width / height - 9 / 16) < 0.08);
    const durationSec = parsed.format?.duration
      ? Number(Number(parsed.format.duration).toFixed(1))
      : null;
    const fps =
      parseFrameRate(videoStream.avg_frame_rate) ??
      parseFrameRate(videoStream.r_frame_rate);
    const hasAudio = Boolean(audioStream);

    const notes: string[] = [];
    let status: VideoValidationMetadata['status'] = 'passed';

    if (!isVertical9x16) {
      status = 'warning';
      notes.push(
        `Aspect ratio is ${aspectRatio} (${width}x${height}). YouTube Shorts perform best in 9:16 vertical.`
      );
    }
    if (durationSec !== null && durationSec > 60) {
      status = 'warning';
      notes.push(
        `Duration is ${durationSec}s (exceeds 60s Shorts threshold). Original video kept untouched.`
      );
    }
    if (!hasAudio) {
      status = 'warning';
      notes.push(
        'No audio track detected. Add audio via YouTube Shorts Audio Picker or before upload.'
      );
    }
    if (notes.length === 0) {
      notes.push('Valid 9:16 vertical YouTube Short under 60s with audio stream.');
    }

    // Generate thumbnail frame without modifying original video
    let hasThumbnail = false;
    try {
      const thumbDir = getThumbnailsDir();
      fs.mkdirSync(thumbDir, { recursive: true });
      const thumbPath = path.join(thumbDir, `${videoId}.jpg`);
      const seekSec = durationSec && durationSec > 2 ? '00:00:01' : '00:00:00';
      await execFileAsync(
        'ffmpeg',
        ['-y', '-ss', seekSec, '-i', videoPath, '-vframes', '1', '-q:v', '3', thumbPath],
        { timeout: 15000 }
      );
      hasThumbnail = fs.existsSync(thumbPath);
    } catch {
      hasThumbnail = false;
    }

    return {
      validation: {
        status,
        width,
        height,
        aspectRatio,
        isVertical9x16,
        durationSec,
        fps,
        hasAudio,
        formatName: parsed.format?.format_name || 'mp4',
        videoCodec: videoStream.codec_name || 'unknown',
        notes,
      },
      hasThumbnail,
    };
  } catch (err) {
    return {
      validation: {
        status: 'failed',
        width: null,
        height: null,
        aspectRatio: 'Unknown',
        isVertical9x16: false,
        durationSec: null,
        fps: null,
        hasAudio: null,
        formatName: 'unknown',
        videoCodec: 'unknown',
        notes: [err instanceof Error ? err.message : 'FFprobe failed to inspect video'],
      },
      hasThumbnail: false,
    };
  }
}
