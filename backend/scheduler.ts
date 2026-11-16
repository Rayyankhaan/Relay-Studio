import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {
  FIXED_SHORT_DESCRIPTION,
  FIXED_SHORT_HASHTAGS,
  FIXED_SHORT_TITLE,
  MAX_VIDEO_FILE_BYTES,
} from '../config/constants.ts';
import {
  appendActivityLog,
  findVideoBySha256,
  getSettings,
  getVideoById,
  listVideos,
  removeVideoRecord,
  upsertVideo,
} from '../database/db.ts';
import type { VideoRecord } from '../src/types.ts';
import {
  computeFileSha256,
  ensureShortsFolders,
  getShortsStageDir,
  getThumbnailsDir,
  isAllowedVideoExtension,
  locateVideoFile,
  moveVideoBetweenStages,
  safeFilePathInStage,
  writeOperationalLogLine,
} from './folders.ts';
import { validateVideoAndGenerateThumbnail } from './validator.ts';
import { resolveEffectiveAccessToken, uploadVideoFileToYouTube } from './youtube.ts';

const activeUploads = new Set<string>();
let tickRunning = false;

function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = dtf.formatToParts(date);
  const map: Record<string, number> = {};
  for (const p of parts) {
    if (p.type !== 'literal') {
      map[p.type] = Number(p.value);
    }
  }
  const hour = map.hour === 24 ? 0 : map.hour;
  const asUtc = Date.UTC(
    map.year,
    (map.month || 1) - 1,
    map.day || 1,
    hour || 0,
    map.minute || 0,
    map.second || 0
  );
  return asUtc - date.getTime();
}

function zonedLocalToUtcDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string
): Date {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const offset1 = getTimeZoneOffsetMs(utcGuess, timeZone);
  const adjusted = new Date(utcGuess.getTime() - offset1);
  const offset2 = getTimeZoneOffsetMs(adjusted, timeZone);
  return offset1 === offset2 ? adjusted : new Date(utcGuess.getTime() - offset2);
}

function getDatePartsInTimeZone(date: Date, timeZone: string): {
  year: number;
  month: number;
  day: number;
} {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const map: Record<string, number> = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = Number(p.value);
  }
  return {
    year: map.year,
    month: map.month,
    day: map.day,
  };
}

export function computeNextAvailableSlot(existingVideos: VideoRecord[]): string {
  const settings = getSettings();
  const tz = settings.timezone || 'America/New_York';
  const slots =
    settings.postingSlots.length > 0
      ? settings.postingSlots.slice(0, Math.max(1, settings.postsPerDay))
      : ['09:00', '12:00', '15:00', '18:00', '21:00'];

  const takenBuckets = new Set<string>();
  for (const v of existingVideos) {
    if (v.scheduledAt && (v.folderStage === 'scheduled' || v.folderStage === 'published')) {
      const d = new Date(v.scheduledAt);
      if (!Number.isNaN(d.getTime())) {
        // Round to minute key
        takenBuckets.add(d.toISOString().slice(0, 16));
      }
    }
  }

  const now = new Date();
  const baseParts = getDatePartsInTimeZone(now, tz);

  for (let dayOffset = 0; dayOffset < 60; dayOffset++) {
    const refUtc = new Date(Date.UTC(baseParts.year, baseParts.month - 1, baseParts.day + dayOffset, 12, 0, 0));
    const y = refUtc.getUTCFullYear();
    const m = refUtc.getUTCMonth() + 1;
    const d = refUtc.getUTCDate();

    for (const slotStr of slots) {
      const [hhRaw, mmRaw] = slotStr.split(':');
      const hh = Math.min(23, Math.max(0, Number(hhRaw) || 9));
      const mm = Math.min(59, Math.max(0, Number(mmRaw) || 0));
      const candidate = zonedLocalToUtcDate(y, m, d, hh, mm, tz);
      if (candidate.getTime() <= now.getTime() + 60_000) continue;
      const key = candidate.toISOString().slice(0, 16);
      if (!takenBuckets.has(key)) {
        return candidate.toISOString();
      }
    }
  }

  return new Date(Date.now() + 3600_000).toISOString();
}

export async function ingestVideoFromPath(params: {
  sourcePath: string;
  originalFileName: string;
  removeSourceIfDuplicate?: boolean;
}): Promise<{ duplicate: boolean; video: VideoRecord }> {
  await ensureShortsFolders();

  if (!isAllowedVideoExtension(params.originalFileName)) {
    throw new Error(
      `Unsupported video format for "${params.originalFileName}". Allowed formats: MP4, MOV, WebM.`
    );
  }

  const stat = await fsp.stat(params.sourcePath);
  if (stat.size <= 0) {
    throw new Error(`Uploaded file "${params.originalFileName}" is empty (0 bytes).`);
  }
  if (stat.size > MAX_VIDEO_FILE_BYTES) {
    throw new Error(
      `File "${params.originalFileName}" exceeds 250 MB upload limit.`
    );
  }

  const sha256 = await computeFileSha256(params.sourcePath);
  const existing = findVideoBySha256(sha256);
  if (existing) {
    if (params.removeSourceIfDuplicate) {
      await fsp.unlink(params.sourcePath).catch(() => {});
    }
    appendActivityLog({
      videoId: existing.id,
      stage: 'duplicate',
      message: `Duplicate upload skipped for "${params.originalFileName}" (matches ${existing.originalFileName}).`,
      level: 'warning',
    });
    return { duplicate: true, video: existing };
  }

  const id = `vid_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const ext = path.extname(params.originalFileName).toLowerCase() || '.mp4';
  const safeStem = path
    .basename(params.originalFileName, ext)
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48) || 'short';
  const storedFileName = `${id}_${safeStem}${ext}`;

  // Move to processing
  const processingDest = safeFilePathInStage('processing', storedFileName);
  if (path.resolve(params.sourcePath) !== path.resolve(processingDest)) {
    try {
      await fsp.rename(params.sourcePath, processingDest);
    } catch {
      await fsp.copyFile(params.sourcePath, processingDest);
      await fsp.unlink(params.sourcePath).catch(() => {});
    }
  }

  const { validation, hasThumbnail } = await validateVideoAndGenerateThumbnail(
    processingDest,
    id
  );

  // Move to scheduled
  await moveVideoBetweenStages(storedFileName, 'processing', 'scheduled');

  const existingAll = listVideos();
  const scheduledAt = computeNextAvailableSlot(existingAll);

  const record: VideoRecord = {
    id,
    originalFileName: params.originalFileName,
    storedFileName,
    sha256,
    fileSizeBytes: stat.size,
    folderStage: 'scheduled',
    hasLocalFile: true,
    hasThumbnail,
    fixedTitle: FIXED_SHORT_TITLE,
    fixedDescription: FIXED_SHORT_DESCRIPTION,
    fixedHashtags: [...FIXED_SHORT_HASHTAGS],
    validation,
    aiAnalysis: null,
    scheduledAt,
    youtubeVideoId: null,
    youtubeUrl: null,
    youtubePrivacy: 'private',
    youtubeScheduledPublishAt: null,
    views: null,
    likes: null,
    comments: null,
    lastError: null,
    retryCount: 0,
    createdAt: new Date().toISOString(),
    publishedAt: null,
  };

  upsertVideo(record);
  appendActivityLog({
    videoId: record.id,
    stage: 'ingest',
    message: `Imported "${record.originalFileName}" -> shorts/scheduled/ for ${new Date(scheduledAt).toLocaleString('en-US', { timeZone: getSettings().timezone })} (${record.validation.aspectRatio}, ${record.validation.durationSec ?? '?'}s).`,
    level: 'success',
  });
  await writeOperationalLogLine(
    `Ingested ${record.id} (${record.originalFileName}) scheduledAt=${scheduledAt}`
  );

  return { duplicate: false, video: record };
}

export async function registerClientOnlyVideo(params: {
  originalFileName: string;
  fileSizeBytes: number;
  sha256: string;
}): Promise<{ duplicate: boolean; video: VideoRecord }> {
  const existing = findVideoBySha256(params.sha256);
  if (existing) {
    return { duplicate: true, video: existing };
  }

  const id = `vid_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const scheduledAt = computeNextAvailableSlot(listVideos());

  const record: VideoRecord = {
    id,
    originalFileName: params.originalFileName,
    storedFileName: params.originalFileName,
    sha256: params.sha256,
    fileSizeBytes: params.fileSizeBytes,
    folderStage: 'scheduled',
    hasLocalFile: false,
    hasThumbnail: false,
    fixedTitle: FIXED_SHORT_TITLE,
    fixedDescription: FIXED_SHORT_DESCRIPTION,
    fixedHashtags: [...FIXED_SHORT_HASHTAGS],
    validation: {
      status: 'ffprobe_unavailable',
      width: null,
      height: null,
      aspectRatio: 'Browser Direct',
      isVertical9x16: true,
      durationSec: null,
      fps: null,
      hasAudio: null,
      formatName: path.extname(params.originalFileName).replace('.', '').toUpperCase() || 'MP4',
      videoCodec: 'Browser Blob',
      notes: ['Large video cached in browser IndexedDB for direct resumable YouTube upload.'],
    },
    aiAnalysis: null,
    scheduledAt,
    youtubeVideoId: null,
    youtubeUrl: null,
    youtubePrivacy: 'private',
    youtubeScheduledPublishAt: null,
    views: null,
    likes: null,
    comments: null,
    lastError: null,
    retryCount: 0,
    createdAt: new Date().toISOString(),
    publishedAt: null,
  };

  upsertVideo(record);
  appendActivityLog({
    videoId: record.id,
    stage: 'ingest',
    message: `Registered browser-cached video "${record.originalFileName}" for direct YouTube resumable upload.`,
    level: 'info',
  });
  return { duplicate: false, video: record };
}

export async function scanIncomingFolder(): Promise<{
  imported: number;
  duplicates: number;
  errors: string[];
}> {
  await ensureShortsFolders();
  const incomingDir = getShortsStageDir('incoming');
  const entries = await fsp.readdir(incomingDir, { withFileTypes: true }).catch(() => []);
  let imported = 0;
  let duplicates = 0;
  const errors: string[] = [];

  const knownFiles = new Set(listVideos().map((v) => v.storedFileName));
  const nowMs = Date.now();

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (entry.name.startsWith('.tmp_')) continue;
    if (!isAllowedVideoExtension(entry.name)) continue;
    if (knownFiles.has(entry.name)) continue;

    const fullPath = path.join(incomingDir, entry.name);
    try {
      const stat = await fsp.stat(fullPath);
      // Avoid picking up files actively being written in Windows/macOS explorer
      if (nowMs - stat.mtimeMs < 1500) continue;

      const res = await ingestVideoFromPath({
        sourcePath: fullPath,
        originalFileName: entry.name,
        removeSourceIfDuplicate: true,
      });
      if (res.duplicate) duplicates++;
      else imported++;
    } catch (err) {
      errors.push(`${entry.name}: ${err instanceof Error ? err.message : 'Scan failed'}`);
    }
  }

  return { imported, duplicates, errors };
}

export async function publishVideoToYouTube(params: {
  videoId: string;
  accessToken: string;
  useScheduledPublishAt?: boolean;
  privacyOverride?: 'private' | 'public' | 'unlisted';
}): Promise<VideoRecord> {
  if (activeUploads.has(params.videoId)) {
    throw new Error('This video is already being uploaded to YouTube.');
  }

  const video = getVideoById(params.videoId);
  if (!video) {
    throw new Error('Video record not found.');
  }
  if (video.youtubeVideoId && video.folderStage === 'published') {
    throw new Error(`Duplicate publish blocked: already published at ${video.youtubeUrl}`);
  }

  const filePath = locateVideoFile(video.storedFileName, video.folderStage);
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error(
      'Local video file is missing on server disk. If running on serverless/Vercel, upload via browser direct YouTube upload.'
    );
  }

  activeUploads.add(params.videoId);
  const settings = getSettings();

  try {
    const ext = path.extname(filePath).toLowerCase();
    const mimeType =
      ext === '.mov' ? 'video/quicktime' : ext === '.webm' ? 'video/webm' : 'video/mp4';

    const requestedPrivacy =
      params.privacyOverride ??
      (settings.youtubePrivacyMode === 'scheduled_private'
        ? 'private'
        : settings.youtubePrivacyMode);

    const publishAtIso =
      params.useScheduledPublishAt &&
      settings.youtubePrivacyMode === 'scheduled_private' &&
      video.scheduledAt &&
      new Date(video.scheduledAt).getTime() > Date.now() + 60_000
        ? video.scheduledAt
        : null;

    const uploaded = await uploadVideoFileToYouTube({
      accessToken: params.accessToken,
      filePath,
      mimeType,
      privacyStatus: requestedPrivacy,
      publishAtIso,
    });

    await moveVideoBetweenStages(video.storedFileName, video.folderStage, 'published');

    const updated: VideoRecord = {
      ...video,
      folderStage: 'published',
      fixedTitle: FIXED_SHORT_TITLE,
      fixedDescription: FIXED_SHORT_DESCRIPTION,
      fixedHashtags: [...FIXED_SHORT_HASHTAGS],
      youtubeVideoId: uploaded.youtubeVideoId,
      youtubeUrl: uploaded.youtubeUrl,
      youtubePrivacy: uploaded.privacyApplied,
      youtubeScheduledPublishAt: publishAtIso,
      publishedAt: new Date().toISOString(),
      lastError: null,
    };

    upsertVideo(updated);
    appendActivityLog({
      videoId: updated.id,
      stage: 'publish',
      message: `Published "${updated.originalFileName}" -> ${updated.youtubeUrl} (${updated.youtubePrivacy}).`,
      level: 'success',
    });
    await writeOperationalLogLine(
      `Published ${updated.id} -> ${updated.youtubeUrl}`
    );

    return updated;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'YouTube upload failed.';
    await moveVideoBetweenStages(video.storedFileName, video.folderStage, 'failed');
    const failed: VideoRecord = {
      ...video,
      folderStage: 'failed',
      retryCount: video.retryCount + 1,
      lastError: message,
    };
    upsertVideo(failed);
    appendActivityLog({
      videoId: failed.id,
      stage: 'publish_error',
      message: `Upload failed for "${failed.originalFileName}": ${message}`,
      level: 'error',
    });
    await writeOperationalLogLine(`Failed ${failed.id}: ${message}`);
    throw new Error(message);
  } finally {
    activeUploads.delete(params.videoId);
  }
}

export async function markClientDirectPublishResult(params: {
  videoId: string;
  youtubeVideoId?: string;
  youtubeUrl?: string;
  privacyStatus?: 'private' | 'public' | 'unlisted';
  errorMessage?: string;
}): Promise<VideoRecord> {
  const video = getVideoById(params.videoId);
  if (!video) throw new Error('Video record not found.');

  if (params.errorMessage) {
    const failed: VideoRecord = {
      ...video,
      folderStage: 'failed',
      retryCount: video.retryCount + 1,
      lastError: params.errorMessage,
    };
    upsertVideo(failed);
    appendActivityLog({
      videoId: failed.id,
      stage: 'publish_error',
      message: `Browser direct upload failed for "${failed.originalFileName}": ${params.errorMessage}`,
      level: 'error',
    });
    return failed;
  }

  const updated: VideoRecord = {
    ...video,
    folderStage: 'published',
    youtubeVideoId: params.youtubeVideoId || video.youtubeVideoId,
    youtubeUrl: params.youtubeUrl || video.youtubeUrl,
    youtubePrivacy: params.privacyStatus || 'private',
    publishedAt: new Date().toISOString(),
    lastError: null,
  };
  upsertVideo(updated);
  appendActivityLog({
    videoId: updated.id,
    stage: 'publish',
    message: `Published "${updated.originalFileName}" -> ${updated.youtubeUrl}`,
    level: 'success',
  });
  return updated;
}

export async function retryFailedVideo(videoId: string): Promise<VideoRecord> {
  const video = getVideoById(videoId);
  if (!video) throw new Error('Video not found.');
  await moveVideoBetweenStages(video.storedFileName, video.folderStage, 'scheduled');
  const nextSlot = computeNextAvailableSlot(listVideos());
  const updated: VideoRecord = {
    ...video,
    folderStage: 'scheduled',
    scheduledAt: nextSlot,
    lastError: null,
  };
  upsertVideo(updated);
  appendActivityLog({
    videoId: updated.id,
    stage: 'retry',
    message: `Moved "${updated.originalFileName}" back to scheduled queue for ${new Date(nextSlot).toLocaleString('en-US', { timeZone: getSettings().timezone })}.`,
    level: 'info',
  });
  return updated;
}

export async function deleteQueuedVideo(videoId: string): Promise<void> {
  const video = getVideoById(videoId);
  if (!video) throw new Error('Video not found.');
  if (video.folderStage === 'published') {
    throw new Error('Published videos remain in publishing history and cannot be deleted from queue.');
  }

  const filePath = locateVideoFile(video.storedFileName, video.folderStage);
  if (filePath && fs.existsSync(filePath)) {
    await fsp.unlink(filePath).catch(() => {});
  }
  const thumbPath = path.join(getThumbnailsDir(), `${video.id}.jpg`);
  if (fs.existsSync(thumbPath)) {
    await fsp.unlink(thumbPath).catch(() => {});
  }
  removeVideoRecord(video.id);
  appendActivityLog({
    videoId: video.id,
    stage: 'delete',
    message: `Deleted unpublished video "${video.originalFileName}".`,
    level: 'warning',
  });
}

export async function runSchedulerTick(): Promise<{
  scanned: number;
  attempted: number;
  published: number;
}> {
  if (tickRunning) {
    return { scanned: 0, attempted: 0, published: 0 };
  }
  tickRunning = true;
  let scanned = 0;
  let attempted = 0;
  let published = 0;

  try {
    const settings = getSettings();
    if (settings.enableFolderWatcher) {
      const scanRes = await scanIncomingFolder();
      scanned = scanRes.imported;
    }

    if (settings.schedulerPaused) {
      return { scanned, attempted, published };
    }

    const { token } = await resolveEffectiveAccessToken();
    if (!token) {
      // No server-side refresh token available; scheduled uploads wait for user confirmation or OAuth refresh token
      return { scanned, attempted, published };
    }

    const nowMs = Date.now();
    const dueVideos = listVideos()
      .filter(
        (v) =>
          v.folderStage === 'scheduled' &&
          !v.youtubeVideoId &&
          v.scheduledAt &&
          new Date(v.scheduledAt).getTime() <= nowMs &&
          v.hasLocalFile
      )
      .sort(
        (a, b) =>
          new Date(a.scheduledAt || 0).getTime() - new Date(b.scheduledAt || 0).getTime()
      );

    for (const due of dueVideos) {
      attempted++;
      try {
        await publishVideoToYouTube({
          videoId: due.id,
          accessToken: token,
          useScheduledPublishAt: false,
        });
        published++;
      } catch {
        // Error already recorded on VideoRecord & activity log
      }
    }

    return { scanned, attempted, published };
  } finally {
    tickRunning = false;
  }
}
