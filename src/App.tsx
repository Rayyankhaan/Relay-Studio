import {
  BarChart3,
  Calendar,
  Film,
  LayoutDashboard,
  ListOrdered,
  Lock,
  Menu,
  Music2,
  Send,
  Settings,
  UploadCloud,
  X,
  Youtube,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { AnalyticsView } from './components/AnalyticsView.tsx';
import { CalendarView } from './components/CalendarView.tsx';
import {
  SettingsView,
  YouTubeChannelView,
} from './components/ChannelAndSettingsView.tsx';
import { OverviewView } from './components/OverviewView.tsx';
import { PublishingQueueView } from './components/PublishingQueueView.tsx';
import { TrendingAudioView } from './components/TrendingAudioView.tsx';
import { UploadShortsView } from './components/UploadShortsView.tsx';
import { VideoLibraryView } from './components/VideoLibraryView.tsx';
import {
  getLocalVideoBlob,
  safeFetchJson,
  uploadBlobDirectlyToYouTube,
} from './lib/clipStorage.ts';
import {
  connectYoutubeWithGoogle,
  disconnectYoutube,
  getYoutubeAccessToken,
  initYoutubeAuth,
} from './lib/youtubeAuth.ts';
import type {
  AnalyticsReport,
  DashboardSnapshot,
  SchedulerSettings,
  VideoRecord,
} from './types.ts';

type NavId =
  | 'overview'
  | 'upload'
  | 'library'
  | 'queue'
  | 'calendar'
  | 'audio'
  | 'analytics'
  | 'channel'
  | 'settings';

const NAV_ITEMS: Array<{ id: NavId; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'upload', label: 'Upload Shorts', icon: UploadCloud },
  { id: 'library', label: 'Video Library', icon: Film },
  { id: 'queue', label: 'Publishing Queue', icon: ListOrdered },
  { id: 'calendar', label: 'Calendar', icon: Calendar },
  { id: 'audio', label: 'Trending Audio', icon: Music2 },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'channel', label: 'YouTube Channel', icon: Youtube },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<NavId>('overview');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [authChecked, setAuthChecked] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);

  const [accessToken, setAccessToken] = useState<string | null>(() =>
    getYoutubeAccessToken()
  );
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [analyticsReport, setAnalyticsReport] = useState<AnalyticsReport | null>(null);

  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [busyVideoId, setBusyVideoId] = useState<string | null>(null);
  const [banner, setBanner] = useState<{
    message: string;
    level: 'success' | 'error' | 'info';
  } | null>(null);

  // Explicit YouTube upload confirmation modal state
  const [confirmPublishVideo, setConfirmPublishVideo] = useState<VideoRecord | null>(null);
  const [confirmUseSchedule, setConfirmUseSchedule] = useState(true);

  const notify = useCallback(
    (message: string, level: 'success' | 'error' | 'info' = 'info') => {
      setBanner({ message, level });
    },
    []
  );

  const authHeaders = useCallback((): HeadersInit => {
    const token = accessToken || getYoutubeAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, [accessToken]);

  const loadSnapshot = useCallback(async () => {
    const data = await safeFetchJson<DashboardSnapshot>('/api/snapshot', {
      headers: authHeaders(),
    });
    setSnapshot(data);
  }, [authHeaders]);

  const checkSessionAndBoot = useCallback(async () => {
    try {
      const session = await safeFetchJson<{
        authRequired: boolean;
        authenticated: boolean;
      }>('/api/auth/session');
      setAuthRequired(session.authRequired);
      setAuthenticated(session.authenticated);
      setAuthChecked(true);
      if (session.authenticated) {
        await loadSnapshot();
      }
    } catch (err) {
      setAuthChecked(true);
      notify(err instanceof Error ? err.message : 'Failed to reach server.', 'error');
    }
  }, [loadSnapshot, notify]);

  useEffect(() => {
    checkSessionAndBoot();
    const unsub = initYoutubeAuth(
      (_user, token) => {
        setAccessToken(token);
      },
      () => {
        setAccessToken(null);
      }
    );
    return () => unsub();
  }, [checkSessionAndBoot]);

  useEffect(() => {
    if (authenticated) {
      loadSnapshot().catch(() => {});
    }
  }, [accessToken, authenticated, loadSnapshot]);

  // Poll server snapshot every 20 seconds when authenticated
  useEffect(() => {
    if (!authenticated) return;
    const timer = setInterval(() => {
      loadSnapshot().catch(() => {});
    }, 20000);
    return () => clearInterval(timer);
  }, [authenticated, loadSnapshot]);

  const handleDashboardLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    try {
      await safeFetchJson('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: passwordInput }),
      });
      setAuthenticated(true);
      setPasswordInput('');
      await loadSnapshot();
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : 'Login failed.');
    }
  };

  const handleConnectYouTube = async () => {
    setBusyAction('connect-youtube');
    try {
      const res = await connectYoutubeWithGoogle();
      setAccessToken(res.accessToken);
      await loadSnapshot();
      notify('YouTube channel connected via Google OAuth.', 'success');
    } catch (err) {
      notify(
        err instanceof Error ? err.message : 'Google OAuth sign-in failed.',
        'error'
      );
    } finally {
      setBusyAction(null);
    }
  };

  const handleDisconnectYouTube = async () => {
    setBusyAction('disconnect-youtube');
    try {
      await disconnectYoutube();
      await safeFetchJson('/api/youtube/disconnect', { method: 'POST' });
      setAccessToken(null);
      await loadSnapshot();
      notify('Disconnected YouTube channel.', 'info');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Disconnect failed.', 'error');
    } finally {
      setBusyAction(null);
    }
  };

  const handleSyncStats = async () => {
    setBusyAction('sync-stats');
    try {
      const res = await safeFetchJson<{ updatedCount: number }>(
        '/api/youtube/sync-stats',
        { method: 'POST', headers: authHeaders() }
      );
      await loadSnapshot();
      notify(`Synced real YouTube metrics for ${res.updatedCount} Short(s).`, 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Stats sync failed.', 'error');
    } finally {
      setBusyAction(null);
    }
  };

  const handleLoadAnalytics = async () => {
    setBusyAction('load-analytics');
    try {
      const report = await safeFetchJson<AnalyticsReport>('/api/youtube/analytics', {
        headers: authHeaders(),
      });
      setAnalyticsReport(report);
      if (report.available) {
        notify('Loaded live YouTube Analytics API report.', 'success');
      } else {
        notify(report.reason || 'Analytics API scope not authorized.', 'info');
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to load analytics.', 'error');
    } finally {
      setBusyAction(null);
    }
  };

  const handleToggleScheduler = async (pause: boolean) => {
    setBusyAction('toggle-scheduler');
    try {
      await safeFetchJson(pause ? '/api/scheduler/pause' : '/api/scheduler/resume', {
        method: 'POST',
      });
      await loadSnapshot();
      notify(pause ? 'Publishing scheduler paused.' : 'Publishing scheduler resumed.', 'info');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Scheduler toggle failed.', 'error');
    } finally {
      setBusyAction(null);
    }
  };

  const handleAnalyzeVideo = async (videoId: string) => {
    setBusyVideoId(videoId);
    try {
      await safeFetchJson(`/api/videos/${videoId}/analyze`, { method: 'POST' });
      await loadSnapshot();
      notify('AI meme safety & audio mood check complete.', 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'AI analysis failed.', 'error');
    } finally {
      setBusyVideoId(null);
    }
  };

  const handleDeleteVideo = async (videoId: string) => {
    setBusyVideoId(videoId);
    try {
      await safeFetchJson(`/api/videos/${videoId}`, { method: 'DELETE' });
      await loadSnapshot();
      notify('Removed unpublished video from queue.', 'info');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Delete failed.', 'error');
    } finally {
      setBusyVideoId(null);
    }
  };

  const handleReschedule = async (videoId: string, scheduledAtIso: string) => {
    setBusyVideoId(videoId);
    try {
      await safeFetchJson(`/api/videos/${videoId}/reschedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduledAt: scheduledAtIso }),
      });
      await loadSnapshot();
      notify('Updated scheduled slot.', 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Reschedule failed.', 'error');
    } finally {
      setBusyVideoId(null);
    }
  };

  const handleRetryVideo = async (videoId: string) => {
    setBusyVideoId(videoId);
    try {
      await safeFetchJson(`/api/videos/${videoId}/retry`, { method: 'POST' });
      await loadSnapshot();
      notify('Video moved back into scheduled queue.', 'info');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Retry failed.', 'error');
    } finally {
      setBusyVideoId(null);
    }
  };

  const handleRunTick = async () => {
    setBusyAction('tick');
    try {
      const res = await safeFetchJson<{
        scanned: number;
        attempted: number;
        published: number;
      }>('/api/scheduler/tick', { method: 'POST' });
      await loadSnapshot();
      notify(
        `Tick finished: ${res.scanned} imported, ${res.published}/${res.attempted} published.`,
        'info'
      );
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Tick failed.', 'error');
    } finally {
      setBusyAction(null);
    }
  };

  const executeConfirmedPublish = async () => {
    if (!confirmPublishVideo || !snapshot) return;
    const video = confirmPublishVideo;
    const useSchedule = confirmUseSchedule;
    setConfirmPublishVideo(null);
    setBusyVideoId(video.id);

    try {
      // If stored in browser IndexedDB (Vercel large-file fallback), upload directly from browser
      if (!video.hasLocalFile) {
        const token = accessToken || getYoutubeAccessToken();
        if (!token) {
          throw new Error('Connect your YouTube channel before publishing.');
        }
        const blob = await getLocalVideoBlob(video.id);
        if (!blob) {
          throw new Error('Browser-cached video blob not found. Re-upload the video.');
        }
        try {
          const uploaded = await uploadBlobDirectlyToYouTube({
            accessToken: token,
            blob,
            privacyStatus:
              snapshot.settings.youtubePrivacyMode === 'scheduled_private'
                ? 'private'
                : snapshot.settings.youtubePrivacyMode,
            publishAtIso: useSchedule ? video.scheduledAt : null,
          });
          await safeFetchJson(`/api/videos/${video.id}/direct-result`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              youtubeVideoId: uploaded.youtubeVideoId,
              youtubeUrl: uploaded.youtubeUrl,
              privacyStatus: uploaded.privacyApplied,
            }),
          });
          notify(`Published to YouTube: ${uploaded.youtubeUrl}`, 'success');
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : 'Direct YouTube upload failed.';
          await safeFetchJson(`/api/videos/${video.id}/direct-result`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ errorMessage: errMsg }),
          });
          throw err;
        }
      } else {
        const updated = await safeFetchJson<VideoRecord>(
          `/api/videos/${video.id}/publish`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...authHeaders(),
            },
            body: JSON.stringify({ useScheduledPublishAt: useSchedule }),
          }
        );
        notify(`Published to YouTube: ${updated.youtubeUrl}`, 'success');
      }
      await loadSnapshot();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'YouTube upload failed.', 'error');
      await loadSnapshot().catch(() => {});
    } finally {
      setBusyVideoId(null);
    }
  };

  const handleResearchAudio = async (focusTopic?: string) => {
    setBusyAction('research-audio');
    try {
      await safeFetchJson('/api/audio/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ focusTopic }),
      });
      await loadSnapshot();
      notify('Updated trending meme audio list from live search.', 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Audio research failed.', 'error');
    } finally {
      setBusyAction(null);
    }
  };

  const handleSaveSettings = async (patch: Partial<SchedulerSettings>) => {
    setBusyAction('save-settings');
    try {
      await safeFetchJson('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      await loadSnapshot();
      notify('Settings saved.', 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to save settings.', 'error');
    } finally {
      setBusyAction(null);
    }
  };

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-[#090d16] text-slate-300 flex items-center justify-center text-xs font-mono">
        Loading ShortsPilot – Xavier Memes...
      </div>
    );
  }

  if (authRequired && !authenticated) {
    return (
      <div className="min-h-screen bg-[#090d16] flex items-center justify-center p-4">
        <form
          onSubmit={handleDashboardLogin}
          className="w-full max-w-sm bg-[#0f172a] border border-slate-800 rounded-xl p-6 space-y-4"
        >
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-violet-500/15 border border-violet-500/30 flex items-center justify-center">
              <Lock className="w-4 h-4 text-violet-400" />
            </div>
            <div>
              <h1 className="text-base font-semibold text-slate-100">
                ShortsPilot – Xavier Memes
              </h1>
              <p className="text-xs text-slate-400">Dashboard password required</p>
            </div>
          </div>

          <input
            type="password"
            value={passwordInput}
            onChange={(e) => setPasswordInput(e.target.value)}
            placeholder="Enter dashboard password"
            className="w-full px-3 py-2 text-xs rounded-lg bg-slate-900 border border-slate-700 text-slate-100 focus:outline-none focus:border-violet-500"
            autoFocus
          />
          {loginError && <p className="text-xs text-rose-400">{loginError}</p>}

          <button
            type="submit"
            className="w-full py-2 text-xs font-medium rounded-lg bg-violet-600 hover:bg-violet-500 text-white cursor-pointer"
          >
            Unlock Automation Dashboard
          </button>
        </form>
      </div>
    );
  }

  const activeNav = NAV_ITEMS.find((n) => n.id === activeTab)!;

  return (
    <div className="min-h-screen bg-[#090d16] text-slate-100 flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex w-64 shrink-0 bg-[#0c1220] border-r border-slate-800 flex-col justify-between">
        <div>
          <div className="px-5 py-5 border-b border-slate-800">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-600 to-cyan-500 flex items-center justify-center text-white font-bold text-sm">
                XP
              </div>
              <div className="min-w-0">
                <div className="text-sm font-bold text-slate-100 truncate">ShortsPilot</div>
                <div className="text-[11px] text-cyan-400 font-mono truncate">
                  Xavier Memes
                </div>
              </div>
            </div>
          </div>

          <nav className="p-3 space-y-1">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = item.id === activeTab;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                    isActive
                      ? 'bg-violet-600/20 text-violet-300 border border-violet-500/30'
                      : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/60 border border-transparent'
                  }`}
                >
                  <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-violet-400' : ''}`} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="p-4 border-t border-slate-800 space-y-2 text-[11px]">
          <div className="text-slate-500 uppercase tracking-wider font-medium">
            Fixed Metadata
          </div>
          <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 font-mono text-slate-300 leading-relaxed break-words">
            {snapshot?.fixedMetadata.title ||
              'Xavier memes funny #memes #xavier #xaviermemes'}
          </div>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-black/70"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative w-64 bg-[#0c1220] border-r border-slate-800 p-4 flex flex-col justify-between z-10">
            <div>
              <div className="flex items-center justify-between pb-4 border-b border-slate-800">
                <span className="text-sm font-bold text-slate-100">
                  ShortsPilot · Xavier Memes
                </span>
                <button
                  type="button"
                  onClick={() => setMobileMenuOpen(false)}
                  className="p-1 text-slate-400"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <nav className="mt-3 space-y-1">
                {NAV_ITEMS.map((item) => {
                  const Icon = item.icon;
                  const isActive = item.id === activeTab;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setActiveTab(item.id);
                        setMobileMenuOpen(false);
                      }}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-medium cursor-pointer ${
                        isActive
                          ? 'bg-violet-600/20 text-violet-300 border border-violet-500/30'
                          : 'text-slate-400 hover:text-slate-100'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </nav>
            </div>
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Bar */}
        <header className="h-14 border-b border-slate-800 bg-[#0c1220]/80 px-4 lg:px-6 flex items-center justify-between gap-4 sticky top-0 z-20 backdrop-blur-sm">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-1.5 rounded-lg border border-slate-800 text-slate-300"
              aria-label="Open menu"
            >
              <Menu className="w-4 h-4" />
            </button>
            <div className="text-xs text-slate-400 truncate">
              <span className="hidden sm:inline">ShortsPilot / Xavier Memes / </span>
              <span className="text-slate-100 font-semibold">{activeNav.label}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {!snapshot?.channel.connected ? (
              <button
                type="button"
                onClick={() => setActiveTab('channel')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-200 cursor-pointer whitespace-nowrap"
              >
                <Youtube className="w-3.5 h-3.5 text-rose-400" />
                Connect YouTube
              </button>
            ) : (
              <span className="hidden sm:inline-flex items-center gap-1.5 text-xs font-mono text-emerald-400">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                {snapshot.channel.channelTitle}
              </span>
            )}
            <button
              type="button"
              onClick={() => setActiveTab('upload')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-violet-600 hover:bg-violet-500 text-white cursor-pointer whitespace-nowrap"
            >
              <UploadCloud className="w-3.5 h-3.5" />
              Upload Shorts
            </button>
          </div>
        </header>

        {/* Status Toast Banner */}
        {banner && (
          <div
            className={`mx-4 lg:mx-6 mt-4 px-4 py-2.5 rounded-lg border flex items-center justify-between gap-3 text-xs ${
              banner.level === 'error'
                ? 'bg-rose-500/10 border-rose-500/40 text-rose-200'
                : banner.level === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-200'
                : 'bg-cyan-500/10 border-cyan-500/40 text-cyan-200'
            }`}
          >
            <span>{banner.message}</span>
            <button
              type="button"
              onClick={() => setBanner(null)}
              className="text-current opacity-70 hover:opacity-100 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Active View Viewport */}
        <main className="flex-1 p-4 lg:p-6 max-w-7xl w-full mx-auto">
          {!snapshot ? (
            <div className="space-y-4">
              <div className="h-28 rounded-xl bg-slate-900 border border-slate-800 animate-pulse" />
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {[1, 2, 3, 4].map((n) => (
                  <div
                    key={n}
                    className="h-24 rounded-xl bg-slate-900 border border-slate-800 animate-pulse"
                  />
                ))}
              </div>
            </div>
          ) : (
            <>
              {activeTab === 'overview' && (
                <OverviewView
                  snapshot={snapshot}
                  onNavigate={(tab) => setActiveTab(tab as NavId)}
                  onToggleScheduler={handleToggleScheduler}
                  onSyncStats={handleSyncStats}
                  busyAction={busyAction}
                />
              )}
              {activeTab === 'upload' && (
                <UploadShortsView
                  snapshot={snapshot}
                  onUploadComplete={loadSnapshot}
                  onNotify={notify}
                  onNavigate={(tab) => setActiveTab(tab as NavId)}
                />
              )}
              {activeTab === 'library' && (
                <VideoLibraryView
                  snapshot={snapshot}
                  onAnalyzeVideo={handleAnalyzeVideo}
                  onDeleteVideo={handleDeleteVideo}
                  onRequestPublish={(v) => {
                    setConfirmUseSchedule(true);
                    setConfirmPublishVideo(v);
                  }}
                  onNavigate={(tab) => setActiveTab(tab as NavId)}
                  busyVideoId={busyVideoId}
                />
              )}
              {activeTab === 'queue' && (
                <PublishingQueueView
                  snapshot={snapshot}
                  onToggleScheduler={handleToggleScheduler}
                  onReschedule={handleReschedule}
                  onRetry={handleRetryVideo}
                  onDelete={handleDeleteVideo}
                  onRequestPublish={(v) => {
                    setConfirmUseSchedule(true);
                    setConfirmPublishVideo(v);
                  }}
                  onRunTick={handleRunTick}
                  busyVideoId={busyVideoId}
                />
              )}
              {activeTab === 'calendar' && (
                <CalendarView
                  snapshot={snapshot}
                  onNavigate={(tab) => setActiveTab(tab as NavId)}
                />
              )}
              {activeTab === 'audio' && (
                <TrendingAudioView
                  snapshot={snapshot}
                  onResearchAudio={handleResearchAudio}
                  busyAction={busyAction}
                />
              )}
              {activeTab === 'analytics' && (
                <AnalyticsView
                  snapshot={snapshot}
                  report={analyticsReport}
                  onRefreshAnalytics={handleLoadAnalytics}
                  onSyncStats={handleSyncStats}
                  busyAction={busyAction}
                />
              )}
              {activeTab === 'channel' && (
                <YouTubeChannelView
                  snapshot={snapshot}
                  onConnectGoogle={handleConnectYouTube}
                  onDisconnect={handleDisconnectYouTube}
                  onSyncStats={handleSyncStats}
                  busyAction={busyAction}
                />
              )}
              {activeTab === 'settings' && (
                <SettingsView
                  snapshot={snapshot}
                  onSaveSettings={handleSaveSettings}
                  busyAction={busyAction}
                />
              )}
            </>
          )}
        </main>
      </div>

      {/* Explicit YouTube Upload Confirmation Modal */}
      {confirmPublishVideo && snapshot && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="bg-[#0f172a] border border-slate-700 rounded-xl max-w-md w-full p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-slate-100">
                  Confirm YouTube API Upload
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  This will upload the Short via official YouTube Data API v3 (`videos.insert`).
                </p>
              </div>
              <button
                type="button"
                onClick={() => setConfirmPublishVideo(null)}
                className="text-slate-400 hover:text-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-lg p-3.5 space-y-2 text-xs">
              <div>
                <span className="text-slate-400">Video File: </span>
                <span className="text-slate-100 font-medium">
                  {confirmPublishVideo.originalFileName}
                </span>
              </div>
              <div>
                <span className="text-slate-400">Locked Title &amp; Hashtags: </span>
                <span className="text-cyan-400 font-mono">
                  {snapshot.fixedMetadata.title}
                </span>
              </div>
              <div>
                <span className="text-slate-400">Target Channel: </span>
                <span className="text-slate-100">
                  {snapshot.channel.channelTitle || 'Connected Google YouTube Channel'}
                </span>
              </div>
            </div>

            {confirmPublishVideo.scheduledAt &&
              new Date(confirmPublishVideo.scheduledAt).getTime() > Date.now() + 60_000 && (
                <label className="flex items-start gap-2.5 text-xs text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={confirmUseSchedule}
                    onChange={(e) => setConfirmUseSchedule(e.target.checked)}
                    className="mt-0.5 accent-violet-500"
                  />
                  <span>
                    Upload as <strong>Private</strong> and schedule automatic YouTube publication at{' '}
                    <span className="font-mono text-cyan-400">
                      {new Date(confirmPublishVideo.scheduledAt).toLocaleString('en-US', {
                        timeZone: snapshot.settings.timezone,
                      })}
                    </span>
                  </span>
                </label>
              )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmPublishVideo(null)}
                className="px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={executeConfirmedPublish}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg bg-violet-600 hover:bg-violet-500 text-white cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                Confirm &amp; Upload
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
