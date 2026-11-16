export type VideoLifecycleStatus =
  | 'incoming'
  | 'processing'
  | 'scheduled'
  | 'published'
  | 'failed';

export type ValidationStatus = 'passed' | 'warning' | 'ffprobe_unavailable' | 'failed';

export interface VideoValidationMetadata {
  status: ValidationStatus;
  width: number | null;
  height: number | null;
  aspectRatio: string;
  isVertical9x16: boolean;
  durationSec: number | null;
  fps: number | null;
  hasAudio: boolean | null;
  formatName: string;
  videoCodec: string;
  notes: string[];
}

export interface MemeAnalysisResult {
  analyzedAt: string;
  memeContext: string;
  jokeAndPunchline: string;
  appropriateForChannel: boolean;
  safetyNotes: string;
  copyrightRiskLevel: 'low' | 'medium' | 'high';
  copyrightRiskReason: string;
  recommendedAudioMood: string;
  suggestedSounds: string[];
}

export interface VideoRecord {
  id: string;
  originalFileName: string;
  storedFileName: string;
  sha256: string;
  fileSizeBytes: number;
  folderStage: VideoLifecycleStatus;
  hasLocalFile: boolean;
  hasThumbnail: boolean;
  fixedTitle: string;
  fixedDescription: string;
  fixedHashtags: string[];
  validation: VideoValidationMetadata;
  aiAnalysis: MemeAnalysisResult | null;
  scheduledAt: string | null;
  youtubeVideoId: string | null;
  youtubeUrl: string | null;
  youtubePrivacy: 'private' | 'public' | 'unlisted';
  youtubeScheduledPublishAt: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  lastError: string | null;
  retryCount: number;
  createdAt: string;
  publishedAt: string | null;
}

export interface TrendingAudioItem {
  id: string;
  soundName: string;
  sourceUrl: string | null;
  sourceTitle: string | null;
  relevanceToMemes: string;
  trendStatus: string;
  recommendedForType: string;
  researchedAt: string;
}

export interface ActivityLogEntry {
  id: string;
  timestamp: string;
  videoId: string | null;
  stage: string;
  message: string;
  level: 'info' | 'success' | 'warning' | 'error';
}

export interface SchedulerSettings {
  schedulerPaused: boolean;
  postsPerDay: number;
  dailyBatchSize: number;
  timezone: string;
  postingSlots: string[];
  allowAutoCrop9x16: boolean;
  enableFolderWatcher: boolean;
  youtubePrivacyMode: 'scheduled_private' | 'public' | 'unlisted';
  targetCountries: string[];
}

export interface YouTubeChannelStatus {
  connected: boolean;
  authMode: 'google_oauth' | 'refresh_token' | 'disconnected';
  channelId: string | null;
  channelTitle: string | null;
  channelHandle: string | null;
  profileImageUrl: string | null;
  subscriberCount: string | null;
  videoCount: string | null;
  hasStoredRefreshToken: boolean;
  lastError: string | null;
}

export interface AnalyticsReport {
  available: boolean;
  reason: string | null;
  totals: {
    views: number;
    likes: number;
    comments: number;
    subscribersGained: number | null;
    averageViewDurationSec: number | null;
  };
  geography: Array<{
    countryCode: string;
    countryName: string;
    views: number;
    estimatedMinutesWatched: number;
  }>;
  dailySeries: Array<{
    date: string;
    views: number;
    likes: number;
    comments: number;
  }>;
  fetchedAt: string;
}

export interface DashboardSnapshot {
  videos: VideoRecord[];
  audios: TrendingAudioItem[];
  logs: ActivityLogEntry[];
  settings: SchedulerSettings;
  channel: YouTubeChannelStatus;
  fixedMetadata: {
    title: string;
    description: string;
    hashtags: string[];
  };
  environment: {
    ffmpegAvailable: boolean;
    geminiConfigured: boolean;
    youtubeOAuthConfigured: boolean;
    dashboardAuthRequired: boolean;
    isVercel: boolean;
  };
}
