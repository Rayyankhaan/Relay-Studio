import { Calendar as CalendarIcon, CheckCircle2, Clock } from 'lucide-react';
import type { DashboardSnapshot, VideoRecord } from '../types.ts';

interface CalendarViewProps {
  snapshot: DashboardSnapshot;
  onNavigate: (tab: string) => void;
}

export function CalendarView({ snapshot, onNavigate }: CalendarViewProps) {
  const { videos, settings } = snapshot;
  const tz = settings.timezone || 'America/New_York';
  const slots = settings.postingSlots.length > 0
    ? settings.postingSlots
    : ['09:00', '12:00', '15:00', '18:00', '21:00'];

  // Build 7 days starting today
  const days = Array.from({ length: 7 }, (_, i) => {
    const dt = new Date(Date.now() + i * 86400_000);
    const dateKey = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(dt);
    const label = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    }).format(dt);
    return { dateKey, label, isToday: i === 0 };
  });

  const findVideoForSlot = (dateKey: string, slot: string): VideoRecord | undefined => {
    return videos.find((v) => {
      const targetIso = v.scheduledAt || v.publishedAt;
      if (!targetIso) return false;
      const d = new Date(targetIso);
      const dKey = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(d);
      const timeStr = new Intl.DateTimeFormat('en-GB', {
        timeZone: tz,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(d);
      return dKey === dateKey && timeStr.slice(0, 2) === slot.slice(0, 2);
    });
  };

  return (
    <div className="space-y-5">
      <div className="bg-[#0f172a] border border-slate-800 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">
            7-Day Shorts Schedule ({tz})
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            5 daily slots per batch ({slots.join(' · ')})
          </p>
        </div>
        <button
          type="button"
          onClick={() => onNavigate('upload')}
          className="px-3.5 py-2 text-xs font-medium rounded-lg bg-violet-600 hover:bg-violet-500 text-white cursor-pointer shrink-0"
        >
          Fill Open Slots
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-7 gap-3">
        {days.map((day) => (
          <div
            key={day.dateKey}
            className={`bg-[#0f172a] border rounded-xl overflow-hidden flex flex-col ${
              day.isToday ? 'border-cyan-500/50' : 'border-slate-800'
            }`}
          >
            <div className="px-3.5 py-2.5 border-b border-slate-800 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-100">{day.label}</span>
              {day.isToday && (
                <span className="text-[10px] font-mono uppercase text-cyan-400">Today</span>
              )}
            </div>
            <div className="p-2.5 space-y-2 flex-1">
              {slots.map((slot) => {
                const match = findVideoForSlot(day.dateKey, slot);
                return (
                  <div
                    key={slot}
                    className={`p-2.5 rounded-lg border text-xs ${
                      match
                        ? match.folderStage === 'published'
                          ? 'bg-emerald-500/10 border-emerald-500/30'
                          : 'bg-violet-500/10 border-violet-500/30'
                        : 'bg-slate-900/60 border-slate-800/80'
                    }`}
                  >
                    <div className="flex items-center justify-between font-mono tabular-nums text-[11px]">
                      <span className="text-slate-300">{slot}</span>
                      {match ? (
                        match.folderStage === 'published' ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                        ) : (
                          <Clock className="w-3.5 h-3.5 text-violet-400" />
                        )
                      ) : (
                        <CalendarIcon className="w-3 h-3 text-slate-600" />
                      )}
                    </div>
                    <div className="mt-1 truncate text-[11px]">
                      {match ? (
                        <span className="text-slate-100 font-medium">
                          {match.originalFileName}
                        </span>
                      ) : (
                        <span className="text-slate-500">Open slot</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
