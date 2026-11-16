import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import {
  DEFAULT_POSTING_SLOTS_EST,
  TARGET_AUDIENCE_COUNTRIES,
} from '../config/constants.js';
import type {
  ActivityLogEntry,
  SchedulerSettings,
  TrendingAudioItem,
  VideoRecord,
} from '../src/types.js';

const require = createRequire(import.meta.url);
const IS_VERCEL = Boolean(process.env.VERCEL || process.env.VERCEL_ENV);

function getDbBaseDir(): string {
  return IS_VERCEL
    ? path.join(os.tmpdir(), 'shortspilot-db')
    : path.resolve(process.cwd(), 'database');
}

function getEncryptionKey(): Buffer {
  const secret =
    process.env.TOKEN_ENCRYPTION_SECRET ||
    process.env.GOOGLE_CLIENT_SECRET ||
    'shortspilot-xavier-memes-local-dev-key';
  return crypto.createHash('sha256').update(secret).digest();
}

export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptSecret(payload: string): string | null {
  try {
    const [ivHex, tagHex, dataHex] = payload.split(':');
    if (!ivHex || !tagHex || !dataHex) return null;
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      getEncryptionKey(),
      Buffer.from(ivHex, 'hex')
    );
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataHex, 'hex')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch {
    return null;
  }
}

export const DEFAULT_SETTINGS: SchedulerSettings = {
  schedulerPaused: false,
  postsPerDay: 5,
  dailyBatchSize: 5,
  timezone: 'America/New_York',
  postingSlots: [...DEFAULT_POSTING_SLOTS_EST],
  allowAutoCrop9x16: false,
  enableFolderWatcher: true,
  youtubePrivacyMode: 'scheduled_private',
  targetCountries: [...TARGET_AUDIENCE_COUNTRIES],
};

let dbInstance: DatabaseSync | null = null;
let fallbackStorePath: string | null = null;

function initSqlite(): DatabaseSync | null {
  if (dbInstance) return dbInstance;
  try {
    const sqliteModuleId = ['node', 'sqlite'].join(':');
    const sqlite = require(sqliteModuleId) as { DatabaseSync: typeof DatabaseSync };
    const dbDir = getDbBaseDir();
    fs.mkdirSync(dbDir, { recursive: true });
    const dbFile = path.join(dbDir, 'shortspilot.db');
    const db = new sqlite.DatabaseSync(dbFile);

    db.exec(`
      CREATE TABLE IF NOT EXISTS videos (
        id TEXT PRIMARY KEY,
        sha256 TEXT NOT NULL,
        folder_stage TEXT NOT NULL,
        created_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_videos_sha256 ON videos(sha256);
      CREATE INDEX IF NOT EXISTS idx_videos_stage ON videos(folder_stage);

      CREATE TABLE IF NOT EXISTS trending_audio (
        id TEXT PRIMARY KEY,
        researched_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS activity_logs (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        level TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS kv_store (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL
      );
    `);

    dbInstance = db;
    return dbInstance;
  } catch {
    const dbDir = getDbBaseDir();
    fs.mkdirSync(dbDir, { recursive: true });
    fallbackStorePath = path.join(dbDir, 'shortspilot-fallback.json');
    return null;
  }
}

interface FallbackBlob {
  videos: VideoRecord[];
  audios: TrendingAudioItem[];
  logs: ActivityLogEntry[];
  settings: SchedulerSettings;
  kv: Record<string, string>;
}

function readFallback(): FallbackBlob {
  if (!fallbackStorePath) initSqlite();
  if (!fallbackStorePath || !fs.existsSync(fallbackStorePath)) {
    return {
      videos: [],
      audios: [],
      logs: [],
      settings: { ...DEFAULT_SETTINGS },
      kv: {},
    };
  }
  try {
    return JSON.parse(fs.readFileSync(fallbackStorePath, 'utf8')) as FallbackBlob;
  } catch {
    return {
      videos: [],
      audios: [],
      logs: [],
      settings: { ...DEFAULT_SETTINGS },
      kv: {},
    };
  }
}

function writeFallback(data: FallbackBlob): void {
  if (!fallbackStorePath) initSqlite();
  if (!fallbackStorePath) return;
  fs.writeFileSync(fallbackStorePath, JSON.stringify(data, null, 2), 'utf8');
}

export function listVideos(): VideoRecord[] {
  const db = initSqlite();
  if (!db) {
    return readFallback().videos.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }
  const rows = db
    .prepare('SELECT payload_json FROM videos ORDER BY created_at DESC')
    .all();
  return rows.map((r) => JSON.parse(String(r.payload_json)) as VideoRecord);
}

export function getVideoById(id: string): VideoRecord | null {
  const db = initSqlite();
  if (!db) {
    return readFallback().videos.find((v) => v.id === id) ?? null;
  }
  const row = db.prepare('SELECT payload_json FROM videos WHERE id = ?').get(id);
  return row ? (JSON.parse(String(row.payload_json)) as VideoRecord) : null;
}

export function findVideoBySha256(sha256: string): VideoRecord | null {
  const db = initSqlite();
  if (!db) {
    return readFallback().videos.find((v) => v.sha256 === sha256) ?? null;
  }
  const row = db
    .prepare('SELECT payload_json FROM videos WHERE sha256 = ? LIMIT 1')
    .get(sha256);
  return row ? (JSON.parse(String(row.payload_json)) as VideoRecord) : null;
}

export function upsertVideo(video: VideoRecord): void {
  const db = initSqlite();
  if (!db) {
    const data = readFallback();
    const idx = data.videos.findIndex((v) => v.id === video.id);
    if (idx >= 0) data.videos[idx] = video;
    else data.videos.unshift(video);
    writeFallback(data);
    return;
  }
  db.prepare(
    `INSERT INTO videos (id, sha256, folder_stage, created_at, payload_json)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       sha256 = excluded.sha256,
       folder_stage = excluded.folder_stage,
       payload_json = excluded.payload_json`
  ).run(
    video.id,
    video.sha256,
    video.folderStage,
    video.createdAt,
    JSON.stringify(video)
  );
}

export function removeVideoRecord(id: string): void {
  const db = initSqlite();
  if (!db) {
    const data = readFallback();
    data.videos = data.videos.filter((v) => v.id !== id);
    writeFallback(data);
    return;
  }
  db.prepare('DELETE FROM videos WHERE id = ?').run(id);
}

export function listTrendingAudio(): TrendingAudioItem[] {
  const db = initSqlite();
  if (!db) {
    return readFallback().audios;
  }
  const rows = db
    .prepare('SELECT payload_json FROM trending_audio ORDER BY researched_at DESC LIMIT 30')
    .all();
  return rows.map((r) => JSON.parse(String(r.payload_json)) as TrendingAudioItem);
}

export function saveTrendingAudioItems(items: TrendingAudioItem[]): void {
  const db = initSqlite();
  if (!db) {
    const data = readFallback();
    data.audios = [...items, ...data.audios].slice(0, 30);
    writeFallback(data);
    return;
  }
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO trending_audio (id, researched_at, payload_json) VALUES (?, ?, ?)`
  );
  for (const item of items) {
    stmt.run(item.id, item.researchedAt, JSON.stringify(item));
  }
}

export function listActivityLogs(limit = 60): ActivityLogEntry[] {
  const db = initSqlite();
  if (!db) {
    return readFallback().logs.slice(0, limit);
  }
  const rows = db
    .prepare('SELECT payload_json FROM activity_logs ORDER BY timestamp DESC LIMIT ?')
    .all(limit);
  return rows.map((r) => JSON.parse(String(r.payload_json)) as ActivityLogEntry);
}

export function appendActivityLog(entry: Omit<ActivityLogEntry, 'id' | 'timestamp'>): ActivityLogEntry {
  const full: ActivityLogEntry = {
    id: `log_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
    ...entry,
  };
  const db = initSqlite();
  if (!db) {
    const data = readFallback();
    data.logs = [full, ...data.logs].slice(0, 120);
    writeFallback(data);
    return full;
  }
  db.prepare(
    `INSERT INTO activity_logs (id, timestamp, level, payload_json) VALUES (?, ?, ?, ?)`
  ).run(full.id, full.timestamp, full.level, JSON.stringify(full));
  return full;
}

export function getSettings(): SchedulerSettings {
  const db = initSqlite();
  if (!db) {
    return { ...DEFAULT_SETTINGS, ...readFallback().settings };
  }
  const row = db.prepare(`SELECT value_json FROM kv_store WHERE key = 'settings'`).get();
  if (!row) return { ...DEFAULT_SETTINGS };
  return { ...DEFAULT_SETTINGS, ...(JSON.parse(String(row.value_json)) as Partial<SchedulerSettings>) };
}

export function saveSettings(patch: Partial<SchedulerSettings>): SchedulerSettings {
  const merged = { ...getSettings(), ...patch };
  const db = initSqlite();
  if (!db) {
    const data = readFallback();
    data.settings = merged;
    writeFallback(data);
    return merged;
  }
  db.prepare(
    `INSERT INTO kv_store (key, value_json) VALUES ('settings', ?)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`
  ).run(JSON.stringify(merged));
  return merged;
}

export function saveEncryptedRefreshToken(refreshToken: string, channelMeta?: {
  channelId: string;
  channelTitle: string;
  channelHandle: string;
  profileImageUrl: string;
}): void {
  const payload = JSON.stringify({
    encryptedToken: encryptSecret(refreshToken),
    channelMeta: channelMeta ?? null,
    updatedAt: new Date().toISOString(),
  });
  const db = initSqlite();
  if (!db) {
    const data = readFallback();
    data.kv.youtube_oauth = payload;
    writeFallback(data);
    return;
  }
  db.prepare(
    `INSERT INTO kv_store (key, value_json) VALUES ('youtube_oauth', ?)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`
  ).run(payload);
}

export function getStoredRefreshToken(): {
  refreshToken: string | null;
  channelMeta: {
    channelId: string;
    channelTitle: string;
    channelHandle: string;
    profileImageUrl: string;
  } | null;
} {
  let raw: string | null = null;
  const db = initSqlite();
  if (!db) {
    raw = readFallback().kv.youtube_oauth ?? null;
  } else {
    const row = db.prepare(`SELECT value_json FROM kv_store WHERE key = 'youtube_oauth'`).get();
    raw = row ? String(row.value_json) : null;
  }
  if (!raw) return { refreshToken: null, channelMeta: null };
  try {
    const parsed = JSON.parse(raw) as {
      encryptedToken?: string;
      channelMeta?: {
        channelId: string;
        channelTitle: string;
        channelHandle: string;
        profileImageUrl: string;
      } | null;
    };
    const token = parsed.encryptedToken ? decryptSecret(parsed.encryptedToken) : null;
    return { refreshToken: token, channelMeta: parsed.channelMeta ?? null };
  } catch {
    return { refreshToken: null, channelMeta: null };
  }
}

export function clearStoredRefreshToken(): void {
  const db = initSqlite();
  if (!db) {
    const data = readFallback();
    delete data.kv.youtube_oauth;
    writeFallback(data);
    return;
  }
  db.prepare(`DELETE FROM kv_store WHERE key = 'youtube_oauth'`).run();
}
