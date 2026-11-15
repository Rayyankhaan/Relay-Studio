import { useCallback, useEffect, useState } from 'react';
import {
  CalendarClock,
  FolderInput,
  LayoutDashboard,
  Menu,
  Send,
  Upload,
  X,
} from 'lucide-react';
import { DailyDashboardView } from './components/DailyDashboardView.tsx';
import { FolderPipelineView } from './components/FolderPipelineView.tsx';
import { RewardsSubmitView } from './components/RewardsSubmitView.tsx';
import { Tier1ScheduleView } from './components/Tier1ScheduleView.tsx';
import { STUDIO_ASSETS } from './constants/assets.ts';
import {
  connectYoutubeWithGoogle,
  disconnectYoutube,
  getYoutubeAccessToken,
  initYoutubeAuth,
} from './lib/youtubeAuth.ts';
import type {
  AutomationConfig,
  AutomationState,
  Campaign,
  ClipItem,
  YouTubeChannelInfo,
  YouTubeRemoteVideo,
  YoutubePrivacy,
} from './types.ts';

type NavTab = 'dashboard' | 'folder' | 'schedule' | 'rewards';

const NAV_ITEMS: Array<{
  id: NavTab;
  label: string;
  breadcrumb: string;
  icon: typeof LayoutDashboard;
}> = [
  {
    id: 'dashboard',
    label: 'Daily 5-Upload Dashboard',
    breadcrumb: 'Daily 5-Upload Dashboard',
    icon: LayoutDashboard,
  },
  {
    id: 'folder',
    label: 'Watch Folder & Clips',
    breadcrumb: 'Watch Folder Automation',
    icon: FolderInput,
  },
  {
    id: 'schedule',
    label: 'US / CA / AU Schedule',
    breadcrumb: 'US, Canada & Australia Schedule',
    icon: CalendarClock,
  },
  {
    id: 'rewards',
    label: 'Content Rewards Submit',
    breadcrumb: 'Content Rewards Submission',
    icon: Send,
  },
];

export default function App() {
  const [state, setState] = useState<AutomationState | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [noticeBanner, setNoticeBanner] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<NavTab>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);

  // YouTube OAuth + Channel state
  const [ytConnected, setYtConnected] = useState(false);
  const [ytConnecting, setYtConnecting] = useState(false);
  const [ytChannel, setYtChannel] = useState<YouTubeChannelInfo | null>(null);
  const [ytVideos, setYtVideos] = useState<YouTubeRemoteVideo[]>([]);
  const [ytLoadingVideos, setYtLoadingVideos] = useState(false);

  // Confirmation modal state for live YouTube upload
  const [pendingUploadConfirm, setPendingUploadConfirm] = useState<{
    clip: ClipItem;
    youtubeUrl?: string;
    privacyStatus: YoutubePrivacy;
  } | null>(null);

  const [uploading, setUploading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [busyClipId, setBusyClipId] = useState<string | null>(null);
  const [savingConfig, setSavingConfig] = useState(false);
  const [ticking, setTicking] = useState(false);

  const notify = (msg: string) => {
    setNoticeBanner(msg);
    window.setTimeout(() => setNoticeBanner((curr) => (curr === msg ? null : curr)), 5000);
  };

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch('/api/state');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load automation state');
      setState(data as AutomationState);
      setErrorBanner(null);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Unable to connect to server');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadYoutubeData = useCallback(async (token: string) => {
    setYtLoadingVideos(true);
    try {
      const [chRes, vidRes] = await Promise.all([
        fetch('/api/youtube/channel', {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch('/api/youtube/videos', {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);
      const chJson = await chRes.json();
      if (!chRes.ok) throw new Error(chJson.error || 'Failed to load YouTube channel');
      setYtChannel(chJson.channel as YouTubeChannelInfo);

      const vidJson = await vidRes.json();
      if (vidRes.ok && Array.isArray(vidJson.videos)) {
        setYtVideos(vidJson.videos as YouTubeRemoteVideo[]);
      }
      setYtConnected(true);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'YouTube channel sync failed');
    } finally {
      setYtLoadingVideos(false);
    }
  }, []);

  useEffect(() => {
    fetchState();
  }, [fetchState]);

  useEffect(() => {
    const unsub = initYoutubeAuth(
      (_user, token) => {
        setYtConnected(true);
        loadYoutubeData(token);
      },
      () => {
        setYtConnected(false);
        setYtChannel(null);
        setYtVideos([]);
      }
    );
    return () => unsub();
  }, [loadYoutubeData]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      fetchState();
    }, 15000);
    return () => window.clearInterval(timer);
  }, [fetchState]);

  const handleConnectYoutube = async () => {
    setYtConnecting(true);
    setErrorBanner(null);
    try {
      const { accessToken } = await connectYoutubeWithGoogle();
      await loadYoutubeData(accessToken);
      notify('Connected YouTube channel.');
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Google YouTube sign-in failed');
    } finally {
      setYtConnecting(false);
    }
  };

  const handleDisconnectYoutube = async () => {
    await disconnectYoutube();
    setYtConnected(false);
    setYtChannel(null);
    setYtVideos([]);
    notify('Disconnected YouTube account.');
  };

  const handleRefreshYoutube = async () => {
    const token = getYoutubeAccessToken();
    if (!token) {
      setErrorBanner('YouTube session expired. Please sign in with Google again.');
      return;
    }
    await loadYoutubeData(token);
    notify('Synced latest YouTube channel uploads.');
  };

  const handleUploadClips = async (files: FileList | File[]) => {
    setUploading(true);
    setErrorBanner(null);
    try {
      const form = new FormData();
      Array.from(files).forEach((f) => form.append('clips', f));
      const res = await fetch('/api/clips/upload', {
        method: 'POST',
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Clip upload failed');
      setState(data.state);
      notify(
        `Added ${data.addedCount || Array.from(files).length} clip(s) to ${data.state.config.watchFolderPath} and parsed filename titles.`
      );
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Failed to upload clips');
    } finally {
      setUploading(false);
    }
  };

  const handleScanFolder = async () => {
    setScanning(true);
    setErrorBanner(null);
    try {
      const res = await fetch('/api/folder/scan', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Folder scan failed');
      setState(data.state);
      notify(
        data.addedCount > 0
          ? `Detected ${data.addedCount} new clip(s) in watch folder.`
          : 'Watch folder is up to date.'
      );
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Failed to scan folder');
    } finally {
      setScanning(false);
    }
  };

  const handleUpdateClip = async (id: string, patch: Partial<ClipItem>) => {
    try {
      const res = await fetch(`/api/clips/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Update failed');
      setState(data.state);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Failed to update clip');
    }
  };

  const handleDeleteClip = async (id: string) => {
    try {
      const res = await fetch(`/api/clips/${encodeURIComponent(id)}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Delete failed');
      setState(data.state);
      notify('Removed clip from watch folder and queue.');
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Failed to delete clip');
    }
  };

  const executeRunClip = async (
    id: string,
    youtubeUrl?: string,
    privacyStatus?: YoutubePrivacy
  ) => {
    setBusyClipId(id);
    setErrorBanner(null);
    try {
      const token = getYoutubeAccessToken();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      const res = await fetch(`/api/clips/${encodeURIComponent(id)}/run`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ youtubeShortUrl: youtubeUrl, privacyStatus }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Automation failed');
      setState(data.state);
      const link = data.clip?.youtubeShortUrl;
      if (link && navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(link).catch(() => {});
      }
      if (token) {
        loadYoutubeData(token).catch(() => {});
      }
      notify(`Uploaded & submitted ${link || 'Short'} to Content Rewards (link copied).`);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Automation run failed');
    } finally {
      setBusyClipId(null);
    }
  };

  // Show explicit confirmation dialog before uploading directly to user's YouTube channel
  const requestRunClip = async (id: string, youtubeUrl?: string): Promise<void> => {
    const clip = state?.clips.find((c) => c.id === id);
    const token = getYoutubeAccessToken();
    if (clip && token && !youtubeUrl && clip.hasVideoFile) {
      setPendingUploadConfirm({
        clip,
        youtubeUrl,
        privacyStatus: state?.config.defaultPrivacyStatus || 'public',
      });
      return;
    }
    await executeRunClip(id, youtubeUrl);
  };

  const handleSaveConfig = async (patch: Partial<AutomationConfig>) => {
    setSavingConfig(true);
    setErrorBanner(null);
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save config');
      setState(data.state);
      notify('Saved US / CA / AU 5-upload schedule rules.');
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Failed to save rules');
    } finally {
      setSavingConfig(false);
    }
  };

  const handleRunTickNow = async () => {
    setTicking(true);
    setErrorBanner(null);
    try {
      const res = await fetch('/api/pipeline/tick', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Tick failed');
      setState(data.state);
      const count = Array.isArray(data.processedIds) ? data.processedIds.length : 0;
      notify(count > 0 ? `Processed ${count} due clip(s).` : 'No scheduled slots due right now.');
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Tick failed');
    } finally {
      setTicking(false);
    }
  };

  const handleCreateCampaign = async (payload: Partial<Campaign>) => {
    setErrorBanner(null);
    try {
      const res = await fetch('/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to add campaign');
      setState(data.state);
      notify(`Added campaign "${data.campaign.name}".`);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Failed to add campaign');
    }
  };

  const handleUpdateCampaign = async (id: string, patch: Partial<Campaign>) => {
    try {
      const res = await fetch(`/api/campaigns/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Update failed');
      setState(data.state);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Failed to update campaign');
    }
  };

  const handleDeleteCampaign = async (id: string) => {
    try {
      const res = await fetch(`/api/campaigns/${encodeURIComponent(id)}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Delete failed');
      setState(data.state);
      notify('Removed campaign.');
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Failed to delete campaign');
    }
  };

  const currentNav = NAV_ITEMS.find((n) => n.id === activeTab) ?? NAV_ITEMS[0];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex">
      {/* Desktop Left Sidebar */}
      <aside className="hidden lg:flex w-64 shrink-0 flex-col justify-between bg-white border-r border-slate-200">
        <div>
          <div className="h-16 px-6 flex items-center border-b border-slate-200">
            <span className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0">
              Relay Studio
            </span>
          </div>

          <nav className="p-3 flex flex-col gap-1">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-lg transition-colors text-left whitespace-nowrap cursor-pointer ${
                    active
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="p-4 border-t border-slate-200 flex items-center gap-3">
          {ytConnected && ytChannel?.thumbnailUrl ? (
            <img
              src={ytChannel.thumbnailUrl}
              alt={ytChannel.title}
              referrerPolicy="no-referrer"
              className="w-9 h-9 rounded-full object-cover border border-slate-200 shrink-0"
            />
          ) : !avatarFailed ? (
            <img
              src={STUDIO_ASSETS.avatar}
              alt="Creator profile"
              referrerPolicy="no-referrer"
              onError={() => setAvatarFailed(true)}
              className="w-9 h-9 rounded-full object-cover border border-slate-200 shrink-0"
            />
          ) : (
            <div className="w-9 h-9 rounded-full bg-slate-200 text-slate-700 text-xs font-semibold flex items-center justify-center shrink-0">
              RS
            </div>
          )}
          <div className="min-w-0">
            <p className="text-xs font-semibold text-slate-900 truncate">
              {ytConnected && ytChannel ? ytChannel.title : 'YouTube Not Connected'}
            </p>
            <p className="text-[11px] text-slate-500 truncate">
              5/day · US · CA · AU
            </p>
          </div>
        </div>
      </aside>

      {/* Mobile Navigation Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-900/40"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative w-64 max-w-[80vw] bg-white h-full border-r border-slate-200 flex flex-col justify-between z-10">
            <div>
              <div className="h-16 px-5 flex items-center justify-between border-b border-slate-200">
                <span className="text-base font-bold text-slate-900">Relay Studio</span>
                <button
                  type="button"
                  aria-label="Close navigation"
                  onClick={() => setMobileMenuOpen(false)}
                  className="p-1.5 text-slate-500 hover:text-slate-900"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <nav className="p-3 flex flex-col gap-1">
                {NAV_ITEMS.map((item) => {
                  const Icon = item.icon;
                  const active = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setActiveTab(item.id);
                        setMobileMenuOpen(false);
                      }}
                      className={`flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-lg text-left whitespace-nowrap ${
                        active ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </nav>
            </div>
          </aside>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-16 bg-white border-b border-slate-200 px-6 flex items-center justify-between gap-8 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              aria-label="Open menu"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-1.5 text-slate-600 hover:text-slate-900 rounded-md"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm truncate">
              <span className="text-slate-400 hidden sm:inline">Relay Studio</span>
              <span className="text-slate-300 hidden sm:inline">/</span>
              <h1 className="font-semibold text-slate-900 truncate">
                {currentNav.breadcrumb}
              </h1>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setActiveTab('folder')}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg bg-rose-600 text-white hover:bg-rose-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5" />
            Drop Clips
          </button>
        </header>

        <main className="flex-1 p-6 max-w-[1320px] w-full mx-auto flex flex-col gap-5">
          {errorBanner && (
            <div className="px-4 py-3 text-xs font-medium bg-rose-50 border border-rose-200 text-rose-800 rounded-lg flex items-center justify-between gap-4">
              <span>{errorBanner}</span>
              <button
                type="button"
                onClick={() => setErrorBanner(null)}
                className="text-rose-700 hover:text-rose-900 underline shrink-0 cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          )}

          {noticeBanner && (
            <div className="px-4 py-3 text-xs font-medium bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg flex items-center justify-between gap-4">
              <span>{noticeBanner}</span>
              <button
                type="button"
                onClick={() => setNoticeBanner(null)}
                className="text-emerald-700 hover:text-emerald-900 underline shrink-0 cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          )}

          {loading || !state ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {[0, 1, 2, 3].map((k) => (
                <div
                  key={k}
                  className="h-28 bg-white border border-slate-200 rounded-lg animate-pulse p-5"
                />
              ))}
            </div>
          ) : (
            <>
              {activeTab === 'dashboard' && (
                <DailyDashboardView
                  state={state}
                  ytConnected={ytConnected}
                  ytConnecting={ytConnecting}
                  ytChannel={ytChannel}
                  ytVideos={ytVideos}
                  ytLoadingVideos={ytLoadingVideos}
                  onConnectYoutube={handleConnectYoutube}
                  onDisconnectYoutube={handleDisconnectYoutube}
                  onRefreshYoutube={handleRefreshYoutube}
                  onRequestUploadClip={(clip) => requestRunClip(clip.id)}
                  onGoToFolder={() => setActiveTab('folder')}
                  busyClipId={busyClipId}
                />
              )}

              {activeTab === 'folder' && (
                <FolderPipelineView
                  state={state}
                  onUploadClips={handleUploadClips}
                  onScanFolder={handleScanFolder}
                  onUpdateClip={handleUpdateClip}
                  onDeleteClip={handleDeleteClip}
                  onRunClip={requestRunClip}
                  uploading={uploading}
                  scanning={scanning}
                  busyClipId={busyClipId}
                />
              )}

              {activeTab === 'schedule' && (
                <Tier1ScheduleView
                  state={state}
                  onSaveConfig={handleSaveConfig}
                  onRunTickNow={handleRunTickNow}
                  saving={savingConfig}
                  ticking={ticking}
                />
              )}

              {activeTab === 'rewards' && (
                <RewardsSubmitView
                  state={state}
                  onCreateCampaign={handleCreateCampaign}
                  onUpdateCampaign={handleUpdateCampaign}
                  onDeleteCampaign={handleDeleteCampaign}
                  onRunClip={requestRunClip}
                  busyClipId={busyClipId}
                />
              )}
            </>
          )}
        </main>
      </div>

      {/* Explicit Confirmation Modal for Live YouTube Channel Upload */}
      {pendingUploadConfirm && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-lg max-w-md w-full p-6 flex flex-col gap-4 shadow-lg">
            <div>
              <h3 className="text-base font-semibold text-slate-900">
                Confirm Upload to YouTube
              </h3>
              <p className="text-xs text-slate-600 mt-1">
                This will upload the video file to your connected YouTube channel (
                <span className="font-medium text-slate-900">
                  {ytChannel?.title || 'Connected Channel'}
                </span>
                ) and automatically submit the live Short URL to Content Rewards.
              </p>
            </div>

            <div className="p-3 bg-slate-50 border border-slate-200 rounded-md text-xs flex flex-col gap-1.5">
              <div>
                <span className="text-slate-500">Short Title: </span>
                <span className="font-medium text-slate-900">
                  {pendingUploadConfirm.clip.shortTitle}
                </span>
              </div>
              <div>
                <span className="text-slate-500">Hashtags: </span>
                <span className="font-mono text-slate-700">
                  {pendingUploadConfirm.clip.hashtags.join(' ')}
                </span>
              </div>
              <div>
                <span className="text-slate-500">Audience: </span>
                <span className="font-mono text-slate-700">
                  {pendingUploadConfirm.clip.targetRegions.join(' · ')}
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-slate-700">
                YouTube Visibility
              </label>
              <select
                value={pendingUploadConfirm.privacyStatus}
                onChange={(e) =>
                  setPendingUploadConfirm((prev) =>
                    prev
                      ? { ...prev, privacyStatus: e.target.value as YoutubePrivacy }
                      : null
                  )
                }
                className="px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg text-slate-900"
              >
                <option value="public">Public</option>
                <option value="unlisted">Unlisted</option>
                <option value="private">Private</option>
              </select>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setPendingUploadConfirm(null)}
                className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const { clip, youtubeUrl, privacyStatus } = pendingUploadConfirm;
                  setPendingUploadConfirm(null);
                  executeRunClip(clip.id, youtubeUrl, privacyStatus);
                }}
                className="px-4 py-2 text-xs font-medium rounded-lg bg-rose-600 text-white hover:bg-rose-700 cursor-pointer"
              >
                Upload &amp; Submit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
