import { useMemo, useState } from 'react';
import {
  ArrowUpRight,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  LogOut,
  RefreshCw,
  Upload,
} from 'lucide-react';
import { formatTier1Slot } from '../constants/assets.ts';
import type {
  AutomationState,
  ClipItem,
  YouTubeChannelInfo,
  YouTubeRemoteVideo,
} from '../types.ts';

interface DailyDashboardViewProps {
  state: AutomationState;
  ytConnected: boolean;
  ytConnecting: boolean;
  ytChannel: YouTubeChannelInfo | null;
  ytVideos: YouTubeRemoteVideo[];
  ytLoadingVideos: boolean;
  onConnectYoutube: () => Promise<void>;
  onDisconnectYoutube: () => Promise<void>;
  onRefreshYoutube: () => Promise<void>;
  onRequestUploadClip: (clip: ClipItem) => void;
  onGoToFolder: () => void;
  busyClipId: string | null;
}

function toEstDateKey(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

function formatDayLabel(dateKey: string): string {
  try {
    const [y, m, d] = dateKey.split('-').map(Number);
    const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1, 12, 0, 0));
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    }).format(dt);
  } catch {
    return dateKey;
  }
}

export function DailyDashboardView({
  state,
  ytConnected,
  ytConnecting,
  ytChannel,
  ytVideos,
  ytLoadingVideos,
  onConnectYoutube,
  onDisconnectYoutube,
  onRefreshYoutube,
  onRequestUploadClip,
  onGoToFolder,
  busyClipId,
}: DailyDashboardViewProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [avatarErr, setAvatarErr] = useState(false);

  const dailyTarget = state.config.postsPerDay || 5;
  const todayEstKey = toEstDateKey(new Date().toISOString());

  // Clips uploaded today (either via direct YouTube upload or submission pipeline)
  const uploadedToday = useMemo(() => {
    return state.clips.filter((c) => {
      if (c.status !== 'submitted') return false;
      const stamp = c.uploadedAt || c.submissionReceipt?.submittedAt || c.createdAt;
      return toEstDateKey(stamp) === todayEstKey;
    });
  }, [state.clips, todayEstKey]);

  const scheduledForToday = useMemo(() => {
    return state.clips
      .filter((c) => c.status === 'scheduled')
      .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
  }, [state.clips]);

  // Build 5 (or postsPerDay) explicit daily slots combining uploadedToday + scheduled clips
  const dailySlots = useMemo(() => {
    const windows =
      state.config.peakWindowsEst.length >= dailyTarget
        ? state.config.peakWindowsEst.slice(0, dailyTarget)
        : ['08:30', '12:15', '15:30', '17:30', '20:30'].slice(0, dailyTarget);

    const pool = [...uploadedToday, ...scheduledForToday];
    return windows.map((win, idx) => {
      const assigned = pool[idx] ?? null;
      return {
        slotNumber: idx + 1,
        windowEst: win,
        clip: assigned,
      };
    });
  }, [dailyTarget, state.config.peakWindowsEst, uploadedToday, scheduledForToday]);

  // Last 7 days upload breakdown
  const sevenDayHistory = useMemo(() => {
    const days: Array<{ dateKey: string; label: string; clips: ClipItem[] }> = [];
    const now = new Date();
    for (let i = 0; i < 7; i++) {
      const d = new Date(now.getTime() - i * 24 * 3600 * 1000);
      const key = toEstDateKey(d.toISOString());
      const dayClips = state.clips.filter((c) => {
        if (c.status !== 'submitted') return false;
        const stamp = c.uploadedAt || c.submissionReceipt?.submittedAt || c.createdAt;
        return toEstDateKey(stamp) === key;
      });
      days.push({
        dateKey: key,
        label: i === 0 ? `Today (${formatDayLabel(key)})` : formatDayLabel(key),
        clips: dayClips,
      });
    }
    return days;
  }, [state.clips]);

  const handleCopy = async (id: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedId(id);
    window.setTimeout(() => setCopiedId(null), 1800);
  };

  return (
    <div className="flex flex-col gap-6">
      {/* YouTube Channel Connection Card */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        {ytConnected && ytChannel ? (
          <>
            <div className="flex items-center gap-3.5 min-w-0">
              {ytChannel.thumbnailUrl && !avatarErr ? (
                <img
                  src={ytChannel.thumbnailUrl}
                  alt={ytChannel.title}
                  referrerPolicy="no-referrer"
                  onError={() => setAvatarErr(true)}
                  className="w-11 h-11 rounded-full object-cover border border-slate-200 shrink-0"
                />
              ) : (
                <div className="w-11 h-11 rounded-full bg-rose-600 text-white text-sm font-semibold flex items-center justify-center shrink-0">
                  {ytChannel.title.slice(0, 2).toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-slate-900 truncate">
                    {ytChannel.title}
                  </span>
                  {ytChannel.customUrl && (
                    <span className="text-xs font-mono text-slate-500">
                      {ytChannel.customUrl}
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    Connected
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5 font-mono tabular-nums">
                  {Number(ytChannel.subscriberCount).toLocaleString('en-US')} subscribers ·{' '}
                  {Number(ytChannel.videoCount).toLocaleString('en-US')} channel videos · Target: US / CA / AU
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                disabled={ytLoadingVideos}
                onClick={onRefreshYoutube}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${ytLoadingVideos ? 'animate-spin' : ''}`} />
                Sync Channel
              </button>
              <button
                type="button"
                onClick={onDisconnectYoutube}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 whitespace-nowrap cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                Disconnect
              </button>
            </div>
          </>
        ) : (
          <>
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Connect Your YouTube Channel
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Sign in with Google to upload Shorts directly from {state.config.watchFolderPath}, capture live Short URLs, and monitor your 5 daily uploads.
              </p>
            </div>

            <button
              type="button"
              disabled={ytConnecting}
              onClick={onConnectYoutube}
              className="inline-flex items-center gap-2.5 px-4 py-2 text-xs font-medium rounded-lg border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 disabled:opacity-60 whitespace-nowrap shrink-0 shadow-xs cursor-pointer"
            >
              <svg
                version="1.1"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 48 48"
                className="w-4 h-4 shrink-0"
              >
                <path
                  fill="#EA4335"
                  d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                />
                <path
                  fill="#4285F4"
                  d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                />
                <path
                  fill="#FBBC05"
                  d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                />
                <path
                  fill="#34A853"
                  d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                />
              </svg>
              {ytConnecting ? 'Connecting Google...' : 'Sign in with Google'}
            </button>
          </>
        )}
      </div>

      {/* Daily 5-Uploads Progress Strip */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Today&apos;s Daily Upload Quota ({uploadedToday.length} / {dailyTarget} Uploaded)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              5 daily Shorts targeted at US, Canada &amp; Australia peak overlap windows.
            </p>
          </div>
          <div className="flex items-center gap-4 text-xs font-mono tabular-nums text-slate-600">
            <span>Ready in Folder: {scheduledForToday.length}</span>
            <span>Remaining Today: {Math.max(0, dailyTarget - uploadedToday.length)}</span>
          </div>
        </div>

        {/* 5-Segment Daily Bar */}
        <div className="grid grid-cols-5 gap-2">
          {dailySlots.map((slot) => {
            const done = slot.clip?.status === 'submitted';
            const queued = slot.clip?.status === 'scheduled';
            return (
              <div
                key={slot.slotNumber}
                className={`h-2 rounded-full transition-colors ${
                  done
                    ? 'bg-emerald-600'
                    : queued
                    ? 'bg-amber-400'
                    : 'bg-slate-200'
                }`}
              />
            );
          })}
        </div>
      </div>

      {/* Today's 5 Slots Breakdown Table */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">
            Daily 5-Upload Schedule &amp; Status
          </h3>
          <span className="text-xs text-slate-500">
            EST / AEST Overlap
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-medium text-slate-500">
                <th className="py-2.5 px-4">Slot</th>
                <th className="py-2.5 px-3">US/CA/AU Window</th>
                <th className="py-2.5 px-3">Short Title &amp; Hashtags</th>
                <th className="py-2.5 px-3">Upload Status</th>
                <th className="py-2.5 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {dailySlots.map((slot) => {
                const clip = slot.clip;
                const isDone = clip?.status === 'submitted';
                const isBusy = clip ? busyClipId === clip.id : false;

                return (
                  <tr key={slot.slotNumber} className="hover:bg-slate-50/60">
                    <td className="py-3.5 px-4 font-mono tabular-nums font-semibold text-slate-700">
                      0{slot.slotNumber}
                    </td>
                    <td className="py-3.5 px-3 font-mono tabular-nums text-slate-600 whitespace-nowrap">
                      {slot.windowEst} EST
                    </td>
                    <td className="py-3.5 px-3 max-w-[320px]">
                      {clip ? (
                        <div>
                          <div className="font-medium text-slate-900 truncate text-[13px]">
                            {clip.shortTitle}
                          </div>
                          <div className="text-[11px] font-mono text-slate-500 truncate mt-0.5">
                            {clip.hashtags.join(' ')}
                          </div>
                        </div>
                      ) : (
                        <span className="text-slate-400">
                          Open slot — drop a clip into {state.config.watchFolderPath}
                        </span>
                      )}
                    </td>
                    <td className="py-3.5 px-3 whitespace-nowrap">
                      {!clip ? (
                        <span className="text-slate-400">Awaiting clip</span>
                      ) : isDone ? (
                        <span className="inline-flex items-center gap-1.5 font-medium text-emerald-700">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                          Uploaded &amp; Submitted
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 font-medium text-amber-700">
                          <Clock className="w-3.5 h-3.5 text-amber-600" />
                          Queued in Folder
                        </span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-right whitespace-nowrap">
                      {!clip ? (
                        <button
                          type="button"
                          onClick={onGoToFolder}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 cursor-pointer"
                        >
                          <Upload className="w-3 h-3" />
                          Add Clip
                        </button>
                      ) : isDone && clip.youtubeShortUrl ? (
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleCopy(clip.id, clip.youtubeShortUrl)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 cursor-pointer"
                          >
                            {copiedId === clip.id ? (
                              <>
                                <Check className="w-3 h-3 text-emerald-600" />
                                Copied
                              </>
                            ) : (
                              <>
                                <Copy className="w-3 h-3" />
                                Copy URL
                              </>
                            )}
                          </button>
                          <a
                            href={clip.youtubeShortUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                          >
                            Open
                            <ArrowUpRight className="w-3 h-3" />
                          </a>
                        </div>
                      ) : (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => onRequestUploadClip(clip)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50 cursor-pointer"
                        >
                          <Upload className="w-3 h-3" />
                          {isBusy
                            ? 'Uploading...'
                            : ytConnected
                            ? 'Upload to YouTube'
                            : 'Run & Submit'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Bottom Split: 7-Day Upload History + Connected YouTube Recent Uploads */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        <div className="xl:col-span-6 bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">
              7-Day Daily Upload Log
            </h3>
            <span className="text-xs font-mono text-slate-500">Target: {dailyTarget}/day</span>
          </div>

          <div className="divide-y divide-slate-100">
            {sevenDayHistory.map((day) => (
              <div key={day.dateKey} className="px-5 py-3 flex flex-col gap-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-900">{day.label}</span>
                  <span
                    className={`font-mono tabular-nums font-semibold ${
                      day.clips.length >= dailyTarget
                        ? 'text-emerald-700'
                        : day.clips.length > 0
                        ? 'text-amber-700'
                        : 'text-slate-400'
                    }`}
                  >
                    {day.clips.length} / {dailyTarget}
                  </span>
                </div>
                {day.clips.length > 0 ? (
                  <p className="text-xs text-slate-600 truncate">
                    {day.clips.map((c) => c.shortTitle).join(' · ')}
                  </p>
                ) : (
                  <p className="text-xs text-slate-400">No uploads logged on this day</p>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="xl:col-span-6 bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">
              Connected YouTube Recent Uploads
            </h3>
            <span className="text-xs text-slate-500">
              {ytConnected ? `${ytVideos.length} recent` : 'Not connected'}
            </span>
          </div>

          {!ytConnected ? (
            <div className="p-8 text-center flex flex-col items-center gap-2">
              <p className="text-xs text-slate-600">
                Sign in with Google above to view your live YouTube channel uploads and copy Short URLs directly.
              </p>
            </div>
          ) : ytLoadingVideos ? (
            <div className="p-8 text-center text-xs text-slate-500">
              Loading recent YouTube uploads...
            </div>
          ) : ytVideos.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">
              No videos found on this YouTube channel yet.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {ytVideos.slice(0, 6).map((vid) => (
                <div
                  key={vid.id}
                  className="px-5 py-3 flex items-center justify-between gap-3 hover:bg-slate-50/60"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-slate-900 truncate">
                      {vid.title}
                    </p>
                    <p className="text-[11px] font-mono text-slate-500 truncate mt-0.5">
                      {vid.shortUrl} · {formatTier1Slot(vid.publishedAt)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleCopy(`yt_${vid.id}`, vid.shortUrl)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 shrink-0 cursor-pointer"
                  >
                    {copiedId === `yt_${vid.id}` ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-600" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        Copy Link
                      </>
                    )}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
