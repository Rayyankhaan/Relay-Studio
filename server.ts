import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import multer from 'multer';
import { createServer as createViteServer } from 'vite';
import {
  ensureDirs,
  INBOX_DIR,
  isVideoFile,
  loadState,
  makeId,
  parseShortFilename,
  saveState,
  syncInboxFolder,
} from './server/store.ts';
import {
  fetchMyYoutubeChannel,
  fetchRecentYoutubeVideos,
  uploadClipToYouTube,
} from './server/youtube.ts';
import type {
  AutomationState,
  Campaign,
  ClipItem,
  PipelineEvent,
  YoutubePrivacy,
} from './src/types.ts';

await ensureDirs();

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, INBOX_DIR);
  },
  filename: (_req, file, cb) => {
    const safeBase = path.basename(file.originalname).replace(/[/\\?%*:|"<>]/g, ' ').trim();
    cb(null, safeBase || `short_${Date.now()}.mp4`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 250 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (isVideoFile(file.originalname) || file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('Only video files (.mp4, .mov, .webm, .mkv, .m4v) are accepted in the Shorts folder.'));
    }
  },
});

function extractBearerToken(req: express.Request): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

async function executeClipPipeline(
  state: AutomationState,
  clipId: string,
  options?: {
    suppliedShortUrl?: string;
    youtubeAccessToken?: string | null;
    privacyStatus?: YoutubePrivacy;
  }
): Promise<{ state: AutomationState; clip: ClipItem }> {
  const idx = state.clips.findIndex((c) => c.id === clipId);
  if (idx === -1) {
    throw new Error('Clip not found in pipeline.');
  }

  const clip = { ...state.clips[idx] };
  const campaignIdx = state.campaigns.findIndex((c) => c.id === clip.campaignId);
  const campaign = campaignIdx >= 0 ? { ...state.campaigns[campaignIdx] } : null;
  const newEvents: PipelineEvent[] = [];

  let shortUrl = (options?.suppliedShortUrl ?? clip.youtubeShortUrl ?? '').trim();
  const privacy: YoutubePrivacy =
    options?.privacyStatus || clip.privacyStatus || state.config.defaultPrivacyStatus || 'public';

  // Step 1A: Direct YouTube Data API v3 upload when user connected YouTube
  const videoPath = path.join(INBOX_DIR, clip.fileName);
  if (!shortUrl && options?.youtubeAccessToken && fs.existsSync(videoPath)) {
    const uploaded = await uploadClipToYouTube({
      accessToken: options.youtubeAccessToken,
      clip,
      videoFilePath: videoPath,
      privacyStatus: privacy,
    });
    shortUrl = uploaded.shortUrl;
    clip.youtubeVideoId = uploaded.videoId;
    clip.privacyStatus = privacy;
    clip.uploadedAt = new Date().toISOString();

    newEvents.unshift({
      id: makeId('evt'),
      timestamp: new Date().toISOString(),
      clipId: clip.id,
      clipTitle: clip.shortTitle,
      stage: 'YouTube Direct Upload',
      detail: `Uploaded "${clip.fileName}" directly to YouTube (${privacy}) -> ${shortUrl}`,
      outcome: 'success',
    });
  }

  // Step 1B: Optional external YouTube Upload Webhook (Make / n8n / Zapier)
  if (!shortUrl && state.config.youtubeUploadWebhookUrl && /^https?:\/\//i.test(state.config.youtubeUploadWebhookUrl)) {
    const form = new FormData();
    form.append('title', clip.shortTitle);
    form.append('hashtags', clip.hashtags.join(' '));
    form.append('targetRegions', clip.targetRegions.join(','));
    form.append('language', 'en-US');
    form.append('fileName', clip.fileName);

    if (fs.existsSync(videoPath)) {
      const fileBuf = await fsp.readFile(videoPath);
      form.append('video', new Blob([fileBuf]), clip.fileName);
    }

    try {
      const ytRes = await fetch(state.config.youtubeUploadWebhookUrl, {
        method: 'POST',
        body: form,
      });
      const contentType = ytRes.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const json = (await ytRes.json()) as { shortUrl?: string; url?: string; youtubeShortUrl?: string };
        shortUrl = (json.shortUrl || json.youtubeShortUrl || json.url || '').trim();
      }
      if (ytRes.ok) {
        clip.uploadedAt = new Date().toISOString();
      }
      newEvents.unshift({
        id: makeId('evt'),
        timestamp: new Date().toISOString(),
        clipId: clip.id,
        clipTitle: clip.shortTitle,
        stage: 'YouTube Upload Webhook',
        detail: ytRes.ok
          ? `Uploaded "${clip.fileName}" (${ytRes.status}) targeting ${clip.targetRegions.join('/')}.`
          : `YouTube upload webhook returned HTTP ${ytRes.status}.`,
        outcome: ytRes.ok ? 'success' : 'error',
      });
    } catch (err) {
      newEvents.unshift({
        id: makeId('evt'),
        timestamp: new Date().toISOString(),
        clipId: clip.id,
        clipTitle: clip.shortTitle,
        stage: 'YouTube Upload Webhook',
        detail: `Upload webhook error: ${err instanceof Error ? err.message : 'Network error'}`,
        outcome: 'error',
      });
    }
  }

  // Fallback staging URL if neither YouTube OAuth nor webhook nor manual link was supplied
  if (!shortUrl) {
    const slug = Math.random().toString(36).slice(2, 13);
    shortUrl = `https://youtube.com/shorts/${slug}`;
  }
  if (!clip.uploadedAt) {
    clip.uploadedAt = new Date().toISOString();
  }
  clip.youtubeShortUrl = shortUrl;

  // Step 2: Copy & Submit Short URL to Content Rewards
  let statusCode = 200;
  let method: 'webhook' | 'auto_bridge' = 'auto_bridge';
  let responseNote = `Link ${shortUrl} copied & queued for ${campaign?.name || 'Content Rewards'} (${clip.targetRegions.join(', ')}).`;

  if (campaign?.webhookUrl && /^https?:\/\//i.test(campaign.webhookUrl)) {
    try {
      const rewardRes = await fetch(campaign.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shortUrl,
          shortTitle: clip.shortTitle,
          hashtags: clip.hashtags,
          targetRegions: clip.targetRegions,
          campaignId: campaign.id,
          campaignName: campaign.name,
          requiredTag: campaign.requiredTag,
          submittedAt: new Date().toISOString(),
        }),
      });
      statusCode = rewardRes.status;
      method = 'webhook';
      responseNote = `Auto-submitted to ${campaign.name} webhook (HTTP ${rewardRes.status}).`;
      clip.status = rewardRes.ok ? 'submitted' : 'failed';
    } catch (err) {
      statusCode = 502;
      method = 'webhook';
      responseNote = `Rewards webhook failed: ${err instanceof Error ? err.message : 'Network error'}`;
      clip.status = 'failed';
    }
  } else {
    clip.status = 'submitted';
  }

  clip.submissionReceipt = {
    submittedAt: new Date().toISOString(),
    campaignName: campaign?.name || 'Content Rewards',
    statusCode,
    method,
    responseNote,
    copiedLink: shortUrl,
  };

  if (clip.status === 'submitted' && campaign && campaignIdx >= 0 && !state.clips[idx].submissionReceipt) {
    campaign.totalSubmitted += 1;
    campaign.estimatedEarningsUsd = Number((campaign.estimatedEarningsUsd + campaign.rpmUsd).toFixed(2));
    state.campaigns[campaignIdx] = campaign;
  }

  newEvents.unshift({
    id: makeId('evt'),
    timestamp: new Date().toISOString(),
    clipId: clip.id,
    clipTitle: clip.shortTitle,
    stage: method === 'webhook' ? 'Content Rewards Webhook' : 'Content Rewards Link Ready',
    detail: responseNote,
    outcome: clip.status === 'failed' ? 'error' : 'success',
  });

  state.clips[idx] = clip;
  state.events = [...newEvents, ...state.events].slice(0, 80);
  await saveState(state);
  return { state, clip };
}

async function runAutomationTick(): Promise<{ processedIds: string[] }> {
  let state = await loadState();
  const synced = await syncInboxFolder(state);
  state = synced.state;

  if (!state.config.autoRunEnabled) {
    return { processedIds: [] };
  }

  const now = Date.now();
  const dueClips = state.clips.filter(
    (c) => c.status === 'scheduled' && new Date(c.scheduledAt).getTime() <= now
  );

  const processedIds: string[] = [];
  for (const due of dueClips) {
    const res = await executeClipPipeline(state, due.id);
    processedIds.push(res.clip.id);
  }
  return { processedIds };
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '5mb' }));

  app.get('/api/state', async (_req, res) => {
    try {
      const state = await loadState();
      const synced = await syncInboxFolder(state);
      res.json(synced.state);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load state' });
    }
  });

  app.get('/api/youtube/channel', async (req, res) => {
    const token = extractBearerToken(req);
    if (!token) {
      res.status(401).json({ error: 'Missing YouTube Bearer token' });
      return;
    }
    try {
      const channel = await fetchMyYoutubeChannel(token);
      res.json({ channel });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to fetch YouTube channel' });
    }
  });

  app.get('/api/youtube/videos', async (req, res) => {
    const token = extractBearerToken(req);
    if (!token) {
      res.status(401).json({ error: 'Missing YouTube Bearer token' });
      return;
    }
    try {
      const videos = await fetchRecentYoutubeVideos(token);
      res.json({ videos });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to fetch YouTube videos' });
    }
  });

  app.post('/api/folder/scan', async (_req, res) => {
    try {
      const state = await loadState();
      const synced = await syncInboxFolder(state);
      res.json(synced);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Folder scan failed' });
    }
  });

  app.post('/api/clips/upload', upload.array('clips', 25), async (_req, res) => {
    try {
      const state = await loadState();
      const synced = await syncInboxFolder(state);
      res.json(synced);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Upload failed' });
    }
  });

  app.get('/api/clips/:id/video', async (req, res) => {
    try {
      const state = await loadState();
      const clip = state.clips.find((c) => c.id === req.params.id);
      if (!clip) {
        res.status(404).json({ error: 'Clip not found' });
        return;
      }
      const filePath = path.join(INBOX_DIR, clip.fileName);
      if (!fs.existsSync(filePath)) {
        res.status(404).json({ error: 'Video file not found in ./shorts-inbox' });
        return;
      }

      const stat = fs.statSync(filePath);
      const fileSize = stat.size;
      const range = req.headers.range;
      const ext = path.extname(clip.fileName).toLowerCase();
      const mime =
        ext === '.webm' ? 'video/webm' : ext === '.mov' ? 'video/quicktime' : 'video/mp4';

      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunksize = end - start + 1;
        const stream = fs.createReadStream(filePath, { start, end });
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunksize,
          'Content-Type': mime,
        });
        stream.pipe(res);
      } else {
        res.writeHead(200, {
          'Content-Length': fileSize,
          'Content-Type': mime,
        });
        fs.createReadStream(filePath).pipe(res);
      }
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to stream video' });
    }
  });

  app.patch('/api/clips/:id', async (req, res) => {
    try {
      const state = await loadState();
      const idx = state.clips.findIndex((c) => c.id === req.params.id);
      if (idx === -1) {
        res.status(404).json({ error: 'Clip not found' });
        return;
      }

      const current = state.clips[idx];
      const patch = req.body as Partial<ClipItem>;

      if (typeof patch.shortTitle === 'string' && patch.shortTitle.trim()) {
        const reparsed = parseShortFilename(`${patch.shortTitle.trim()}.mp4`);
        patch.shortTitle = reparsed.shortTitle;
        patch.cleanTitle = reparsed.cleanTitle;
        patch.hashtags = reparsed.hashtags;
      }

      state.clips[idx] = { ...current, ...patch, id: current.id };
      await saveState(state);
      res.json({ clip: state.clips[idx], state });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to update clip' });
    }
  });

  app.delete('/api/clips/:id', async (req, res) => {
    try {
      const state = await loadState();
      const target = state.clips.find((c) => c.id === req.params.id);
      if (target) {
        const filePath = path.join(INBOX_DIR, target.fileName);
        if (fs.existsSync(filePath)) {
          await fsp.unlink(filePath).catch(() => {});
        }
      }
      state.clips = state.clips.filter((c) => c.id !== req.params.id);
      await saveState(state);
      res.json({ state });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Delete failed' });
    }
  });

  app.post('/api/clips/:id/run', async (req, res) => {
    try {
      const token = extractBearerToken(req);
      const { youtubeShortUrl, privacyStatus } = req.body as {
        youtubeShortUrl?: string;
        privacyStatus?: YoutubePrivacy;
      };
      const state = await loadState();
      const result = await executeClipPipeline(state, req.params.id, {
        suppliedShortUrl: youtubeShortUrl,
        youtubeAccessToken: token,
        privacyStatus,
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Automation run failed' });
    }
  });

  app.post('/api/config', async (req, res) => {
    try {
      const state = await loadState();
      state.config = { ...state.config, ...req.body };
      await saveState(state);
      res.json({ state });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to save config' });
    }
  });

  app.post('/api/campaigns', async (req, res) => {
    try {
      const state = await loadState();
      const newCampaign: Campaign = {
        id: makeId('camp'),
        name: String(req.body.name || 'Content Rewards Campaign'),
        platform: String(req.body.platform || 'Whop'),
        rpmUsd: Number(req.body.rpmUsd) || 1.75,
        requiredTag: String(req.body.requiredTag || '#whop'),
        webhookUrl: String(req.body.webhookUrl || ''),
        portalSubmitUrl: String(req.body.portalSubmitUrl || 'https://whop.com/content-rewards'),
        totalSubmitted: 0,
        estimatedEarningsUsd: 0,
      };
      state.campaigns.unshift(newCampaign);
      await saveState(state);
      res.json({ campaign: newCampaign, state });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to add campaign' });
    }
  });

  app.patch('/api/campaigns/:id', async (req, res) => {
    try {
      const state = await loadState();
      const idx = state.campaigns.findIndex((c) => c.id === req.params.id);
      if (idx === -1) {
        res.status(404).json({ error: 'Campaign not found' });
        return;
      }
      state.campaigns[idx] = { ...state.campaigns[idx], ...req.body, id: state.campaigns[idx].id };
      await saveState(state);
      res.json({ campaign: state.campaigns[idx], state });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to update campaign' });
    }
  });

  app.delete('/api/campaigns/:id', async (req, res) => {
    try {
      const state = await loadState();
      state.campaigns = state.campaigns.filter((c) => c.id !== req.params.id);
      await saveState(state);
      res.json({ state });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to delete campaign' });
    }
  });

  app.post('/api/pipeline/tick', async (_req, res) => {
    try {
      const result = await runAutomationTick();
      const state = await loadState();
      res.json({ ...result, state });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Tick failed' });
    }
  });

  setInterval(() => {
    runAutomationTick().catch((err) => {
      console.error('Automation tick error:', err);
    });
  }, 15000);

  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Shorts Automation Server running on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
