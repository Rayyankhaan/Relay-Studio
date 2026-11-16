import crypto from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import multer from 'multer';
import os from 'node:os';
import path from 'node:path';
import { analyzeMemeVideo, isGeminiConfigured } from '../ai/memeAnalyzer.ts';
import {
  FIXED_SHORT_DESCRIPTION,
  FIXED_SHORT_HASHTAGS,
  FIXED_SHORT_TITLE,
  MAX_VIDEO_FILE_BYTES,
} from '../config/constants.ts';
import {
  appendActivityLog,
  getSettings,
  getVideoById,
  listActivityLogs,
  listTrendingAudio,
  listVideos,
  saveSettings,
  saveTrendingAudioItems,
  upsertVideo,
} from '../database/db.ts';
import type { DashboardSnapshot, SchedulerSettings } from '../src/types.ts';
import { researchTrendingMemeAudio } from './audioResearch.ts';
import {
  ensureShortsFolders,
  getShortsStageDir,
  getThumbnailsDir,
  isAllowedVideoExtension,
  locateVideoFile,
} from './folders.ts';
import {
  deleteQueuedVideo,
  ingestVideoFromPath,
  markClientDirectPublishResult,
  publishVideoToYouTube,
  registerClientOnlyVideo,
  retryFailedVideo,
  runSchedulerTick,
  scanIncomingFolder,
} from './scheduler.ts';
import { checkFfmpegAvailable } from './validator.ts';
import {
  buildServerOAuthUrl,
  disconnectServerYouTubeToken,
  exchangeOAuthCodeForTokens,
  fetchChannelInfoWithToken,
  fetchRealAnalyticsReport,
  getDisconnectedChannelStatus,
  isServerOAuthConfigured,
  resolveEffectiveAccessToken,
  syncPublishedVideosStats,
} from './youtube.ts';

const IS_VERCEL = Boolean(process.env.VERCEL || process.env.VERCEL_ENV);
const SESSION_COOKIE_NAME = 'shortspilot_session';

function getSessionSecret(): string {
  return (
    process.env.TOKEN_ENCRYPTION_SECRET ||
    process.env.DASHBOARD_PASSWORD ||
    'shortspilot-local-session-secret'
  );
}

function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.cookie;
  if (!header) return {};
  const map: Record<string, string> = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) {
      const key = part.slice(0, idx).trim();
      const val = decodeURIComponent(part.slice(idx + 1).trim());
      map[key] = val;
    }
  }
  return map;
}

function signSessionToken(): string {
  const payload = `auth:${Date.now()}`;
  const sig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(payload)
    .digest('hex');
  return `${payload}.${sig}`;
}

function verifySessionToken(token?: string): boolean {
  if (!token) return false;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = crypto
    .createHmac('sha256', getSessionSecret())
    .update(payload)
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

function isAuthenticated(req: Request): boolean {
  const requiredPwd = process.env.DASHBOARD_PASSWORD?.trim();
  if (!requiredPwd) return true;
  const cookies = parseCookies(req);
  return verifySessionToken(cookies[SESSION_COOKIE_NAME]);
}

function requireDashboardAuth(req: Request, res: Response, next: NextFunction): void {
  if (!isAuthenticated(req)) {
    res.status(401).json({ error: 'Dashboard login required.' });
    return;
  }
  next();
}

export function createShortsPilotApp(): express.Express {
  const app = express();
  app.use(express.json({ limit: '4mb' }));

  const upload = multer({
    storage: multer.diskStorage({
      destination: async (_req, _file, cb) => {
        try {
          await ensureShortsFolders();
          cb(null, getShortsStageDir('incoming'));
        } catch (err) {
          cb(err instanceof Error ? err : new Error('Failed to access incoming folder'), os.tmpdir());
        }
      },
      filename: (_req, file, cb) => {
        const clean = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]+/g, '_');
        cb(null, `.tmp_${Date.now()}_${clean}`);
      },
    }),
    limits: {
      fileSize: MAX_VIDEO_FILE_BYTES,
      files: 10,
    },
    fileFilter: (_req, file, cb) => {
      if (!isAllowedVideoExtension(file.originalname)) {
        cb(new Error('Only MP4, MOV, and WebM video files are allowed.'));
        return;
      }
      cb(null, true);
    },
  });

  // Auth endpoints
  app.get('/api/auth/session', (req, res) => {
    const required = Boolean(process.env.DASHBOARD_PASSWORD?.trim());
    res.json({
      authRequired: required,
      authenticated: isAuthenticated(req),
    });
  });

  app.post('/api/auth/login', (req, res) => {
    const requiredPwd = process.env.DASHBOARD_PASSWORD?.trim();
    if (!requiredPwd) {
      res.json({ authenticated: true });
      return;
    }
    const candidate = String((req.body as { password?: string })?.password ?? '');
    if (candidate !== requiredPwd) {
      res.status(401).json({ error: 'Incorrect dashboard password.' });
      return;
    }
    const token = signSessionToken();
    const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
    res.cookie(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: isSecure ? 'none' : 'lax',
      secure: isSecure,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    res.json({ authenticated: true });
  });

  app.post('/api/auth/logout', (req, res) => {
    const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
    res.clearCookie(SESSION_COOKIE_NAME, {
      httpOnly: true,
      sameSite: isSecure ? 'none' : 'lax',
      secure: isSecure,
    });
    res.json({ ok: true });
  });

  // Google Server OAuth Callback (unprotected redirect target)
  app.get('/api/youtube/oauth/callback', async (req, res) => {
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const errParam = typeof req.query.error === 'string' ? req.query.error : '';
    if (errParam) {
      res.redirect(`/?oauth_error=${encodeURIComponent(errParam)}`);
      return;
    }
    if (!code) {
      res.redirect('/?oauth_error=missing_code');
      return;
    }
    try {
      const origin = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
      const redirectUri = `${origin.replace(/\/$/, '')}/api/youtube/oauth/callback`;
      const result = await exchangeOAuthCodeForTokens({ code, redirectUri });
      appendActivityLog({
        videoId: null,
        stage: 'youtube_auth',
        message: `Connected YouTube channel "${result.channel.channelTitle}" with offline refresh token.`,
        level: 'success',
      });
      res.redirect('/?oauth_connected=1');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'OAuth exchange failed';
      res.redirect(`/?oauth_error=${encodeURIComponent(msg)}`);
    }
  });

  // Protect operational API routes when DASHBOARD_PASSWORD is set
  app.use('/api', requireDashboardAuth);

  // Full Dashboard Snapshot
  app.get('/api/snapshot', async (req, res) => {
    try {
      await ensureShortsFolders();
      const bearer = req.headers.authorization;
      let channel = getDisconnectedChannelStatus();

      try {
        const { token, authMode } = await resolveEffectiveAccessToken(bearer);
        if (token) {
          channel = await fetchChannelInfoWithToken(token, authMode);
        }
      } catch (err) {
        channel = getDisconnectedChannelStatus(
          err instanceof Error ? err.message : 'Unable to verify YouTube channel.'
        );
      }

      const snapshot: DashboardSnapshot = {
        videos: listVideos(),
        audios: listTrendingAudio(),
        logs: listActivityLogs(60),
        settings: getSettings(),
        channel,
        fixedMetadata: {
          title: FIXED_SHORT_TITLE,
          description: FIXED_SHORT_DESCRIPTION,
          hashtags: [...FIXED_SHORT_HASHTAGS],
        },
        environment: {
          ffmpegAvailable: await checkFfmpegAvailable(),
          geminiConfigured: isGeminiConfigured(),
          youtubeOAuthConfigured: isServerOAuthConfigured() || true,
          dashboardAuthRequired: Boolean(process.env.DASHBOARD_PASSWORD?.trim()),
          isVercel: IS_VERCEL,
        },
      };

      res.json(snapshot);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to build dashboard snapshot.',
      });
    }
  });

  // Multi-video upload (up to 5+)
  app.post('/api/videos/upload', upload.array('videos', 10), async (req, res) => {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (files.length === 0) {
      res.status(400).json({ error: 'No valid MP4, MOV, or WebM video files received.' });
      return;
    }

    const imported = [];
    const duplicates = [];
    const errors: string[] = [];

    for (const file of files) {
      try {
        const result = await ingestVideoFromPath({
          sourcePath: file.path,
          originalFileName: file.originalname,
          removeSourceIfDuplicate: true,
        });
        if (result.duplicate) {
          duplicates.push(result.video);
        } else {
          imported.push(result.video);
        }
      } catch (err) {
        await fs.promises.unlink(file.path).catch(() => {});
        errors.push(
          `${file.originalname}: ${err instanceof Error ? err.message : 'Upload failed'}`
        );
      }
    }

    res.json({ imported, duplicates, errors });
  });

  // Serverless / Vercel large-file registration fallback
  app.post('/api/videos/register', async (req, res) => {
    try {
      const body = req.body as {
        originalFileName?: string;
        fileSizeBytes?: number;
        sha256?: string;
      };
      if (!body.originalFileName || !body.sha256) {
        res.status(400).json({ error: 'originalFileName and sha256 are required.' });
        return;
      }
      const result = await registerClientOnlyVideo({
        originalFileName: body.originalFileName,
        fileSizeBytes: Number(body.fileSizeBytes) || 0,
        sha256: body.sha256,
      });
      res.json(result);
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Failed to register video.',
      });
    }
  });

  app.post('/api/folder/scan', async (_req, res) => {
    try {
      const result = await scanIncomingFolder();
      res.json(result);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Folder scan failed.',
      });
    }
  });

  // Stream video preview with HTTP Range support
  app.get('/api/videos/:id/stream', (req, res) => {
    const video = getVideoById(req.params.id);
    if (!video) {
      res.status(404).json({ error: 'Video not found.' });
      return;
    }
    const filePath = locateVideoFile(video.storedFileName, video.folderStage);
    if (!filePath || !fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Local video file not found.' });
      return;
    }

    const stat = fs.statSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const contentType =
      ext === '.mov' ? 'video/quicktime' : ext === '.webm' ? 'video/webm' : 'video/mp4';

    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
      const chunkSize = end - start + 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': contentType,
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': stat.size,
        'Content-Type': contentType,
      });
      fs.createReadStream(filePath).pipe(res);
    }
  });

  // Serve extracted JPEG thumbnail
  app.get('/api/videos/:id/thumbnail', (req, res) => {
    const cleanId = path.basename(req.params.id).replace(/[^a-zA-Z0-9_-]/g, '');
    const thumbPath = path.join(getThumbnailsDir(), `${cleanId}.jpg`);
    if (!fs.existsSync(thumbPath)) {
      res.status(404).json({ error: 'Thumbnail not available.' });
      return;
    }
    res.sendFile(thumbPath);
  });

  // Optional AI Meme Analysis
  app.post('/api/videos/:id/analyze', async (req, res) => {
    const video = getVideoById(req.params.id);
    if (!video) {
      res.status(404).json({ error: 'Video not found.' });
      return;
    }
    try {
      const analysis = await analyzeMemeVideo(video);
      const updated = { ...video, aiAnalysis: analysis };
      upsertVideo(updated);
      appendActivityLog({
        videoId: video.id,
        stage: 'ai_analysis',
        message: `AI meme analysis completed for "${video.originalFileName}" (Safety: ${analysis.appropriateForChannel ? 'Approved' : 'Flagged'}, Copyright: ${analysis.copyrightRiskLevel}).`,
        level: analysis.appropriateForChannel ? 'success' : 'warning',
      });
      res.json(updated);
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'AI analysis failed.',
      });
    }
  });

  // Reschedule individual video
  app.post('/api/videos/:id/reschedule', (req, res) => {
    const video = getVideoById(req.params.id);
    if (!video) {
      res.status(404).json({ error: 'Video not found.' });
      return;
    }
    if (video.folderStage === 'published') {
      res.status(400).json({ error: 'Published videos cannot be rescheduled.' });
      return;
    }
    const { scheduledAt } = req.body as { scheduledAt?: string };
    if (!scheduledAt || Number.isNaN(new Date(scheduledAt).getTime())) {
      res.status(400).json({ error: 'Valid ISO scheduledAt timestamp is required.' });
      return;
    }
    const updated = {
      ...video,
      scheduledAt: new Date(scheduledAt).toISOString(),
    };
    upsertVideo(updated);
    appendActivityLog({
      videoId: updated.id,
      stage: 'reschedule',
      message: `Rescheduled "${updated.originalFileName}" to ${new Date(updated.scheduledAt).toLocaleString('en-US', { timeZone: getSettings().timezone })}.`,
      level: 'info',
    });
    res.json(updated);
  });

  // Publish single video to YouTube via official API
  app.post('/api/videos/:id/publish', async (req, res) => {
    try {
      const { token } = await resolveEffectiveAccessToken(req.headers.authorization);
      if (!token) {
        res.status(401).json({
          error: 'YouTube channel not authenticated. Connect your Google account first.',
        });
        return;
      }
      const body = (req.body || {}) as {
        useScheduledPublishAt?: boolean;
        privacyOverride?: 'private' | 'public' | 'unlisted';
      };
      const updated = await publishVideoToYouTube({
        videoId: req.params.id,
        accessToken: token,
        useScheduledPublishAt: Boolean(body.useScheduledPublishAt),
        privacyOverride: body.privacyOverride,
      });
      res.json(updated);
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'YouTube publish failed.',
      });
    }
  });

  // Record direct browser upload result (Vercel large-file fallback)
  app.post('/api/videos/:id/direct-result', async (req, res) => {
    try {
      const body = req.body as {
        youtubeVideoId?: string;
        youtubeUrl?: string;
        privacyStatus?: 'private' | 'public' | 'unlisted';
        errorMessage?: string;
      };
      const updated = await markClientDirectPublishResult({
        videoId: req.params.id,
        ...body,
      });
      res.json(updated);
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Failed to save direct upload status.',
      });
    }
  });

  app.post('/api/videos/:id/retry', async (req, res) => {
    try {
      const updated = await retryFailedVideo(req.params.id);
      res.json(updated);
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Retry failed.',
      });
    }
  });

  app.delete('/api/videos/:id', async (req, res) => {
    try {
      await deleteQueuedVideo(req.params.id);
      res.json({ deleted: true });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Delete failed.',
      });
    }
  });

  // Trending Meme Audio Research
  app.post('/api/audio/research', async (req, res) => {
    try {
      const { focusTopic } = (req.body || {}) as { focusTopic?: string };
      const items = await researchTrendingMemeAudio(focusTopic);
      saveTrendingAudioItems(items);
      appendActivityLog({
        videoId: null,
        stage: 'audio_research',
        message: `Researched ${items.length} trending meme sounds with Google Search grounding.`,
        level: 'success',
      });
      res.json({ items });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Audio research failed.',
      });
    }
  });

  // YouTube Channel & Stats
  app.get('/api/youtube/channel', async (req, res) => {
    try {
      const { token, authMode } = await resolveEffectiveAccessToken(
        req.headers.authorization
      );
      if (!token) {
        res.json(getDisconnectedChannelStatus());
        return;
      }
      const status = await fetchChannelInfoWithToken(token, authMode);
      res.json(status);
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Failed to fetch channel info.',
      });
    }
  });

  app.get('/api/youtube/oauth/url', (req, res) => {
    try {
      const origin = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
      const redirectUri = `${origin.replace(/\/$/, '')}/api/youtube/oauth/callback`;
      res.json({
        configured: isServerOAuthConfigured(),
        url: isServerOAuthConfigured() ? buildServerOAuthUrl(redirectUri) : null,
        redirectUri,
      });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Failed to build OAuth URL.',
      });
    }
  });

  app.post('/api/youtube/disconnect', (_req, res) => {
    disconnectServerYouTubeToken();
    appendActivityLog({
      videoId: null,
      stage: 'youtube_auth',
      message: 'Cleared stored server YouTube OAuth refresh token.',
      level: 'info',
    });
    res.json({ disconnected: true });
  });

  app.post('/api/youtube/sync-stats', async (req, res) => {
    try {
      const { token } = await resolveEffectiveAccessToken(req.headers.authorization);
      if (!token) {
        res.status(401).json({
          error: 'Connect your YouTube channel first to sync published video statistics.',
        });
        return;
      }
      const videos = listVideos();
      const statsMap = await syncPublishedVideosStats(token, videos);
      let updatedCount = 0;
      for (const v of videos) {
        if (v.youtubeVideoId && statsMap.has(v.youtubeVideoId)) {
          const stats = statsMap.get(v.youtubeVideoId)!;
          upsertVideo({
            ...v,
            views: stats.views,
            likes: stats.likes,
            comments: stats.comments,
          });
          updatedCount++;
        }
      }
      appendActivityLog({
        videoId: null,
        stage: 'youtube_sync',
        message: `Synced real YouTube statistics for ${updatedCount} published Shorts.`,
        level: 'success',
      });
      res.json({ updatedCount, videos: listVideos() });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Failed to sync YouTube stats.',
      });
    }
  });

  app.get('/api/youtube/analytics', async (req, res) => {
    try {
      const { token } = await resolveEffectiveAccessToken(req.headers.authorization);
      const report = await fetchRealAnalyticsReport(token, listVideos());
      res.json(report);
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Failed to load YouTube Analytics.',
      });
    }
  });

  // Settings & Scheduler Controls
  app.post('/api/settings', (req, res) => {
    const patch = (req.body || {}) as Partial<SchedulerSettings>;
    const sanitized: Partial<SchedulerSettings> = {};

    if (typeof patch.schedulerPaused === 'boolean') {
      sanitized.schedulerPaused = patch.schedulerPaused;
    }
    if (typeof patch.postsPerDay === 'number') {
      sanitized.postsPerDay = Math.min(10, Math.max(1, Math.round(patch.postsPerDay)));
    }
    if (typeof patch.dailyBatchSize === 'number') {
      sanitized.dailyBatchSize = Math.min(10, Math.max(1, Math.round(patch.dailyBatchSize)));
    }
    if (typeof patch.timezone === 'string' && patch.timezone.trim()) {
      try {
        Intl.DateTimeFormat('en-US', { timeZone: patch.timezone.trim() });
        sanitized.timezone = patch.timezone.trim();
      } catch {
        res.status(400).json({ error: `Invalid IANA timezone: ${patch.timezone}` });
        return;
      }
    }
    if (Array.isArray(patch.postingSlots)) {
      const validSlots = patch.postingSlots
        .map((s) => String(s).trim())
        .filter((s) => /^\d{2}:\d{2}$/.test(s));
      if (validSlots.length === 0) {
        res.status(400).json({ error: 'Provide at least one valid HH:MM posting slot.' });
        return;
      }
      sanitized.postingSlots = validSlots;
    }
    if (typeof patch.allowAutoCrop9x16 === 'boolean') {
      sanitized.allowAutoCrop9x16 = patch.allowAutoCrop9x16;
    }
    if (typeof patch.enableFolderWatcher === 'boolean') {
      sanitized.enableFolderWatcher = patch.enableFolderWatcher;
    }
    if (
      patch.youtubePrivacyMode === 'scheduled_private' ||
      patch.youtubePrivacyMode === 'public' ||
      patch.youtubePrivacyMode === 'unlisted'
    ) {
      sanitized.youtubePrivacyMode = patch.youtubePrivacyMode;
    }
    if (Array.isArray(patch.targetCountries)) {
      sanitized.targetCountries = patch.targetCountries
        .map((c) => String(c).toUpperCase().trim())
        .filter(Boolean);
    }

    const updated = saveSettings(sanitized);
    appendActivityLog({
      videoId: null,
      stage: 'settings',
      message: 'Updated ShortsPilot scheduling & automation configuration.',
      level: 'info',
    });
    res.json(updated);
  });

  app.post('/api/scheduler/pause', (_req, res) => {
    const updated = saveSettings({ schedulerPaused: true });
    appendActivityLog({
      videoId: null,
      stage: 'scheduler',
      message: 'Publishing scheduler paused.',
      level: 'warning',
    });
    res.json(updated);
  });

  app.post('/api/scheduler/resume', (_req, res) => {
    const updated = saveSettings({ schedulerPaused: false });
    appendActivityLog({
      videoId: null,
      stage: 'scheduler',
      message: 'Publishing scheduler resumed.',
      level: 'success',
    });
    res.json(updated);
  });

  app.post('/api/scheduler/tick', async (_req, res) => {
    try {
      const result = await runSchedulerTick();
      res.json(result);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Scheduler tick failed.',
      });
    }
  });

  // Always return JSON for unmatched /api routes and Multer errors
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API route not found.' });
  });

  app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/api')) {
      const msg = err instanceof Error ? err.message : 'Internal server error.';
      res.status(400).json({ error: msg });
      return;
    }
    next(err);
  });

  return app;
}
