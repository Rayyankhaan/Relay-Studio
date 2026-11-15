import fsp from 'node:fs/promises';
import path from 'node:path';
import type {
  ClipItem,
  YouTubeChannelInfo,
  YouTubeRemoteVideo,
  YoutubePrivacy,
} from '../src/types.ts';

export async function fetchMyYoutubeChannel(
  accessToken: string
): Promise<YouTubeChannelInfo> {
  const res = await fetch(
    'https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true',
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  const data = (await res.json()) as {
    items?: Array<{
      id: string;
      snippet: {
        title: string;
        customUrl?: string;
        thumbnails?: { default?: { url: string }; medium?: { url: string } };
      };
      statistics?: {
        subscriberCount?: string;
        videoCount?: string;
      };
    }>;
    error?: { message?: string };
  };

  if (!res.ok) {
    throw new Error(data.error?.message || `YouTube API returned ${res.status}`);
  }

  const channel = data.items?.[0];
  if (!channel) {
    throw new Error('No YouTube channel found on this Google account.');
  }

  return {
    id: channel.id,
    title: channel.snippet.title,
    customUrl: channel.snippet.customUrl || '',
    thumbnailUrl:
      channel.snippet.thumbnails?.medium?.url ||
      channel.snippet.thumbnails?.default?.url ||
      '',
    subscriberCount: channel.statistics?.subscriberCount || '0',
    videoCount: channel.statistics?.videoCount || '0',
  };
}

export async function fetchRecentYoutubeVideos(
  accessToken: string
): Promise<YouTubeRemoteVideo[]> {
  const chRes = await fetch(
    'https://www.googleapis.com/youtube/v3/channels?part=contentDetails&mine=true',
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  const chData = (await chRes.json()) as {
    items?: Array<{
      contentDetails?: { relatedPlaylists?: { uploads?: string } };
    }>;
    error?: { message?: string };
  };

  if (!chRes.ok) {
    throw new Error(chData.error?.message || `YouTube API error (${chRes.status})`);
  }

  const uploadsPlaylistId =
    chData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploadsPlaylistId) {
    return [];
  }

  const plRes = await fetch(
    `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&playlistId=${encodeURIComponent(
      uploadsPlaylistId
    )}&maxResults=12`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  const plData = (await plRes.json()) as {
    items?: Array<{
      snippet: {
        title: string;
        publishedAt: string;
        thumbnails?: { medium?: { url: string }; default?: { url: string } };
      };
      contentDetails: { videoId: string };
    }>;
    error?: { message?: string };
  };

  if (!plRes.ok) {
    throw new Error(plData.error?.message || `YouTube playlist error (${plRes.status})`);
  }

  return (plData.items ?? []).map((item) => {
    const vid = item.contentDetails.videoId;
    return {
      id: vid,
      title: item.snippet.title,
      publishedAt: item.snippet.publishedAt,
      thumbnailUrl:
        item.snippet.thumbnails?.medium?.url ||
        item.snippet.thumbnails?.default?.url ||
        '',
      shortUrl: `https://youtube.com/shorts/${vid}`,
    };
  });
}

export async function uploadClipToYouTube(params: {
  accessToken: string;
  clip: ClipItem;
  videoFilePath: string;
  privacyStatus: YoutubePrivacy;
}): Promise<{ videoId: string; shortUrl: string }> {
  const fileBuffer = await fsp.readFile(params.videoFilePath);
  const ext = path.extname(params.videoFilePath).toLowerCase();
  const mimeType =
    ext === '.webm' ? 'video/webm' : ext === '.mov' ? 'video/quicktime' : 'video/mp4';

  const cleanTags = params.clip.hashtags
    .map((t) => t.replace(/^#/, '').trim())
    .filter(Boolean);
  const allTags = Array.from(
    new Set([...cleanTags, 'Shorts', 'USA', 'Canada', 'Australia'])
  ).slice(0, 20);

  const metadata = {
    snippet: {
      title: params.clip.shortTitle.slice(0, 100),
      description: `${params.clip.shortTitle}\n\n${params.clip.hashtags.join(' ')}\nAudience: US · CA · AU`,
      tags: allTags,
      categoryId: '22',
      defaultLanguage: 'en',
      defaultAudioLanguage: 'en-US',
    },
    status: {
      privacyStatus: params.privacyStatus,
      selfDeclaredMadeForKids: false,
    },
  };

  // Step 1: Initiate resumable upload session
  const initRes = await fetch(
    'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Length': String(fileBuffer.length),
        'X-Upload-Content-Type': mimeType,
      },
      body: JSON.stringify(metadata),
    }
  );

  if (!initRes.ok) {
    const errBody = await initRes.text();
    throw new Error(`YouTube resumable init failed (${initRes.status}): ${errBody}`);
  }

  const uploadUrl = initRes.headers.get('location');
  if (!uploadUrl) {
    throw new Error('YouTube API did not return an upload session URL.');
  }

  // Step 2: Upload binary video bytes
  const putRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Length': String(fileBuffer.length),
      'Content-Type': mimeType,
    },
    body: fileBuffer,
  });

  const putData = (await putRes.json()) as {
    id?: string;
    error?: { message?: string };
  };

  if (!putRes.ok || !putData.id) {
    throw new Error(
      putData.error?.message || `YouTube video upload failed (${putRes.status})`
    );
  }

  return {
    videoId: putData.id,
    shortUrl: `https://youtube.com/shorts/${putData.id}`,
  };
}
