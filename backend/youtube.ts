import fs from 'node:fs';
import {
  FIXED_SHORT_DESCRIPTION,
  FIXED_SHORT_HASHTAGS,
  FIXED_SHORT_TITLE,
} from '../config/constants.ts';
import {
  clearStoredRefreshToken,
  getStoredRefreshToken,
  saveEncryptedRefreshToken,
} from '../database/db.ts';
import type {
  AnalyticsReport,
  VideoRecord,
  YouTubeChannelStatus,
} from '../src/types.ts';

const YOUTUBE_OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
];

export function isServerOAuthConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function buildServerOAuthUrl(redirectUri: string): string {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    throw new Error('GOOGLE_CLIENT_ID is not set in environment variables.');
  }
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    scope: YOUTUBE_OAUTH_SCOPES.join(' '),
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeOAuthCodeForTokens(params: {
  code: string;
  redirectUri: string;
}): Promise<{ accessToken: string; channel: YouTubeChannelStatus }> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required on the server.');
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: params.code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: params.redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  const tokenJson = (await tokenRes.json()) as {
    access_token?: string;
    refresh_token?: string;
    error_description?: string;
    error?: string;
  };

  if (!tokenRes.ok || !tokenJson.access_token) {
    throw new Error(
      tokenJson.error_description ||
        tokenJson.error ||
        `OAuth token exchange failed (HTTP ${tokenRes.status}).`
    );
  }

  const channel = await fetchChannelInfoWithToken(tokenJson.access_token, 'refresh_token');
  if (tokenJson.refresh_token) {
    saveEncryptedRefreshToken(tokenJson.refresh_token, {
      channelId: channel.channelId || '',
      channelTitle: channel.channelTitle || 'Xavier Memes',
      channelHandle: channel.channelHandle || '',
      profileImageUrl: channel.profileImageUrl || '',
    });
  }

  return { accessToken: tokenJson.access_token, channel };
}

export async function refreshAccessTokenFromStored(): Promise<string | null> {
  const { refreshToken } = getStoredRefreshToken();
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!refreshToken || !clientId || !clientSecret) {
    return null;
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
    }),
  });

  const data = (await res.json()) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };

  if (!res.ok || !data.access_token) {
    throw new Error(
      data.error_description || data.error || 'Stored YouTube refresh token expired or was revoked.'
    );
  }
  return data.access_token;
}

export async function resolveEffectiveAccessToken(
  headerBearerToken?: string
): Promise<{ token: string | null; authMode: YouTubeChannelStatus['authMode'] }> {
  const cleaned = headerBearerToken?.replace(/^Bearer\s+/i, '').trim();
  if (cleaned) {
    return { token: cleaned, authMode: 'google_oauth' };
  }
  const refreshed = await refreshAccessTokenFromStored();
  if (refreshed) {
    return { token: refreshed, authMode: 'refresh_token' };
  }
  return { token: null, authMode: 'disconnected' };
}

export async function fetchChannelInfoWithToken(
  accessToken: string,
  authMode: YouTubeChannelStatus['authMode'] = 'google_oauth'
): Promise<YouTubeChannelStatus> {
  const stored = getStoredRefreshToken();
  const res = await fetch(
    'https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true',
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  const data = (await res.json()) as {
    items?: Array<{
      id: string;
      snippet?: {
        title?: string;
        customUrl?: string;
        thumbnails?: {
          high?: { url?: string };
          medium?: { url?: string };
          default?: { url?: string };
        };
      };
      statistics?: {
        subscriberCount?: string;
        videoCount?: string;
      };
    }>;
    error?: { message?: string; code?: number };
  };

  if (!res.ok) {
    throw new Error(
      data.error?.message || `YouTube channels.list failed (HTTP ${res.status}).`
    );
  }

  const item = data.items?.[0];
  if (!item) {
    return {
      connected: false,
      authMode,
      channelId: null,
      channelTitle: null,
      channelHandle: null,
      profileImageUrl: null,
      subscriberCount: null,
      videoCount: null,
      hasStoredRefreshToken: Boolean(stored.refreshToken),
      lastError: 'Google account authenticated, but no YouTube channel was found on this account.',
    };
  }

  const thumb =
    item.snippet?.thumbnails?.high?.url ||
    item.snippet?.thumbnails?.medium?.url ||
    item.snippet?.thumbnails?.default?.url ||
    null;

  return {
    connected: true,
    authMode,
    channelId: item.id,
    channelTitle: item.snippet?.title || 'YouTube Channel',
    channelHandle: item.snippet?.customUrl || null,
    profileImageUrl: thumb,
    subscriberCount: item.statistics?.subscriberCount ?? null,
    videoCount: item.statistics?.videoCount ?? null,
    hasStoredRefreshToken: Boolean(stored.refreshToken),
    lastError: null,
  };
}

export function getDisconnectedChannelStatus(lastError: string | null = null): YouTubeChannelStatus {
  const stored = getStoredRefreshToken();
  return {
    connected: false,
    authMode: 'disconnected',
    channelId: stored.channelMeta?.channelId || null,
    channelTitle: stored.channelMeta?.channelTitle || null,
    channelHandle: stored.channelMeta?.channelHandle || null,
    profileImageUrl: stored.channelMeta?.profileImageUrl || null,
    subscriberCount: null,
    videoCount: null,
    hasStoredRefreshToken: Boolean(stored.refreshToken),
    lastError,
  };
}

export function disconnectServerYouTubeToken(): void {
  clearStoredRefreshToken();
}

export async function uploadVideoFileToYouTube(params: {
  accessToken: string;
  filePath: string;
  mimeType: string;
  privacyStatus: 'private' | 'public' | 'unlisted';
  publishAtIso?: string | null;
}): Promise<{ youtubeVideoId: string; youtubeUrl: string; privacyApplied: 'private' | 'public' | 'unlisted' }> {
  const stat = fs.statSync(params.filePath);
  const fileBuffer = await fs.promises.readFile(params.filePath);

  // Scheduled publishAt requires privacyStatus = 'private' per YouTube Data API v3 spec
  const canSchedule =
    Boolean(params.publishAtIso) &&
    new Date(params.publishAtIso!).getTime() > Date.now() + 60_000;
  const effectivePrivacy = canSchedule ? 'private' : params.privacyStatus;

  const statusPayload: Record<string, unknown> = {
    privacyStatus: effectivePrivacy,
    selfDeclaredMadeForKids: false,
  };
  if (canSchedule && params.publishAtIso) {
    statusPayload.publishAt = params.publishAtIso;
  }

  const metadata = {
    snippet: {
      title: FIXED_SHORT_TITLE,
      description: FIXED_SHORT_DESCRIPTION,
      tags: FIXED_SHORT_HASHTAGS.map((h) => h.replace(/^#/, '')),
      categoryId: '23', // Comedy
    },
    status: statusPayload,
  };

  const initRes = await fetch(
    'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Length': String(stat.size),
        'X-Upload-Content-Type': params.mimeType,
      },
      body: JSON.stringify(metadata),
    }
  );

  if (!initRes.ok) {
    const errText = await initRes.text();
    let msg = `YouTube videos.insert init failed (HTTP ${initRes.status}).`;
    try {
      const parsed = JSON.parse(errText) as { error?: { message?: string; errors?: Array<{ reason?: string }> } };
      const reason = parsed.error?.errors?.[0]?.reason;
      msg = parsed.error?.message || msg;
      if (reason === 'quotaExceeded' || reason === 'uploadLimitExceeded') {
        msg = `YouTube API quota/upload limit reached: ${msg}`;
      } else if (initRes.status === 401 || initRes.status === 403) {
        msg = `YouTube authorization or unverified-project restriction (${initRes.status}): ${msg}`;
      }
    } catch {
      if (errText) msg = `${msg} ${errText.slice(0, 160)}`;
    }
    throw new Error(msg);
  }

  const uploadUrl = initRes.headers.get('location');
  if (!uploadUrl) {
    throw new Error('YouTube Data API did not return a resumable upload session URL.');
  }

  // Resumable PUT (chunked cleanly for large files or direct buffer)
  const chunkSize = 8 * 1024 * 1024;
  let putRes: Response;
  if (fileBuffer.length <= chunkSize) {
    putRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': params.mimeType,
        'Content-Length': String(fileBuffer.length),
      },
      body: fileBuffer,
    });
  } else {
    let offset = 0;
    let lastRes: Response | null = null;
    while (offset < fileBuffer.length) {
      const end = Math.min(offset + chunkSize, fileBuffer.length);
      const chunk = fileBuffer.subarray(offset, end);
      lastRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': params.mimeType,
          'Content-Length': String(chunk.length),
          'Content-Range': `bytes ${offset}-${end - 1}/${fileBuffer.length}`,
        },
        body: chunk,
      });
      if (lastRes.status !== 308 && !lastRes.ok) {
        break;
      }
      offset = end;
    }
    putRes = lastRes!;
  }

  const rawBody = await putRes.text();
  let parsed: { id?: string; error?: { message?: string } } = {};
  if (rawBody) {
    try {
      parsed = JSON.parse(rawBody) as { id?: string; error?: { message?: string } };
    } catch {
      throw new Error(`YouTube upload returned non-JSON response (HTTP ${putRes.status}).`);
    }
  }

  if (!putRes.ok || !parsed.id) {
    throw new Error(parsed.error?.message || `YouTube upload failed (HTTP ${putRes.status}).`);
  }

  return {
    youtubeVideoId: parsed.id,
    youtubeUrl: `https://www.youtube.com/shorts/${parsed.id}`,
    privacyApplied: effectivePrivacy,
  };
}

export async function syncPublishedVideosStats(
  accessToken: string,
  videos: VideoRecord[]
): Promise<Map<string, { views: number; likes: number; comments: number }>> {
  const resultMap = new Map<string, { views: number; likes: number; comments: number }>();
  const ids = videos
    .map((v) => v.youtubeVideoId)
    .filter((id): id is string => Boolean(id));
  if (ids.length === 0) return resultMap;

  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const url = `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${encodeURIComponent(batch.join(','))}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = (await res.json()) as {
      items?: Array<{
        id: string;
        statistics?: {
          viewCount?: string;
          likeCount?: string;
          commentCount?: string;
        };
      }>;
      error?: { message?: string };
    };
    if (!res.ok) {
      throw new Error(data.error?.message || `YouTube videos.list failed (HTTP ${res.status}).`);
    }
    for (const item of data.items ?? []) {
      resultMap.set(item.id, {
        views: Number(item.statistics?.viewCount ?? 0),
        likes: Number(item.statistics?.likeCount ?? 0),
        comments: Number(item.statistics?.commentCount ?? 0),
      });
    }
  }
  return resultMap;
}

const COUNTRY_LABELS: Record<string, string> = {
  US: 'United States',
  CA: 'Canada',
  AU: 'Australia',
  GB: 'United Kingdom',
};

export async function fetchRealAnalyticsReport(
  accessToken: string | null,
  videos: VideoRecord[]
): Promise<AnalyticsReport> {
  const published = videos.filter((v) => v.folderStage === 'published');
  const videoViews = published.reduce((sum, v) => sum + (v.views ?? 0), 0);
  const videoLikes = published.reduce((sum, v) => sum + (v.likes ?? 0), 0);
  const videoComments = published.reduce((sum, v) => sum + (v.comments ?? 0), 0);

  if (!accessToken) {
    return {
      available: false,
      reason:
        'Connect your YouTube channel and authorize YouTube Analytics (yt-analytics.readonly) to load real viewer geography and time-series data.',
      totals: {
        views: videoViews,
        likes: videoLikes,
        comments: videoComments,
        subscribersGained: null,
        averageViewDurationSec: null,
      },
      geography: [],
      dailySeries: [],
      fetchedAt: new Date().toISOString(),
    };
  }

  const endDate = new Date().toISOString().slice(0, 10);
  const startDate = new Date(Date.now() - 29 * 86400_000).toISOString().slice(0, 10);

  try {
    const [dailyRes, geoRes] = await Promise.all([
      fetch(
        `https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate=${startDate}&endDate=${endDate}&metrics=views,likes,comments,subscribersGained,averageViewDuration&dimensions=day&sort=day`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      ),
      fetch(
        `https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate=${startDate}&endDate=${endDate}&metrics=views,estimatedMinutesWatched&dimensions=country&filters=country==US,CA,AU&sort=-views`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      ),
    ]);

    if (!dailyRes.ok) {
      const errJson = (await dailyRes.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      const reason =
        errJson.error?.message ||
        `YouTube Analytics API returned HTTP ${dailyRes.status}. Ensure the YouTube Analytics API is enabled and yt-analytics.readonly scope is granted via server OAuth.`;
      return {
        available: false,
        reason,
        totals: {
          views: videoViews,
          likes: videoLikes,
          comments: videoComments,
          subscribersGained: null,
          averageViewDurationSec: null,
        },
        geography: [],
        dailySeries: [],
        fetchedAt: new Date().toISOString(),
      };
    }

    const dailyJson = (await dailyRes.json()) as { rows?: Array<Array<string | number>> };
    const geoJson = geoRes.ok
      ? ((await geoRes.json()) as { rows?: Array<Array<string | number>> })
      : { rows: [] };

    const dailyRows = dailyJson.rows ?? [];
    let totalViews = 0;
    let totalLikes = 0;
    let totalComments = 0;
    let totalSubs = 0;
    let avgDurationAccum = 0;

    const dailySeries = dailyRows.map((row) => {
      const date = String(row[0] ?? '');
      const views = Number(row[1] ?? 0);
      const likes = Number(row[2] ?? 0);
      const comments = Number(row[3] ?? 0);
      const subs = Number(row[4] ?? 0);
      const avgDur = Number(row[5] ?? 0);
      totalViews += views;
      totalLikes += likes;
      totalComments += comments;
      totalSubs += subs;
      avgDurationAccum += avgDur;
      return { date, views, likes, comments };
    });

    const geography = (geoJson.rows ?? []).map((row) => {
      const code = String(row[0] ?? '');
      return {
        countryCode: code,
        countryName: COUNTRY_LABELS[code] || code,
        views: Number(row[1] ?? 0),
        estimatedMinutesWatched: Number(row[2] ?? 0),
      };
    });

    return {
      available: true,
      reason: null,
      totals: {
        views: dailyRows.length > 0 ? totalViews : videoViews,
        likes: dailyRows.length > 0 ? totalLikes : videoLikes,
        comments: dailyRows.length > 0 ? totalComments : videoComments,
        subscribersGained: totalSubs,
        averageViewDurationSec:
          dailyRows.length > 0 ? Math.round(avgDurationAccum / dailyRows.length) : null,
      },
      geography,
      dailySeries,
      fetchedAt: new Date().toISOString(),
    };
  } catch (err) {
    return {
      available: false,
      reason: err instanceof Error ? err.message : 'Unable to reach YouTube Analytics API.',
      totals: {
        views: videoViews,
        likes: videoLikes,
        comments: videoComments,
        subscribersGained: null,
        averageViewDurationSec: null,
      },
      geography: [],
      dailySeries: [],
      fetchedAt: new Date().toISOString(),
    };
  }
}
