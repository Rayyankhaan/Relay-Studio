import { useState } from 'react';
import { CalendarClock, Play, Save } from 'lucide-react';
import { formatTier1Slot } from '../constants/assets.ts';
import type {
  AutomationConfig,
  AutomationState,
  TargetRegion,
  YoutubePrivacy,
} from '../types.ts';

interface Tier1ScheduleViewProps {
  state: AutomationState;
  onSaveConfig: (patch: Partial<AutomationConfig>) => Promise<void>;
  onRunTickNow: () => Promise<void>;
  saving: boolean;
  ticking: boolean;
}

const TIER1_SLOTS = [
  { est: '08:30', label: '08:30 EST · 05:30 PST · 00:30 AEDT (US/CA Morning)' },
  { est: '12:15', label: '12:15 EST · 09:15 PST · 04:15 AEDT (US/CA Lunch)' },
  { est: '15:30', label: '15:30 EST · 12:30 PST · 07:30 AEDT (After-School / Afternoon)' },
  { est: '17:30', label: '17:30 EST · 14:30 PST · 09:30 AEDT (US/CA Evening + AU Morning)' },
  { est: '20:30', label: '20:30 EST · 17:30 PST · 12:30 AEDT (US/CA Prime + AU Midday)' },
  { est: '22:15', label: '22:15 EST · 19:15 PST · 14:15 AEDT (West Coast + AU Afternoon)' },
];

const REGIONS: Array<{ code: TargetRegion; name: string }> = [
  { code: 'US', name: 'United States' },
  { code: 'CA', name: 'Canada' },
  { code: 'AU', name: 'Australia' },
];

export function Tier1ScheduleView({
  state,
  onSaveConfig,
  onRunTickNow,
  saving,
  ticking,
}: Tier1ScheduleViewProps) {
  const [autoRunEnabled, setAutoRunEnabled] = useState(state.config.autoRunEnabled);
  const [postsPerDay, setPostsPerDay] = useState(state.config.postsPerDay || 5);
  const [peakWindowsEst, setPeakWindowsEst] = useState<string[]>(state.config.peakWindowsEst);
  const [targetRegions, setTargetRegions] = useState<TargetRegion[]>(state.config.targetRegions);
  const [defaultPrivacyStatus, setDefaultPrivacyStatus] = useState<YoutubePrivacy>(
    state.config.defaultPrivacyStatus || 'public'
  );
  const [youtubeUploadWebhookUrl, setYoutubeUploadWebhookUrl] = useState(
    state.config.youtubeUploadWebhookUrl
  );
  const [autoSubmitToRewards, setAutoSubmitToRewards] = useState(
    state.config.autoSubmitToRewards
  );

  const toggleSlot = (est: string) => {
    setPeakWindowsEst((prev) =>
      prev.includes(est) ? prev.filter((s) => s !== est) : [...prev, est].sort()
    );
  };

  const toggleRegion = (code: TargetRegion) => {
    setTargetRegions((prev) => {
      if (prev.includes(code)) {
        return prev.length > 1 ? prev.filter((r) => r !== code) : prev;
      }
      return [...prev, code];
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSaveConfig({
      autoRunEnabled,
      postsPerDay,
      peakWindowsEst:
        peakWindowsEst.length > 0
          ? peakWindowsEst
          : ['08:30', '12:15', '15:30', '17:30', '20:30'],
      targetRegions,
      defaultPrivacyStatus,
      youtubeUploadWebhookUrl: youtubeUploadWebhookUrl.trim(),
      autoSubmitToRewards,
    });
  };

  const upcoming = state.clips
    .filter((c) => c.status === 'scheduled')
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
      <form
        onSubmit={handleSave}
        className="xl:col-span-7 bg-white border border-slate-200 rounded-lg p-6 flex flex-col gap-6"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              US, Canada &amp; Australia Daily 5-Upload Schedule
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Target only Tier-1 English audiences (US, CA, AU) with 5 daily cross-timezone slots.
            </p>
          </div>

          <button
            type="button"
            disabled={ticking}
            onClick={onRunTickNow}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 bg-white text-slate-800 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap cursor-pointer"
          >
            <Play className="w-3.5 h-3.5" />
            {ticking ? 'Processing...' : 'Process Due Slots Now'}
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-slate-700">
              Daily Shorts Upload Target
            </label>
            <select
              value={postsPerDay}
              onChange={(e) => setPostsPerDay(Number(e.target.value))}
              className="px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-900"
            >
              <option value={1}>1 Short / day</option>
              <option value={2}>2 Shorts / day</option>
              <option value={3}>3 Shorts / day</option>
              <option value={4}>4 Shorts / day</option>
              <option value={5}>5 Shorts / day (Recommended)</option>
              <option value={6}>6 Shorts / day</option>
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-slate-700">
              Default YouTube Upload Privacy
            </label>
            <select
              value={defaultPrivacyStatus}
              onChange={(e) => setDefaultPrivacyStatus(e.target.value as YoutubePrivacy)}
              className="px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-900"
            >
              <option value="public">Public (Live Shorts Feed)</option>
              <option value="unlisted">Unlisted (Verify before public)</option>
              <option value="private">Private (Draft on Channel)</option>
            </select>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-slate-700">
            Tier-1 Target Countries
          </label>
          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            {REGIONS.map((r) => {
              const active = targetRegions.includes(r.code);
              return (
                <button
                  key={r.code}
                  type="button"
                  onClick={() => toggleRegion(r.code)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors cursor-pointer ${
                    active
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {r.code} · {r.name}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-xs font-medium text-slate-700">
            5 Daily US / Canada / Australia Release Windows
          </label>
          <div className="flex flex-col gap-2">
            {TIER1_SLOTS.map((slot) => {
              const active = peakWindowsEst.includes(slot.est);
              return (
                <label
                  key={slot.est}
                  className="flex items-center gap-3 px-3 py-2 border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer text-xs"
                >
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={() => toggleSlot(slot.est)}
                    className="rounded border-slate-300 text-rose-600 focus:ring-rose-500"
                  />
                  <span className="font-mono text-slate-800">{slot.label}</span>
                </label>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-1.5 pt-2 border-t border-slate-100">
          <label className="text-xs font-medium text-slate-700">
            External Upload Webhook URL (Optional Fallback if YouTube Not Signed In)
          </label>
          <input
            type="url"
            value={youtubeUploadWebhookUrl}
            onChange={(e) => setYoutubeUploadWebhookUrl(e.target.value)}
            placeholder="https://hook.us1.make.com/..."
            className="px-3 py-2 text-xs font-mono bg-white border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400"
          />
        </div>

        <div className="flex flex-col gap-3 pt-2 border-t border-slate-100">
          <label className="flex items-center justify-between gap-4 cursor-pointer">
            <div>
              <span className="text-sm font-medium text-slate-900">
                Enable Background Folder &amp; Schedule Auto-Runner
              </span>
              <p className="text-xs text-slate-500">
                Automatically scans {state.config.watchFolderPath} and processes due slots.
              </p>
            </div>
            <input
              type="checkbox"
              checked={autoRunEnabled}
              onChange={(e) => setAutoRunEnabled(e.target.checked)}
              className="w-4 h-4 rounded border-slate-300 text-rose-600 focus:ring-rose-500"
            />
          </label>

          <label className="flex items-center justify-between gap-4 cursor-pointer">
            <div>
              <span className="text-sm font-medium text-slate-900">
                Auto-Submit Short URL to Content Rewards
              </span>
              <p className="text-xs text-slate-500">
                Immediately sends uploaded Short links to the matched campaign webhook and copies to clipboard.
              </p>
            </div>
            <input
              type="checkbox"
              checked={autoSubmitToRewards}
              onChange={(e) => setAutoSubmitToRewards(e.target.checked)}
              className="w-4 h-4 rounded border-slate-300 text-rose-600 focus:ring-rose-500"
            />
          </label>
        </div>

        <div className="flex justify-end pt-2 border-t border-slate-100">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-60 whitespace-nowrap cursor-pointer"
          >
            <Save className="w-3.5 h-3.5" />
            {saving ? 'Saving...' : 'Save Automation Rules'}
          </button>
        </div>
      </form>

      {/* Right: Upcoming Tier-1 Slots */}
      <div className="xl:col-span-5 bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CalendarClock className="w-4 h-4 text-slate-500" />
            <h3 className="text-sm font-semibold text-slate-900">
              Upcoming US / CA / AU Queue
            </h3>
          </div>
          <span className="text-xs font-mono tabular-nums text-slate-500">
            {upcoming.length} clips
          </span>
        </div>

        {upcoming.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">
            No scheduled clips yet. Drop clips in Watch Folder to populate your 5 daily US/CA/AU slots.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {upcoming.map((clip) => (
              <div key={clip.id} className="p-4 flex flex-col gap-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-mono tabular-nums font-medium text-rose-700">
                    {formatTier1Slot(clip.scheduledAt)}
                  </span>
                  <span className="text-[11px] font-mono text-slate-500">
                    {clip.targetRegions.join(' · ')}
                  </span>
                </div>
                <p className="text-sm font-medium text-slate-900 leading-snug">
                  {clip.shortTitle}
                </p>
                <p className="text-xs font-mono text-slate-500 truncate">
                  {clip.hashtags.join(' ')}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
