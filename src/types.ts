export type ClipStatus =
  | 'in_folder'
  | 'scheduled'
  | 'uploading'
  | 'submitted'
  | 'failed';

export type TargetRegion = 'US' | 'CA' | 'AU';

export type YoutubePrivacy = 'public' | 'unlisted' | 'private';

export interface SubmissionReceipt {
  submittedAt: string;
  campaignName: string;
  statusCode: number;
  method: 'webhook' | 'auto_bridge';
  responseNote: string;
  copiedLink: string;
}

export interface ClipItem {
  id: string;
  fileName: string;
  fileSizeBytes: number;
  hasVideoFile: boolean;
  shortTitle: string;
  cleanTitle: string;
  hashtags: string[];
  targetRegions: TargetRegion[];
  campaignId: string;
  scheduledAt: string;
  uploadedAt?: string;
  status: ClipStatus;
  youtubeVideoId?: string;
  youtubeShortUrl: string;
  privacyStatus?: YoutubePrivacy;
  submissionReceipt?: SubmissionReceipt;
  createdAt: string;
}

export interface Campaign {
  id: string;
  name: string;
  platform: string;
  rpmUsd: number;
  requiredTag: string;
  webhookUrl: string;
  portalSubmitUrl: string;
  totalSubmitted: number;
  estimatedEarningsUsd: number;
}

export interface AutomationConfig {
  watchFolderPath: string;
  autoRunEnabled: boolean;
  postsPerDay: number;
  peakWindowsEst: string[];
  targetRegions: TargetRegion[];
  defaultCampaignId: string;
  defaultPrivacyStatus: YoutubePrivacy;
  youtubeUploadWebhookUrl: string;
  autoSubmitToRewards: boolean;
}

export interface PipelineEvent {
  id: string;
  timestamp: string;
  clipId: string;
  clipTitle: string;
  stage: string;
  detail: string;
  outcome: 'success' | 'error';
}

export interface AutomationState {
  clips: ClipItem[];
  campaigns: Campaign[];
  config: AutomationConfig;
  events: PipelineEvent[];
}

export interface YouTubeChannelInfo {
  id: string;
  title: string;
  customUrl: string;
  thumbnailUrl: string;
  subscriberCount: string;
  videoCount: string;
}

export interface YouTubeRemoteVideo {
  id: string;
  title: string;
  publishedAt: string;
  thumbnailUrl: string;
  shortUrl: string;
}
