import { useState } from 'react';
import {
  ArrowUpRight,
  Check,
  Code2,
  Copy,
  Link2,
  Plus,
  Send,
  Trash2,
} from 'lucide-react';
import { formatTier1Slot, formatUsd } from '../constants/assets.ts';
import type { AutomationState, Campaign, ClipItem } from '../types.ts';

interface RewardsSubmitViewProps {
  state: AutomationState;
  onCreateCampaign: (payload: Partial<Campaign>) => Promise<void>;
  onUpdateCampaign: (id: string, patch: Partial<Campaign>) => Promise<void>;
  onDeleteCampaign: (id: string) => Promise<void>;
  onRunClip: (clipId: string, youtubeUrl?: string) => Promise<void>;
  busyClipId: string | null;
}

export function RewardsSubmitView({
  state,
  onCreateCampaign,
  onUpdateCampaign,
  onDeleteCampaign,
  onRunClip,
  busyClipId,
}: RewardsSubmitViewProps) {
  const [showNewForm, setShowNewForm] = useState(false);
  const [name, setName] = useState('');
  const [platform, setPlatform] = useState('Whop Content Rewards');
  const [rpmUsd, setRpmUsd] = useState('2.00');
  const [requiredTag, setRequiredTag] = useState('#whop');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [portalSubmitUrl, setPortalSubmitUrl] = useState('https://whop.com/content-rewards');

  const [urlDrafts, setUrlDrafts] = useState<Record<string, string>>({});
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const pendingClips = state.clips.filter((c) => c.status !== 'submitted');
  const submittedClips = state.clips.filter((c) => c.status === 'submitted');

  const latestLink =
    submittedClips[0]?.youtubeShortUrl ||
    pendingClips[0]?.youtubeShortUrl ||
    'https://youtube.com/shorts/YOUR_SHORT_ID';

  const autoPasteBookmarklet = `javascript:(()=>{const u=${JSON.stringify(
    latestLink
  )};const el=document.querySelector('input[type="url"],input[name*="url" i],input[placeholder*="youtube" i],input[placeholder*="link" i],input[type="text"]');if(el){const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;s.call(el,u);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));const btn=[...document.querySelectorAll('button')].find(b=>/submit|send|claim|add/i.test(b.textContent||''));if(btn)btn.click();}else{navigator.clipboard.writeText(u);}})();`;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    await onCreateCampaign({
      name: name.trim(),
      platform: platform.trim(),
      rpmUsd: Number(rpmUsd) || 1.75,
      requiredTag: requiredTag.trim(),
      webhookUrl: webhookUrl.trim(),
      portalSubmitUrl: portalSubmitUrl.trim(),
    });
    setName('');
    setWebhookUrl('');
    setShowNewForm(false);
  };

  const handleCopy = async (key: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedKey(key);
    window.setTimeout(() => setCopiedKey(null), 1800);
  };

  const handleBatchSubmit = async () => {
    for (const clip of pendingClips) {
      await onRunClip(clip.id, urlDrafts[clip.id]);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Section 1: Pending Link Auto-Submitter */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="p-5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Content Rewards Auto-Submit Queue
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Clips are matched to campaigns automatically via hashtags in the file name. Paste or auto-capture the YouTube Short URL and submit.
            </p>
          </div>

          {pendingClips.length > 0 && (
            <button
              type="button"
              disabled={busyClipId !== null}
              onClick={handleBatchSubmit}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50 whitespace-nowrap cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
              Auto-Submit All ({pendingClips.length})
            </button>
          )}
        </div>

        {pendingClips.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">
            No pending clips waiting for Content Rewards submission. Upload clips to {state.config.watchFolderPath} to queue them.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {pendingClips.map((clip: ClipItem) => {
              const camp = state.campaigns.find((c) => c.id === clip.campaignId);
              const val = urlDrafts[clip.id] ?? clip.youtubeShortUrl ?? '';
              return (
                <div
                  key={clip.id}
                  className="p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-900 truncate">
                      {clip.shortTitle}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Campaign: {camp?.name || 'Unassigned'} · Tags:{' '}
                      <span className="font-mono text-slate-700">
                        {clip.hashtags.join(' ')}
                      </span>{' '}
                      · Regions: {clip.targetRegions.join('/')}
                    </p>
                  </div>

                  <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 lg:w-[460px] shrink-0">
                    <div className="relative flex-1 min-w-[200px]">
                      <Link2 className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="url"
                        value={val}
                        onChange={(e) =>
                          setUrlDrafts((prev) => ({ ...prev, [clip.id]: e.target.value }))
                        }
                        placeholder="Paste https://youtube.com/shorts/... (optional)"
                        className="w-full pl-8 pr-3 py-1.5 text-xs font-mono bg-white border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-slate-400"
                      />
                    </div>
                    <button
                      type="button"
                      disabled={busyClipId === clip.id}
                      onClick={() => onRunClip(clip.id, val.trim() || undefined)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-lg bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap cursor-pointer"
                    >
                      <Send className="w-3 h-3" />
                      {busyClipId === clip.id ? 'Submitting...' : 'Copy & Submit'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Section 2: 1-Click Portal Auto-Paste Bookmarklet */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <Code2 className="w-4 h-4 text-slate-600 mt-0.5 shrink-0" />
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              1-Click Portal Auto-Paste Bookmarklet
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              On web-only Content Rewards portals (like Whop), click this bookmarklet to automatically paste{' '}
              <span className="font-mono text-slate-700">{latestLink}</span> into the URL field and click submit.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => handleCopy('bookmarklet', autoPasteBookmarklet)}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-200 bg-white text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0 cursor-pointer"
        >
          {copiedKey === 'bookmarklet' ? (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-600" />
              Copied Bookmarklet
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" />
              Copy Auto-Paste Script
            </>
          )}
        </button>
      </div>

      {/* Section 3: Campaigns & Hashtag Matching */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="p-5 border-b border-slate-200 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              Content Rewards Campaigns & Hashtag Routing
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Any clip whose filename includes a campaign hashtag (e.g. #whop) automatically routes here.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowNewForm((prev) => !prev)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 bg-white text-slate-800 hover:bg-slate-50 whitespace-nowrap cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Campaign
          </button>
        </div>

        {showNewForm && (
          <form
            onSubmit={handleCreate}
            className="p-5 border-b border-slate-200 bg-slate-50/70 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3"
          >
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Campaign Name"
              className="px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg"
            />
            <input
              type="text"
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
              placeholder="Platform (e.g. Whop)"
              className="px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg"
            />
            <input
              type="text"
              value={requiredTag}
              onChange={(e) => setRequiredTag(e.target.value)}
              placeholder="Filename Hashtag (e.g. #whop)"
              className="px-3 py-2 text-xs font-mono bg-white border border-slate-200 rounded-lg"
            />
            <input
              type="number"
              step="0.05"
              value={rpmUsd}
              onChange={(e) => setRpmUsd(e.target.value)}
              placeholder="RPM ($/1k views)"
              className="px-3 py-2 text-xs font-mono bg-white border border-slate-200 rounded-lg"
            />
            <input
              type="url"
              value={portalSubmitUrl}
              onChange={(e) => setPortalSubmitUrl(e.target.value)}
              placeholder="Portal Submit URL"
              className="px-3 py-2 text-xs font-mono bg-white border border-slate-200 rounded-lg"
            />
            <input
              type="url"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="Auto-Submit Webhook URL (optional)"
              className="px-3 py-2 text-xs font-mono bg-white border border-slate-200 rounded-lg"
            />
            <div className="sm:col-span-2 lg:col-span-3 flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowNewForm(false)}
                className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 text-xs font-medium rounded-lg bg-slate-900 text-white hover:bg-slate-800 cursor-pointer"
              >
                Save Campaign
              </button>
            </div>
          </form>
        )}

        <div className="divide-y divide-slate-100">
          {state.campaigns.map((camp) => (
            <div
              key={camp.id}
              className="p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                  <span className="text-sm font-semibold text-slate-900">{camp.name}</span>
                  <span className="text-xs text-slate-500">
                    {camp.platform} · Auto-match tag:{' '}
                    <span className="font-mono text-slate-800">{camp.requiredTag}</span>
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input
                    type="url"
                    value={camp.webhookUrl}
                    onChange={(e) =>
                      onUpdateCampaign(camp.id, { webhookUrl: e.target.value })
                    }
                    placeholder="Optional HTTP POST Webhook URL for automatic link submission..."
                    className="w-full sm:w-96 px-3 py-1.5 text-xs font-mono bg-slate-50 border border-slate-200 rounded-md text-slate-800 focus:bg-white focus:outline-none focus:border-slate-400"
                  />
                  {camp.portalSubmitUrl && (
                    <a
                      href={camp.portalSubmitUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 border border-slate-200 rounded-md hover:bg-slate-50 whitespace-nowrap"
                    >
                      Open Portal
                      <ArrowUpRight className="w-3.5 h-3.5" />
                    </a>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-6 shrink-0 text-xs">
                <div className="flex flex-col text-right">
                  <span className="text-slate-400">Rate</span>
                  <span className="font-mono tabular-nums font-medium text-slate-900">
                    {formatUsd(camp.rpmUsd)} / 1k
                  </span>
                </div>
                <div className="flex flex-col text-right">
                  <span className="text-slate-400">Submitted</span>
                  <span className="font-mono tabular-nums font-medium text-slate-900">
                    {camp.totalSubmitted}
                  </span>
                </div>
                <button
                  type="button"
                  aria-label="Delete campaign"
                  onClick={() => onDeleteCampaign(camp.id)}
                  className="p-1.5 text-slate-400 hover:text-rose-600 rounded-md hover:bg-slate-100 cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Section 4: Submitted Links Ledger */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">
            Submitted Short Links Ledger
          </h3>
          <span className="text-xs font-mono tabular-nums text-slate-500">
            {submittedClips.length} receipts
          </span>
        </div>

        {submittedClips.length === 0 ? (
          <div className="p-6 text-xs text-slate-500">
            No submitted links yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-medium text-slate-500">
                  <th className="py-2.5 px-4">Short Title</th>
                  <th className="py-2.5 px-3">YouTube Short Link</th>
                  <th className="py-2.5 px-3">Campaign</th>
                  <th className="py-2.5 px-3">Submitted At</th>
                  <th className="py-2.5 px-4 text-right">Copy</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {submittedClips.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50/60">
                    <td className="py-3 px-4 font-medium text-slate-900 max-w-[240px] truncate">
                      {c.shortTitle}
                    </td>
                    <td className="py-3 px-3 font-mono text-slate-700 max-w-[260px] truncate">
                      {c.youtubeShortUrl}
                    </td>
                    <td className="py-3 px-3 text-slate-600">
                      {c.submissionReceipt?.campaignName || 'Content Rewards'}
                    </td>
                    <td className="py-3 px-3 font-mono tabular-nums text-slate-500 whitespace-nowrap">
                      {c.submissionReceipt
                        ? formatTier1Slot(c.submissionReceipt.submittedAt)
                        : '—'}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => handleCopy(c.id, c.youtubeShortUrl)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 cursor-pointer"
                      >
                        {copiedKey === c.id ? (
                          <>
                            <Check className="w-3 h-3 text-emerald-600" />
                            Copied
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            Copy
                          </>
                        )}
                      </button>
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
