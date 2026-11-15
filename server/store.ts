import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  AutomationState,
  Campaign,
  ClipItem,
  PipelineEvent,
  TargetRegion,
} from '../src/types.ts';

export const INBOX_DIR = path.resolve(process.cwd(), 'shorts-inbox');
const DATA_DIR = path.resolve(process.cwd(), '.data');
const STORE_FILE = path.join(DATA_DIR, 'automation-store.json');

const VIDEO_EXTS = new Set(['.mp4', '.mov', '.webm', '.mkv', '.m4v']);

export function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export function isVideoFile(fileName: string): boolean {
  return VIDEO_EXTS.has(path.extname(fileName).toLowerCase());
}

export function parseShortFilename(fileName: string): {
  shortTitle: string;
  cleanTitle: string;
  hashtags: string[];
} {
  const baseName = path.basename(fileName, path.extname(fileName)).trim();
  const normalized = baseName.replace(/\s+/g, ' ').trim();

  const tagMatches = normalized.match(/#[a-zA-Z0-9_]+/g) ?? [];
  const uniqueTags: string[] = [];
  for (const tag of tagMatches) {
    const lower = tag.toLowerCase();
    if (!uniqueTags.some((t) => t.toLowerCase() === lower)) {
      uniqueTags.push(tag);
    }
  }
  if (!uniqueTags.some((t) => t.toLowerCase() === '#shorts')) {
    uniqueTags.push('#Shorts');
  }

  const cleanTitle = normalized
    .replace(/#[a-zA-Z0-9_]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const fullWithTags = normalized.toLowerCase().includes('#shorts')
    ? normalized
    : `${normalized} #Shorts`.trim();

  const shortTitle = fullWithTags.slice(0, 100);

  return {
    shortTitle: shortTitle || 'Untitled Short #Shorts',
    cleanTitle: cleanTitle || 'Untitled Short',
    hashtags: uniqueTags,
  };
}

export function matchCampaignByHashtags(
  hashtags: string[],
  campaigns: Campaign[],
  fallbackId: string
): string {
  const lowerTags = hashtags.map((t) => t.toLowerCase());
  const matched = campaigns.find(
    (c) => c.requiredTag && lowerTags.includes(c.requiredTag.toLowerCase())
  );
  return matched?.id || fallbackId || campaigns[0]?.id || '';
}

export function nextTier1SlotIso(
  estWindows: string[],
  existingClips: ClipItem[]
): string {
  const windows =
    estWindows.length > 0
      ? estWindows
      : ['08:30', '12:15', '15:30', '17:30', '20:30'];
  const taken = existingClips
    .filter((c) => c.status === 'scheduled')
    .map((c) => new Date(c.scheduledAt).getTime());

  const now = new Date();
  for (let dayOffset = 0; dayOffset < 30; dayOffset++) {
    for (const win of windows) {
      const [hh, mm] = win.split(':').map((n) => parseInt(n, 10));
      const candidate = new Date(now);
      candidate.setUTCDate(candidate.getUTCDate() + dayOffset);
      candidate.setUTCHours((hh || 17) + 5, mm || 30, 0, 0);
      if (candidate.getTime() <= Date.now() + 5 * 60 * 1000) continue;
      const collision = taken.some((t) => Math.abs(t - candidate.getTime()) < 45 * 60 * 1000);
      if (!collision) {
        return candidate.toISOString();
      }
    }
  }
  return new Date(Date.now() + 2 * 3600 * 1000).toISOString();
}

function createInitialState(): AutomationState {
  const campaigns: Campaign[] = [
    {
      id: 'camp_whop_rewards',
      name: 'Whop Content Rewards',
      platform: 'Whop',
      rpmUsd: 2.0,
      requiredTag: '#whop',
      webhookUrl: '',
      portalSubmitUrl: 'https://whop.com/content-rewards',
      totalSubmitted: 0,
      estimatedEarningsUsd: 0,
    },
    {
      id: 'camp_clip_bounty',
      name: 'Tier-1 Clipping Bounty',
      platform: 'Content Rewards Portal',
      rpmUsd: 1.75,
      requiredTag: '#clip',
      webhookUrl: '',
      portalSubmitUrl: 'https://whop.com/content-rewards',
      totalSubmitted: 0,
      estimatedEarningsUsd: 0,
    },
  ];

  return {
    clips: [],
    campaigns,
    config: {
      watchFolderPath: './shorts-inbox',
      autoRunEnabled: false,
      postsPerDay: 5,
      peakWindowsEst: ['08:30', '12:15', '15:30', '17:30', '20:30'],
      targetRegions: ['US', 'CA', 'AU'] as TargetRegion[],
      defaultCampaignId: campaigns[0].id,
      defaultPrivacyStatus: 'public',
      youtubeUploadWebhookUrl: '',
      autoSubmitToRewards: true,
    },
    events: [],
  };
}

export async function ensureDirs(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(INBOX_DIR, { recursive: true });
}

export async function loadState(): Promise<AutomationState> {
  await ensureDirs();
  try {
    const raw = await fs.readFile(STORE_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as AutomationState;
    if (!parsed.config.defaultPrivacyStatus) {
      parsed.config.defaultPrivacyStatus = 'public';
    }
    if (parsed.config.postsPerDay === 3 && parsed.config.peakWindowsEst.length === 3) {
      parsed.config.postsPerDay = 5;
      parsed.config.peakWindowsEst = ['08:30', '12:15', '15:30', '17:30', '20:30'];
    }
    return parsed;
  } catch {
    const initial = createInitialState();
    await saveState(initial);
    return initial;
  }
}

export async function saveState(state: AutomationState): Promise<void> {
  await ensureDirs();
  await fs.writeFile(STORE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

export async function syncInboxFolder(state: AutomationState): Promise<{
  state: AutomationState;
  addedCount: number;
}> {
  await ensureDirs();
  const entries = await fs.readdir(INBOX_DIR, { withFileTypes: true });
  const diskVideoFiles = entries
    .filter((e) => e.isFile() && isVideoFile(e.name))
    .map((e) => e.name);

  const diskSet = new Set(diskVideoFiles);
  let addedCount = 0;
  const newEvents: PipelineEvent[] = [];

  for (const clip of state.clips) {
    clip.hasVideoFile = diskSet.has(clip.fileName);
  }

  const trackedNames = new Set(state.clips.map((c) => c.fileName));
  for (const fileName of diskVideoFiles) {
    if (trackedNames.has(fileName)) continue;

    const fullPath = path.join(INBOX_DIR, fileName);
    const stat = await fs.stat(fullPath);
    const parsed = parseShortFilename(fileName);
    const campaignId = matchCampaignByHashtags(
      parsed.hashtags,
      state.campaigns,
      state.config.defaultCampaignId
    );
    const scheduledAt = nextTier1SlotIso(state.config.peakWindowsEst, state.clips);

    const newClip: ClipItem = {
      id: makeId('clip'),
      fileName,
      fileSizeBytes: stat.size,
      hasVideoFile: true,
      shortTitle: parsed.shortTitle,
      cleanTitle: parsed.cleanTitle,
      hashtags: parsed.hashtags,
      targetRegions: [...state.config.targetRegions],
      campaignId,
      scheduledAt,
      status: 'scheduled',
      youtubeShortUrl: '',
      createdAt: new Date().toISOString(),
    };

    state.clips.unshift(newClip);
    addedCount += 1;

    newEvents.unshift({
      id: makeId('evt'),
      timestamp: new Date().toISOString(),
      clipId: newClip.id,
      clipTitle: newClip.shortTitle,
      stage: 'Folder Clip Detected',
      detail: `Parsed title & tags (${newClip.hashtags.join(' ')}) from "${fileName}" for US/CA/AU queue.`,
      outcome: 'success',
    });
  }

  if (addedCount > 0) {
    state.events = [...newEvents, ...state.events].slice(0, 80);
  }

  await saveState(state);
  return { state, addedCount };
}
