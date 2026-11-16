import { AlertCircle, BarChart3, Globe2, RefreshCw } from 'lucide-react';
import type { AnalyticsReport, DashboardSnapshot } from '../types.ts';

interface AnalyticsViewProps {
  snapshot: DashboardSnapshot;
  report: AnalyticsReport | null;
  onRefreshAnalytics: () => Promise<void>;
  onSyncStats: () => Promise<void>;
  busyAction: string | null;
}

export function AnalyticsView({
  snapshot,
  report,
  onRefreshAnalytics,
  onSyncStats,
  busyAction,
}: AnalyticsViewProps) {
  const published = snapshot.videos.filter((v) => v.folderStage === 'published');
  const totalViews = report?.totals.views ?? published.reduce((s, v) => s + (v.views ?? 0), 0);
  const totalLikes = report?.totals.likes ?? published.reduce((s, v) => s + (v.likes ?? 0), 0);
  const totalComments =
    report?.totals.comments ?? published.reduce((s, v) => s + (v.comments ?? 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#0f172a] border border-slate-800 rounded-xl p-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">
            Channel &amp; Shorts Performance (Official YouTube APIs)
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Real data from YouTube Data API <code className="font-mono">videos.list</code> and YouTube Analytics API. Never simulated.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onSyncStats}
            disabled={busyAction === 'sync-stats'}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-200 disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${busyAction === 'sync-stats' ? 'animate-spin' : ''}`} />
            Sync Video Stats
          </button>
          <button
            type="button"
            onClick={onRefreshAnalytics}
            disabled={busyAction === 'load-analytics'}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-50 cursor-pointer"
          >
            <BarChart3 className="w-3.5 h-3.5" />
            {busyAction === 'load-analytics' ? 'Loading...' : 'Fetch Analytics API'}
          </button>
        </div>
      </div>

      {/* Real Totals Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[
          { label: 'Views', value: totalViews.toLocaleString() },
          { label: 'Likes', value: totalLikes.toLocaleString() },
          { label: 'Comments', value: totalComments.toLocaleString() },
          {
            label: 'Subscribers Gained',
            value:
              report?.totals.subscribersGained !== null &&
              report?.totals.subscribersGained !== undefined
                ? report.totals.subscribersGained.toLocaleString()
                : '—',
          },
          {
            label: 'Avg View Duration',
            value:
              report?.totals.averageViewDurationSec !== null &&
              report?.totals.averageViewDurationSec !== undefined
                ? `${report.totals.averageViewDurationSec}s`
                : '—',
          },
        ].map((stat) => (
          <div key={stat.label} className="bg-[#0f172a] border border-slate-800 rounded-xl p-4">
            <div className="text-[11px] uppercase tracking-wider text-slate-400">
              {stat.label}
            </div>
            <div className="text-2xl font-semibold font-mono tabular-nums text-slate-100 mt-1">
              {stat.value}
            </div>
          </div>
        ))}
      </div>

      {/* Honest Analytics Scope / Availability Banner */}
      {report && !report.available && (
        <div className="bg-[#0f172a] border border-amber-500/30 rounded-xl p-4 flex items-start gap-3 text-xs">
          <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <div className="font-semibold text-amber-300">
              YouTube Analytics API Geography &amp; Time-Series Unavailable
            </div>
            <p className="text-slate-300">{report.reason}</p>
          </div>
        </div>
      )}

      {/* Geography Breakdown (US / CA / AU) */}
      {report?.available && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-[#0f172a] border border-slate-800 rounded-xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <Globe2 className="w-4 h-4 text-cyan-400" />
              <h4 className="text-sm font-semibold text-slate-100">
                Audience Geography (US · CA · AU · Last 30 Days)
              </h4>
            </div>
            {report.geography.length === 0 ? (
              <p className="text-xs text-slate-400">
                No geographic watch data returned by YouTube Analytics API yet for US, CA, or AU.
              </p>
            ) : (
              <div className="space-y-3">
                {report.geography.map((g) => (
                  <div
                    key={g.countryCode}
                    className="flex items-center justify-between text-xs border-b border-slate-800/80 pb-2"
                  >
                    <span className="text-slate-200 font-medium">
                      {g.countryName} ({g.countryCode})
                    </span>
                    <span className="font-mono tabular-nums text-cyan-400">
                      {g.views.toLocaleString()} views · {Math.round(g.estimatedMinutesWatched)}m watched
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-[#0f172a] border border-slate-800 rounded-xl p-5">
            <h4 className="text-sm font-semibold text-slate-100 mb-4">
              Daily Views Series (Last 30 Days)
            </h4>
            {report.dailySeries.length === 0 ? (
              <p className="text-xs text-slate-400">No daily report rows returned yet.</p>
            ) : (
              <div className="space-y-1.5 max-h-56 overflow-y-auto text-xs font-mono tabular-nums">
                {report.dailySeries.slice(-14).map((d) => (
                  <div
                    key={d.date}
                    className="flex items-center justify-between py-1 border-b border-slate-800/60"
                  >
                    <span className="text-slate-400">{d.date}</span>
                    <span className="text-slate-100">
                      {d.views.toLocaleString()} views · {d.likes.toLocaleString()} likes
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
