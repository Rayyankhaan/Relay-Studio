import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ALLOWED_VIDEO_EXTENSIONS } from '../config/constants.ts';
import type { VideoLifecycleStatus } from '../src/types.ts';

const IS_VERCEL = Boolean(process.env.VERCEL || process.env.VERCEL_ENV);

export function getRootProjectDir(): string {
  return IS_VERCEL ? path.join(os.tmpdir(), 'shortspilot-fs') : process.cwd();
}

export function getShortsStageDir(stage: VideoLifecycleStatus): string {
  return path.join(getRootProjectDir(), 'shorts', stage);
}

export function getThumbnailsDir(): string {
  return path.join(getRootProjectDir(), 'database', 'thumbnails');
}

export function getLogsDir(): string {
  return path.join(getRootProjectDir(), 'logs');
}

export async function ensureShortsFolders(): Promise<void> {
  const stages: VideoLifecycleStatus[] = [
    'incoming',
    'processing',
    'scheduled',
    'published',
    'failed',
  ];
  await Promise.all([
    ...stages.map((s) => fsp.mkdir(getShortsStageDir(s), { recursive: true })),
    fsp.mkdir(getThumbnailsDir(), { recursive: true }),
    fsp.mkdir(getLogsDir(), { recursive: true }),
  ]);
}

export function safeFilePathInStage(
  stage: VideoLifecycleStatus,
  fileName: string
): string {
  const baseDir = path.resolve(getShortsStageDir(stage));
  const cleanName = path.basename(fileName).replace(/[/\\?%*:|"<>]/g, '_');
  const resolved = path.resolve(baseDir, cleanName);
  if (!resolved.startsWith(baseDir + path.sep) && resolved !== baseDir) {
    throw new Error('Invalid file path detected.');
  }
  return resolved;
}

export function isAllowedVideoExtension(fileName: string): boolean {
  const ext = path.extname(fileName).toLowerCase();
  return (ALLOWED_VIDEO_EXTENSIONS as readonly string[]).includes(ext);
}

export async function computeFileSha256(filePath: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

export async function moveVideoBetweenStages(
  fileName: string,
  fromStage: VideoLifecycleStatus,
  toStage: VideoLifecycleStatus
): Promise<string> {
  await ensureShortsFolders();
  const src = safeFilePathInStage(fromStage, fileName);
  const dest = safeFilePathInStage(toStage, fileName);
  if (!fs.existsSync(src)) {
    return dest;
  }
  if (src === dest) return dest;
  try {
    await fsp.rename(src, dest);
  } catch {
    await fsp.copyFile(src, dest);
    await fsp.unlink(src).catch(() => {});
  }
  return dest;
}

export function locateVideoFile(
  storedFileName: string,
  currentStage: VideoLifecycleStatus
): string | null {
  const primary = safeFilePathInStage(currentStage, storedFileName);
  if (fs.existsSync(primary)) return primary;

  const stages: VideoLifecycleStatus[] = [
    'scheduled',
    'incoming',
    'processing',
    'published',
    'failed',
  ];
  for (const s of stages) {
    const candidate = safeFilePathInStage(s, storedFileName);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export async function writeOperationalLogLine(line: string): Promise<void> {
  try {
    await ensureShortsFolders();
    const logFile = path.join(getLogsDir(), 'shortspilot.log');
    await fsp.appendFile(logFile, `[${new Date().toISOString()}] ${line}\n`, 'utf8');
  } catch {
    // Do not crash request flow on log append error
  }
}
