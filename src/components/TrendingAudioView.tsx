import { ExternalLink, Info, Music2, Search } from 'lucide-react';
import { useState } from 'react';
import type { DashboardSnapshot } from '../types.ts';

interface TrendingAudioViewProps {
  snapshot: DashboardSnapshot;
  onResearchAudio: (focusTopic?: string) => Promise<void>;
  busyAction: string | null;
}

export function TrendingAudioView({
  snapshot,
  onResearchAudio,
  busyAction,
}: TrendingAudioViewProps) {
  const [focusTopic, setFocusTopic] = useState('');
  const isBusy = busyAction === 'research-audio';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onResearchAudio(focusTopic);
  };

  return (
    <div className="space-y-6">
      {/* Honest YouTube Shorts Audio Workflow Explanation */}
      <div className="bg-[#0f172a] border border-slate-800 rounded-xl p-5 flex items-start gap-3.5">
        <Info className="w-5 h-5 text-cyan-400 shrink-0 mt-0.5" />
        <div className="space-y-1.5 text-xs text-slate-300 leading-relaxed">
          <div className="font-semibold text-slate-100 text-sm">
            Official YouTube Shorts Audio Workflow
          </div>
          <p>
            YouTube Data API v3 does not provide an endpoint to attach tracks from YouTube&apos;s in-app Shorts Audio Library after upload. ShortsPilot never fakes audio attachment or downloads unauthorized copyrighted music.
          </p>
          <p className="text-slate-400">
            Recommended options: (1) Bake royalty-free / properly licensed meme SFX into your MP4 before uploading, or (2) Schedule uploads as <strong className="text-slate-200">Private</strong> and attach an official Shorts Audio Library sound in the YouTube mobile app before switching to Public.
          </p>
        </div>
      </div>

      {/* Live Search Research Form */}
      <form
        onSubmit={handleSubmit}
        className="bg-[#0f172a] border border-slate-800 rounded-xl p-5 flex flex-col sm:flex-row gap-3"
      >
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={focusTopic}
            onChange={(e) => setFocusTopic(e.target.value)}
            placeholder="Optional meme style filter (e.g. deadpan reaction, plot twist, Xavier punchline)..."
            className="w-full pl-9 pr-3 py-2 text-xs bg-slate-900 border border-slate-800 rounded-lg text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-violet-500"
          />
        </div>
        <button
          type="submit"
          disabled={isBusy}
          className="inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium rounded-lg bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-50 cursor-pointer shrink-0"
        >
          <Music2 className={`w-4 h-4 ${isBusy ? 'animate-spin' : ''}`} />
          {isBusy ? 'Researching Live Trends...' : 'Research Trending Meme Audio'}
        </button>
      </form>

      {/* Results List */}
      {snapshot.audios.length === 0 ? (
        <div className="bg-[#0f172a] border border-slate-800 rounded-xl p-10 text-center space-y-2">
          <Music2 className="w-8 h-8 text-slate-500 mx-auto" />
          <div className="text-sm font-medium text-slate-200">No trending meme sounds researched yet</div>
          <p className="text-xs text-slate-400 max-w-md mx-auto">
            Click &ldquo;Research Trending Meme Audio&rdquo; to query live web search grounding for current comedy and reaction meme sounds with verified source references.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {snapshot.audios.map((audio) => (
            <div
              key={audio.id}
              className="bg-[#0f172a] border border-slate-800 rounded-xl p-4 space-y-2.5 flex flex-col justify-between"
            >
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <h4 className="text-sm font-semibold text-slate-100">{audio.soundName}</h4>
                  <span className="text-[11px] font-mono text-cyan-400 shrink-0">
                    {audio.trendStatus}
                  </span>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  {audio.relevanceToMemes}
                </p>
                <div className="text-[11px] text-slate-400">
                  Best for: <span className="text-slate-200">{audio.recommendedForType}</span>
                </div>
              </div>

              <div className="pt-2.5 border-t border-slate-800 flex items-center justify-between text-[11px] font-mono">
                <span className="text-slate-500 tabular-nums">
                  {new Date(audio.researchedAt).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </span>
                {audio.sourceUrl ? (
                  <a
                    href={audio.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-violet-400 hover:text-violet-300"
                  >
                    {audio.sourceTitle ? audio.sourceTitle.slice(0, 28) : 'Source Reference'}
                    <ExternalLink className="w-3 h-3" />
                  </a>
                ) : (
                  <span className="text-slate-500">Shorts Audio Picker</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
