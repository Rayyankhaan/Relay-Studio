import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  KeyRound,
  Lock,
  LogOut,
  RefreshCw,
  Save,
  Youtube,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type { DashboardSnapshot, SchedulerSettings } from '../types.ts';
import { safeFetchJson } from '../lib/clipStorage.ts';

interface YouTubeChannelViewProps {
  snapshot: DashboardSnapshot;
  onConnectGoogle: () => Promise<void>;
  onDisconnect: () => Promise<void>;
  onSyncStats: () => Promise<void>;
  busyAction: string | null;
}

export function YouTubeChannelView({
  snapshot,
  onConnectGoogle,
  onDisconnect,
  onSyncStats,
  busyAction,
}: YouTubeChannelViewProps) {
  const { channel } = snapshot;
  const [serverOAuthUrl, setServerOAuthUrl] = useState<string | null>(null);
  const [serverOAuthConfigured, setServerOAuthConfigured] = useState(false);

  useEffect(() => {
    safeFetchJson<{ configured: boolean; url: string | null }>('/api/youtube/oauth/url')
      .then((res) => {
        setServerOAuthConfigured(res.configured);
        setServerOAuthUrl(res.url);
      })
      .catch(() => {});
  }, []);

  return (
    <div className="space-y-6">
      {/* Channel Card */}
      <div className="bg-[#0f172a] border border-slate-800 rounded-xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-5">
        <div className="flex items-center gap-4">
          {channel.profileImageUrl ? (
            <img
              src={channel.profileImageUrl}
              alt={channel.channelTitle || 'YouTube Channel'}
              className="w-16 h-16 rounded-xl object-cover border border-slate-700"
            />
          ) : (
            <div className="w-16 h-16 rounded-xl bg-slate-900 border border-slate-700 flex items-center justify-center">
              <Youtube className="w-8 h-8 text-violet-400" />
            </div>
          )}

          <div>
            <div className="flex items-center gap-2 text-xs">
              <span
                className={`w-2 h-2 rounded-full ${
                  channel.connected ? 'bg-emerald-500' : 'bg-amber-500'
                }`}
              />
              <span className="text-slate-300 font-medium">
                {channel.connected ? 'Connected to YouTube Data API v3' : 'Not Connected'}
              </span>
            </div>
            <h3 className="text-lg font-semibold text-slate-100 mt-1">
              {channel.channelTitle || 'Xavier Memes'}
            </h3>
            <p className="text-xs font-mono text-slate-400 mt-0.5 tabular-nums">
              {channel.connected
                ? `Channel ID: ${channel.channelId} · ${channel.subscriberCount ?? '—'} subscribers · ${channel.videoCount ?? '—'} videos`
                : 'Sign in with Google to authorize youtube.upload and youtube.readonly'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={onConnectGoogle}
            disabled={busyAction === 'connect-youtube'}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-50 cursor-pointer"
          >
            <Youtube className="w-4 h-4" />
            {busyAction === 'connect-youtube'
              ? 'Connecting...'
              : channel.connected
              ? 'Reconnect Google Account'
              : 'Connect YouTube Channel'}
          </button>

          {serverOAuthConfigured && serverOAuthUrl && (
            <a
              href={serverOAuthUrl}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border border-cyan-500/40 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20"
            >
              <KeyRound className="w-3.5 h-3.5" />
              Authorize Offline Refresh Token
              <ExternalLink className="w-3 h-3" />
            </a>
          )}

          {channel.connected && (
            <>
              <button
                type="button"
                onClick={onSyncStats}
                disabled={busyAction === 'sync-stats'}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-200 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${busyAction === 'sync-stats' ? 'animate-spin' : ''}`} />
                Sync Published Stats
              </button>
              <button
                type="button"
                onClick={onDisconnect}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-700 text-slate-300 hover:text-rose-300 hover:border-rose-500/40 cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                Disconnect
              </button>
            </>
          )}
        </div>
      </div>

      {channel.lastError && (
        <div className="bg-[#0f172a] border border-rose-500/30 rounded-xl p-4 flex items-start gap-3 text-xs text-rose-300">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold">YouTube API Status Alert</div>
            <p className="mt-1">{channel.lastError}</p>
          </div>
        </div>
      )}

      {/* OAuth & API Transparency Notes */}
      <div className="bg-[#0f172a] border border-slate-800 rounded-xl p-5 space-y-2.5 text-xs text-slate-300">
        <div className="font-semibold text-slate-100 text-sm">
          Official YouTube API Integration Details
        </div>
        <ul className="space-y-1.5 text-slate-400 list-disc pl-4">
          <li>
            Uses official <code className="text-slate-200 font-mono">channels.list</code>, resumable{' '}
            <code className="text-slate-200 font-mono">videos.insert</code>, and{' '}
            <code className="text-slate-200 font-mono">videos.list</code> endpoints.
          </li>
          <li>
            If your Google Cloud OAuth app is unverified/in Testing mode, YouTube restricts uploaded videos to <strong className="text-slate-200">Private</strong> until Google App Verification is completed. ShortsPilot reports API restrictions transparently and never fakes uploads.
          </li>
          <li>
            For unattended background scheduling without an active browser session, set{' '}
            <code className="text-slate-200 font-mono">GOOGLE_CLIENT_ID</code> and{' '}
            <code className="text-slate-200 font-mono">GOOGLE_CLIENT_SECRET</code> on the server to store an AES-256-GCM encrypted offline refresh token in SQLite.
          </li>
        </ul>
      </div>
    </div>
  );
}

interface SettingsViewProps {
  snapshot: DashboardSnapshot;
  onSaveSettings: (patch: Partial<SchedulerSettings>) => Promise<void>;
  busyAction: string | null;
}

export function SettingsView({
  snapshot,
  onSaveSettings,
  busyAction,
}: SettingsViewProps) {
  const [form, setForm] = useState<SchedulerSettings>(snapshot.settings);
  const [slotsInput, setSlotsInput] = useState(snapshot.settings.postingSlots.join(', '));

  useEffect(() => {
    setForm(snapshot.settings);
    setSlotsInput(snapshot.settings.postingSlots.join(', '));
  }, [snapshot.settings]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsedSlots = slotsInput
      .split(',')
      .map((s) => s.trim())
      .filter((s) => /^\d{2}:\d{2}$/.test(s));
    await onSaveSettings({
      ...form,
      postingSlots: parsedSlots.length > 0 ? parsedSlots : form.postingSlots,
    });
  };

  return (
    <form onSubmit={handleSave} className="space-y-6">
      {/* Locked Title & Hashtags */}
      <div className="bg-[#0f172a] border border-slate-800 rounded-xl p-5 space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
          <Lock className="w-4 h-4 text-violet-400" />
          Locked Central Channel Metadata
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          <div>
            <label className="block text-slate-400 mb-1">Fixed Short Title &amp; Hashtags</label>
            <input
              type="text"
              readOnly
              value={snapshot.fixedMetadata.title}
              className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-200 font-mono cursor-not-allowed"
            />
          </div>
          <div>
            <label className="block text-slate-400 mb-1">Fixed Description</label>
            <input
              type="text"
              readOnly
              value={snapshot.fixedMetadata.description}
              className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-200 font-mono cursor-not-allowed"
            />
          </div>
        </div>
        <p className="text-[11px] text-slate-500">
          Stored centrally in <code className="font-mono text-slate-300">config/constants.ts</code>. AI analysis and scheduling engines are strictly prevented from altering titles or adding hashtags.
        </p>
      </div>

      {/* Scheduling Configuration */}
      <div className="bg-[#0f172a] border border-slate-800 rounded-xl p-5 space-y-4">
        <h3 className="text-sm font-semibold text-slate-100">
          Daily Batch &amp; Timezone Configuration
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div>
            <label className="block text-slate-400 mb-1">Shorts Per Day</label>
            <input
              type="number"
              min={1}
              max={10}
              value={form.postsPerDay}
              onChange={(e) =>
                setForm((p) => ({
                  ...p,
                  postsPerDay: Number(e.target.value) || 5,
                  dailyBatchSize: Number(e.target.value) || 5,
                }))
              }
              className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 font-mono"
            />
          </div>

          <div>
            <label className="block text-slate-400 mb-1">Timezone (IANA)</label>
            <select
              value={form.timezone}
              onChange={(e) => setForm((p) => ({ ...p, timezone: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 font-mono"
            >
              <option value="America/New_York">America/New_York (Eastern)</option>
              <option value="America/Chicago">America/Chicago (Central)</option>
              <option value="America/Los_Angeles">America/Los_Angeles (Pacific)</option>
              <option value="America/Toronto">America/Toronto (Canada)</option>
              <option value="Australia/Sydney">Australia/Sydney (Australia)</option>
              <option value="UTC">UTC</option>
            </select>
          </div>

          <div>
            <label className="block text-slate-400 mb-1">YouTube Privacy Mode</label>
            <select
              value={form.youtubePrivacyMode}
              onChange={(e) =>
                setForm((p) => ({
                  ...p,
                  youtubePrivacyMode: e.target.value as SchedulerSettings['youtubePrivacyMode'],
                }))
              }
              className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 font-mono"
            >
              <option value="scheduled_private">Private until Scheduled publishAt</option>
              <option value="public">Public immediately</option>
              <option value="unlisted">Unlisted</option>
            </select>
          </div>
        </div>

        <div className="text-xs">
          <label className="block text-slate-400 mb-1">
            Daily Posting Slots (24h HH:MM comma-separated)
          </label>
          <input
            type="text"
            value={slotsInput}
            onChange={(e) => setSlotsInput(e.target.value)}
            placeholder="09:00, 12:00, 15:00, 18:00, 21:00"
            className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 font-mono"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 text-xs">
          <label className="flex items-start gap-3 p-3 rounded-lg bg-slate-900 border border-slate-800 cursor-pointer">
            <input
              type="checkbox"
              checked={form.enableFolderWatcher}
              onChange={(e) =>
                setForm((p) => ({ ...p, enableFolderWatcher: e.target.checked }))
              }
              className="mt-0.5 accent-violet-500"
            />
            <div>
              <div className="text-slate-100 font-medium">
                Auto-Import from <code className="font-mono">shorts/incoming/</code>
              </div>
              <div className="text-slate-400 mt-0.5">
                Automatically detects new MP4/MOV/WebM videos dropped into the local incoming folder.
              </div>
            </div>
          </label>

          <label className="flex items-start gap-3 p-3 rounded-lg bg-slate-900 border border-slate-800 cursor-pointer">
            <input
              type="checkbox"
              checked={form.allowAutoCrop9x16}
              onChange={(e) =>
                setForm((p) => ({ ...p, allowAutoCrop9x16: e.target.checked }))
              }
              className="mt-0.5 accent-violet-500"
            />
            <div>
              <div className="text-slate-100 font-medium">
                Approve Optional 9:16 Aspect Ratio Warning Flag
              </div>
              <div className="text-slate-400 mt-0.5">
                Original video files remain untouched by default.
              </div>
            </div>
          </label>
        </div>
      </div>

      {/* Audience Alignment Note */}
      <div className="bg-[#0f172a] border border-slate-800 rounded-xl p-5 flex items-start justify-between gap-4 text-xs">
        <div className="space-y-1 text-slate-400">
          <div className="text-sm font-semibold text-slate-100 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-cyan-400" />
            Target Schedule Regions: United States, Canada &amp; Australia
          </div>
          <p>
            Default Eastern Time posting windows (9 AM, 12 PM, 3 PM, 6 PM, 9 PM EST) align with North American active viewing hours. Note: posting time and hashtags alone never guarantee algorithmic reach in a specific country.
          </p>
        </div>

        <button
          type="submit"
          disabled={busyAction === 'save-settings'}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-50 cursor-pointer shrink-0"
        >
          <Save className="w-3.5 h-3.5" />
          {busyAction === 'save-settings' ? 'Saving...' : 'Save Settings'}
        </button>
      </div>
    </form>
  );
}
