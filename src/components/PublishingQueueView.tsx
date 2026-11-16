import {
  CalendarClock,
  ExternalLink,
  Pause,
  Play,
  RotateCcw,
  Send,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';
import type { DashboardSnapshot, VideoRecord } from '../types.ts';

interface PublishingQueueViewProps {
  snapshot: DashboardSnapshot;
  onToggleScheduler: (pause: boolean) => Promise<void>;
  onReschedule: (videoId: string, scheduledAtIso: string) => Promise<void>;
  onRetry: (videoId: string) => Promise<void>;
  onDelete: (videoId: string) => Promise<void>;
  onRequestPublish: (video: VideoRecord) => void;
  onRunTick: () => Promise<void>;
  busyVideoId: string | null;
}

function toDatetimeLocalValue(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function PublishingQueueView({
  snapshot,
  onToggleScheduler,
  onReschedule,
  onRetry,
  onDelete,
  onRequestPublish,
  onRunTick,
  busyVideoId,
}: PublishingQueueViewProps) {
  const { videos, settings } = snapshot;
  const tz = settings.timezone || 'America/New_York';
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftDateTime, setDraftDateTime] = useState<string>('');

  const queued = videos
    .filter((v) => v.folderStage === 'scheduled' || v.folderStage === 'incoming' || v.folderStage === 'processing')
    .sort((a, b) => new Date(a.scheduledAt || 0).getTime() - new Date(b.scheduledAt || 0).getTime());

  const failed = videos.filter((v) => v.folderStage === 'failed');
  const published = videos
    .filter((v) => v.folderStage === 'published')
    .sort((a, b) => new Date(b.publishedAt || 0).getTime() - new Date(a.publishedAt || 0).getTime());

  const saveEdit = async (videoId: string) => {
    if (!draftDateTime) return;
    await onReschedule(videoId, new Date(draftDateTime).toISOString());
    setEditingId(null);
  };

  return (
    <div className="space-y-6">
      {/* Scheduler Control Bar */}
      <div className="bg-[#0f172a] border border-slate-800 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-100">
            Automated Queue · {settings.schedulerPaused ? 'Paused' : 'Active'}
          </div>
          <div className="text-xs text-slate-400 font-mono mt-0.5">
            {settings.postsPerDay} Shorts/day · {tz} · Slots: {settings.postingSlots.join(', ')}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onRunTick}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-200 cursor-pointer"
          >
            Process Due Now
          </button>
          <button
            type="button"
            onClick={() => onToggleScheduler(!settings.schedulerPaused)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border cursor-pointer ${
              settings.schedulerPaused
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                : 'border-amber-500/40 bg-amber-500/10 text-amber-300'
            }`}
          >
            {settings.schedulerPaused ? (
              <>
                <Play className="w-3.5 h-3.5" /> Resume
              </>
            ) : (
              <>
                <Pause className="w-3.5 h-3.5" /> Pause
              </>
            )}
          </button>
        </div>
      </div>

      {/* Failed Uploads Section */}
      {failed.length > 0 && (
        <div className="bg-[#0f172a] border border-rose-500/30 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-rose-500/20 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-rose-300">
              Failed Uploads ({failed.length})
            </h3>
          </div>
          <div className="divide-y divide-slate-800">
            {failed.map((v) => (
              <div
                key={v.id}
                className="px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="min-w-0 space-y-1">
                  <div className="text-sm font-medium text-slate-100 truncate">
                    {v.originalFileName}
                  </div>
                  <div className="text-xs text-rose-300">{v.lastError || 'Upload failed'}</div>
                  <div className="text-[11px] font-mono text-slate-500">
                    Retries attempted: {v.retryCount}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => onRetry(v.id)}
                    disabled={busyVideoId === v.id}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-100 cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Re-Queue
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(v.id)}
                    disabled={busyVideoId === v.id}
                    className="p-1.5 rounded-lg border border-slate-800 text-slate-400 hover:text-rose-400 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Scheduled Queue Table */}
      <div className="bg-[#0f172a] border border-slate-800 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-100">
            Scheduled Queue ({queued.length})
          </h3>
          <span className="text-xs text-slate-400 font-mono">
            {snapshot.fixedMetadata.title}
          </span>
        </div>
        {queued.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-400">
            Queue is empty. Upload meme Shorts to assign upcoming {tz} posting slots.
          </div>
        ) : (
          <div className="divide-y divide-slate-800">
            {queued.map((v) => (
              <div
                key={v.id}
                className="px-5 py-3.5 flex flex-col lg:flex-row lg:items-center justify-between gap-3"
              >
                <div className="min-w-0 space-y-1">
                  <div className="text-sm font-medium text-slate-100 truncate">
                    {v.originalFileName}
                  </div>
                  <div className="text-xs font-mono tabular-nums text-cyan-400 flex items-center gap-2">
                    <CalendarClock className="w-3.5 h-3.5 shrink-0" />
                    {editingId === v.id ? (
                      <span className="inline-flex items-center gap-2">
                        <input
                          type="datetime-local"
                          value={draftDateTime}
                          onChange={(e) => setDraftDateTime(e.target.value)}
                          className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-100"
                        />
                        <button
                          type="button"
                          onClick={() => saveEdit(v.id)}
                          className="px-2 py-1 rounded bg-violet-600 text-white text-xs cursor-pointer"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="text-slate-400 text-xs cursor-pointer"
                        >
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <span>
                        {v.scheduledAt
                          ? new Date(v.scheduledAt).toLocaleString('en-US', {
                              timeZone: tz,
                              weekday: 'short',
                              month: 'short',
                              day: 'numeric',
                              hour: 'numeric',
                              minute: '2-digit',
                            })
                          : 'Unassigned'}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(v.id);
                      setDraftDateTime(toDatetimeLocalValue(v.scheduledAt));
                    }}
                    className="px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-200 cursor-pointer"
                  >
                    Reschedule
                  </button>
                  <button
                    type="button"
                    onClick={() => onRequestPublish(v)}
                    disabled={busyVideoId === v.id}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-50 cursor-pointer"
                  >
                    <Send className="w-3.5 h-3.5" />
                    {busyVideoId === v.id ? 'Uploading...' : 'Publish to YouTube'}
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(v.id)}
                    disabled={busyVideoId === v.id}
                    className="p-1.5 rounded-lg border border-slate-800 text-slate-400 hover:text-rose-400 cursor-pointer"
                    title="Delete video"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Published History */}
      <div className="bg-[#0f172a] border border-slate-800 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-100">
            Published Shorts History ({published.length})
          </h3>
        </div>
        {published.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-400">
            No Shorts published to YouTube yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-900/60 text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="px-5 py-2.5 font-medium">File</th>
                  <th className="px-4 py-2.5 font-medium">Privacy</th>
                  <th className="px-4 py-2.5 font-medium">Published</th>
                  <th className="px-4 py-2.5 font-medium text-right">Views</th>
                  <th className="px-4 py-2.5 font-medium text-right">Likes</th>
                  <th className="px-5 py-2.5 font-medium text-right">YouTube URL</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {published.map((v) => (
                  <tr key={v.id} className="hover:bg-slate-900/40">
                    <td className="px-5 py-3 text-slate-100 font-medium max-w-[220px] truncate">
                      {v.originalFileName}
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-300 capitalize">
                      {v.youtubePrivacy}
                    </td>
                    <td className="px-4 py-3 font-mono tabular-nums text-slate-400">
                      {v.publishedAt
                        ? new Date(v.publishedAt).toLocaleString('en-US', {
                            timeZone: tz,
                            month: 'short',
                            day: 'numeric',
                            hour: 'numeric',
                            minute: '2-digit',
                          })
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-200">
                      {v.views !== null ? v.views.toLocaleString() : '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-200">
                      {v.likes !== null ? v.likes.toLocaleString() : '—'}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {v.youtubeUrl ? (
                        <a
                          href={v.youtubeUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300 font-mono"
                        >
                          Shorts Link
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
