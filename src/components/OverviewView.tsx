import {
  AlertTriangle,
  ArrowUpRight,
  CalendarClock,
  CheckCircle2,
  Film,
  Pause,
  Play,
  RefreshCw,
  Upload,
  Youtube,
} from 'lucide-react';
import type { DashboardSnapshot, VideoRecord } from '../types.ts';

interface OverviewViewProps {
  snapshot: DashboardSnapshot;
  onNavigate: (tab: string) => void;
  onToggleScheduler: (pause: boolean) => Promise<void>;
  onSyncStats: () => Promise<void>;
  busyAction: string | null;
}

export function OverviewView({
  snapshot,
  onNavigate,
  onToggleScheduler,
  onSyncStats,
  busyAction,
}: OverviewViewProps) {
  const { videos, logs, settings, channel } = snapshot;

  const waiting = videos.filter(
    (v) => v.folderStage === 'scheduled' || v.folderStage === 'incoming' || v.folderStage === 'processing'
  );
  const published = videos.filter((v) => v.folderStage === 'published');
  const failed = videos.filter((v) => v.folderStage === 'failed');

  const totalViews = published.reduce((s, v) => s + (v.views ?? 0), 0);
  const totalLikes = published.reduce((s, v) => s + (v.likes ?? 0), 0);
  const totalComments = published.reduce((s, v) => s + (v.comments ?? 0), 0);

  // Today's 5-short batch progress in configured timezone
  const tz = settings.timezone || 'America/New_York';
  const todayKey = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

  const publishedToday = published.filter((v) => {
    if (!v.publishedAt) return false;
    const dKey = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(v.publishedAt));
    return dKey === todayKey;
  }).length;

  const scheduledToday = waiting.filter((v) => {
    if (!v.scheduledAt) return false;
    const dKey = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(v.scheduledAt));
    return dKey === todayKey;
  }).length;

  const dailyGoal = Math.max(1, settings.dailyBatchSize || 5);
  const batchPct = Math.min(100, Math.round(((publishedToday + scheduledToday) / dailyGoal) * 100));

  // Real 7-day breakdown from stored videos
  const days = Array.from({ length: 7 }, (_, i) => {
    const dt = new Date(Date.now() + (i - 2) * 86400_000);
    const key = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(dt);
    const label = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      month: 'short',
      day: 'numeric',
    }).format(dt);
    const dayPublished = published.filter((v) => {
      if (!v.publishedAt) return false;
      return (
        new Intl.DateTimeFormat('en-CA', {
          timeZone: tz,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(new Date(v.publishedAt)) === key
      );
    }).length;
    const dayScheduled = waiting.filter((v) => {
      if (!v.scheduledAt) return false;
      return (
        new Intl.DateTimeFormat('en-CA', {
          timeZone: tz,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(new Date(v.scheduledAt)) === key
      );
    }).length;
    return { key, label, dayPublished, dayScheduled, isToday: key === todayKey };
  });

  const nextScheduled: VideoRecord | undefined = [...waiting]
    .filter((v) => v.scheduledAt)
    .sort(
      (a, b) =>
        new Date(a.scheduledAt || 0).getTime() - new Date(b.scheduledAt || 0).getTime()
    )[0];

  return (
    <div className="space-y-6">
      {/* Top Channel & Scheduler Status Strip */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-[#0f172a] border border-slate-800 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            {channel.profileImageUrl ? (
              <img
                src={channel.profileImageUrl}
                alt={channel.channelTitle || 'Xavier Memes'}
                className="w-12 h-12 rounded-lg object-cover border border-slate-700 shrink-0"
              />
            ) : (
              <div className="w-12 h-12 rounded-lg bg-violet-500/10 border border-violet-500/30 flex items-center justify-center shrink-0">
                <Youtube className="w-6 h-6 text-violet-400" />
              </div>
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <span
                  className={`w-2 h-2 rounded-full ${
                    channel.connected ? 'bg-emerald-500' : 'bg-amber-500'
                  }`}
                />
                <span>
                  {channel.connected
                    ? `YouTube Connected · ${channel.authMode === 'refresh_token' ? 'Offline Refresh Token' : 'Google OAuth'}`
                    : 'YouTube Channel Not Connected'}
                </span>
              </div>
              <h2 className="text-lg font-semibold text-slate-100 truncate mt-0.5">
                {channel.channelTitle || 'Xavier Memes'}
              </h2>
              <p className="text-xs text-slate-400 font-mono tabular-nums truncate">
                {channel.connected
                  ? `${channel.channelHandle || channel.channelId} · ${channel.subscriberCount ?? '—'} subscribers`
                  : 'Connect your YouTube channel to enable official API publishing'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {channel.connected ? (
              <button
                type="button"
                onClick={onSyncStats}
                disabled={busyAction === 'sync-stats'}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800 disabled:opacity-50 transition-colors cursor-pointer whitespace-nowrap"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${busyAction === 'sync-stats' ? 'animate-spin' : ''}`}
                />
                Sync Stats
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onNavigate('channel')}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg bg-violet-600 hover:bg-violet-500 text-white transition-colors cursor-pointer whitespace-nowrap"
              >
                <Youtube className="w-3.5 h-3.5" />
                Connect Channel
              </button>
            )}
            <button
              type="button"
              onClick={() => onToggleScheduler(!settings.schedulerPaused)}
              disabled={busyAction === 'toggle-scheduler'}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border transition-colors cursor-pointer whitespace-nowrap ${
                settings.schedulerPaused
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'
                  : 'border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20'
              }`}
            >
              {settings.schedulerPaused ? (
                <>
                  <Play className="w-3.5 h-3.5" />
                  Resume Queue
                </>
              ) : (
                <>
                  <Pause className="w-3.5 h-3.5" />
                  Pause Queue
                </>
              )}
            </button>
          </div>
        </div>

        {/* Daily 5-Short Batch Tracker */}
        <div className="bg-[#0f172a] border border-slate-800 rounded-xl p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Today&apos;s 5-Short Batch</span>
            <span className="font-mono tabular-nums text-cyan-400">
              {publishedToday + scheduledToday}/{dailyGoal} filled
            </span>
          </div>
          <div className="mt-3">
            <div className="w-full h-2 bg-slate-900 rounded-sm overflow-hidden border border-slate-800">
              <div
                className="h-full bg-gradient-to-r from-violet-500 to-cyan-400 transition-all duration-300"
                style={{ width: `${batchPct}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-xs text-slate-400 mt-2.5 font-mono tabular-nums">
              <span>{publishedToday} published today</span>
              <span>{scheduledToday} queued today</span>
            </div>
          </div>
          <p className="text-[11px] text-slate-500 mt-3 truncate">
            Fixed Title: <span className="text-slate-300">{snapshot.fixedMetadata.title}</span>
          </p>
        </div>
      </div>

      {/* KPI Metric Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        {[
          { label: 'Total Uploaded', value: videos.length, accent: 'text-slate-100' },
          { label: 'Waiting / Queued', value: waiting.length, accent: 'text-cyan-400' },
          { label: 'Published', value: published.length, accent: 'text-emerald-400' },
          { label: 'Failed', value: failed.length, accent: failed.length > 0 ? 'text-rose-400' : 'text-slate-400' },
          { label: 'Total Views', value: totalViews.toLocaleString(), accent: 'text-slate-100' },
          { label: 'Likes', value: totalLikes.toLocaleString(), accent: 'text-violet-400' },
          { label: 'Comments', value: totalComments.toLocaleString(), accent: 'text-slate-200' },
        ].map((kpi) => (
          <div
            key={kpi.label}
            className="bg-[#0f172a] border border-slate-800 rounded-xl p-4"
          >
            <div className="text-[11px] uppercase tracking-wider text-slate-400 font-medium">
              {kpi.label}
            </div>
            <div className={`text-2xl font-semibold font-mono tabular-nums mt-1.5 ${kpi.accent}`}>
              {kpi.value}
            </div>
          </div>
        ))}
      </div>

      {/* 7-Day Queue Distribution + Next Slot */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-[#0f172a] border border-slate-800 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-100">
                7-Day Publishing Window ({tz})
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Daily slots: {settings.postingSlots.join(' · ')}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('calendar')}
              className="text-xs text-cyan-400 hover:text-cyan-300 inline-flex items-center gap-1 cursor-pointer"
            >
              Open Calendar
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-2 items-end h-36 pt-4">
            {days.map((d) => {
              const total = d.dayPublished + d.dayScheduled;
              const pubH = Math.min(100, Math.round((d.dayPublished / dailyGoal) * 100));
              const schH = Math.min(100 - pubH, Math.round((d.dayScheduled / dailyGoal) * 100));
              return (
                <div key={d.key} className="flex flex-col items-center gap-1.5 h-full justify-end">
                  <span className="text-[11px] font-mono tabular-nums text-slate-400">
                    {total}/{dailyGoal}
                  </span>
                  <div className="w-full max-w-[38px] h-20 bg-slate-900 border border-slate-800 rounded-md overflow-hidden flex flex-col justify-end">
                    {d.dayScheduled > 0 && (
                      <div
                        className="w-full bg-violet-500/80"
                        style={{ height: `${schH}%` }}
                        title={`${d.dayScheduled} scheduled`}
                      />
                    )}
                    {d.dayPublished > 0 && (
                      <div
                        className="w-full bg-emerald-500"
                        style={{ height: `${pubH}%` }}
                        title={`${d.dayPublished} published`}
                      />
                    )}
                  </div>
                  <span
                    className={`text-[11px] font-mono ${
                      d.isToday ? 'text-cyan-400 font-semibold' : 'text-slate-500'
                    }`}
                  >
                    {d.label}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-5 mt-3 text-[11px] text-slate-400">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" />
              Published
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-violet-500/80" />
              Scheduled
            </span>
          </div>
        </div>

        {/* Next Scheduled Action Card */}
        <div className="bg-[#0f172a] border border-slate-800 rounded-xl p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-100">Next Scheduled Short</h3>
              <CalendarClock className="w-4 h-4 text-violet-400" />
            </div>

            {nextScheduled ? (
              <div className="mt-4 space-y-2.5">
                <div className="text-sm font-medium text-slate-100 truncate">
                  {nextScheduled.originalFileName}
                </div>
                <div className="text-xs font-mono tabular-nums text-cyan-400">
                  {nextScheduled.scheduledAt
                    ? new Date(nextScheduled.scheduledAt).toLocaleString('en-US', {
                        timeZone: tz,
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })
                    : 'Unassigned'}
                </div>
                <div className="text-xs text-slate-400 font-mono tabular-nums">
                  {nextScheduled.validation.aspectRatio} ·{' '}
                  {nextScheduled.validation.durationSec !== null
                    ? `${nextScheduled.validation.durationSec}s`
                    : 'Duration pending'}
                </div>
              </div>
            ) : (
              <div className="mt-6 text-xs text-slate-400">
                No Shorts waiting in the queue right now. Upload up to 5 meme videos to fill today&apos;s slots.
              </div>
            )}
          </div>

          <div className="mt-5 pt-4 border-t border-slate-800 flex items-center gap-2">
            <button
              type="button"
              onClick={() => onNavigate('upload')}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg bg-violet-600 hover:bg-violet-500 text-white transition-colors cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" />
              Upload 5 Shorts
            </button>
            <button
              type="button"
              onClick={() => onNavigate('queue')}
              className="px-3 py-2 text-xs font-medium rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-200 transition-colors cursor-pointer"
            >
              Queue
            </button>
          </div>
        </div>
      </div>

      {/* Operational Activity Log */}
      <div className="bg-[#0f172a] border border-slate-800 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-100">Recent Pipeline Activity</h3>
          <span className="text-xs font-mono tabular-nums text-slate-500">
            {logs.length} events
          </span>
        </div>

        {logs.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-400">
            No pipeline activity recorded yet. Upload meme videos or scan{' '}
            <code className="text-slate-300 font-mono">shorts/incoming/</code> to get started.
          </div>
        ) : (
          <div className="divide-y divide-slate-800/70 max-h-72 overflow-y-auto">
            {logs.slice(0, 15).map((log) => (
              <div
                key={log.id}
                className="px-5 py-2.5 flex items-start justify-between gap-4 text-xs hover:bg-slate-900/50"
              >
                <div className="flex items-start gap-2.5 min-w-0">
                  {log.level === 'error' ? (
                    <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
                  ) : log.level === 'success' ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                  ) : log.level === 'warning' ? (
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                  ) : (
                    <Film className="w-3.5 h-3.5 text-cyan-400 shrink-0 mt-0.5" />
                  )}
                  <span className="text-slate-200 leading-relaxed">{log.message}</span>
                </div>
                <span className="text-[11px] font-mono tabular-nums text-slate-500 shrink-0">
                  {new Date(log.timestamp).toLocaleTimeString('en-US', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
