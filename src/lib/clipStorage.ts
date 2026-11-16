import {
  FIXED_SHORT_DESCRIPTION,
  FIXED_SHORT_HASHTAGS,
  FIXED_SHORT_TITLE,
} from '../../config/constants.ts';

const DB_NAME = 'shortspilot-xavier-videos';
const STORE_NAME = 'videos';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveLocalVideoBlob(id: string, file: Blob): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(file, id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Ignore IndexedDB quota/private-mode errors
  }
}

export async function getLocalVideoBlob(id: string): Promise<Blob | null> {
  try {
    const db = await openDb();
    return await new Promise<Blob | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(id);
      req.onsuccess = () => resolve((req.result as Blob) || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function deleteLocalVideoBlob(id: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Ignore
  }
}

export async function computeBlobSha256(file: Blob): Promise<string> {
  const buf = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function safeFetchJson<T = Record<string, unknown>>(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(input, init);
  const rawText = await res.text();

  let parsed: unknown = null;
  if (rawText) {
    try {
      parsed = JSON.parse(rawText);
    } catch {
      const preview = rawText.replace(/\s+/g, ' ').trim().slice(0, 140);
      throw new Error(
        `Server returned non-JSON response (HTTP ${res.status}): ${preview || res.statusText}`
      );
    }
  }

  if (!res.ok) {
    let msg = `Request failed with HTTP ${res.status}`;
    if (
      parsed &&
      typeof parsed === 'object' &&
      'error' in parsed &&
      typeof (parsed as { error?: unknown }).error === 'string' &&
      (parsed as { error: string }).error
    ) {
      msg = (parsed as { error: string }).error;
    }
    throw new Error(msg);
  }

  return (parsed ?? {}) as T;
}

export async function uploadBlobDirectlyToYouTube(params: {
  accessToken: string;
  blob: Blob;
  privacyStatus: 'private' | 'public' | 'unlisted';
  publishAtIso?: string | null;
}): Promise<{ youtubeVideoId: string; youtubeUrl: string; privacyApplied: 'private' | 'public' | 'unlisted' }> {
  const mimeType = params.blob.type || 'video/mp4';
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
      categoryId: '23',
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
        'X-Upload-Content-Length': String(params.blob.size),
        'X-Upload-Content-Type': mimeType,
      },
      body: JSON.stringify(metadata),
    }
  );

  if (!initRes.ok) {
    const errText = await initRes.text();
    throw new Error(`YouTube resumable init failed (${initRes.status}): ${errText}`);
  }

  const uploadUrl = initRes.headers.get('location');
  if (!uploadUrl) {
    throw new Error('YouTube API did not return an upload session URL.');
  }

  const putRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': mimeType },
    body: params.blob,
  });

  const putText = await putRes.text();
  let putData: { id?: string; error?: { message?: string } } = {};
  if (putText) {
    try {
      putData = JSON.parse(putText) as { id?: string; error?: { message?: string } };
    } catch {
      throw new Error(`YouTube upload returned non-JSON response (HTTP ${putRes.status}).`);
    }
  }

  if (!putRes.ok || !putData.id) {
    throw new Error(
      putData.error?.message || `YouTube upload failed (HTTP ${putRes.status}).`
    );
  }

  return {
    youtubeVideoId: putData.id,
    youtubeUrl: `https://youtube.com/shorts/${putData.id}`,
    privacyApplied: effectivePrivacy,
  };
}
