import {
  AlertTriangle,
  CheckCircle2,
  Film,
  Play,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type { DashboardSnapshot, VideoRecord } from '../types.ts';
import { getLocalVideoBlob } from '../lib/clipStorage.ts';

interface VideoLibraryViewProps {
  snapshot: DashboardSnapshot;
  onAnalyzeVideo: (videoId: string) => Promise<void>;
  onDeleteVideo: (videoId: string) => Promise<void>;
  onRequestPublish: (video: VideoRecord) => void;
  onNavigate: (tab: string) => void;
  busyVideoId: string | null;
}

export function VideoLibraryView({
  snapshot,
  onAnalyzeVideo,
  onDeleteVideo,
  onRequestPublish,
  onNavigate,
  busyVideoId,
}: VideoLibraryViewProps) {
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState<string>('all');
  const [previewVideo, setPreviewVideo] = useState<VideoRecord | null>(null);
  const [previewObjectUrl, setPreviewObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let createdUrl: string | null = null;
    if (!previewVideo) {
      setPreviewObjectUrl(null);
      return;
    }
    if (!previewVideo.hasLocalFile) {
      getLocalVideoBlob(previewVideo.id).then((blob) => {
        if (active && blob) {
          createdUrl = URL.createObjectURL(blob);
          setPreviewObjectUrl(createdUrl);
        }
      });
    } else {
      setPreviewObjectUrl(`/api/videos/${previewVideo.id}/stream`);
    }
    return () => {
      active = false;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [previewVideo]);

  const filtered = snapshot.videos.filter((v) => {
    const matchesStage = stageFilter === 'all' || v.folderStage === stageFilter;
    const q = search.trim().toLowerCase();
    const matchesQuery =
      !q ||
      v.originalFileName.toLowerCase().includes(q) ||
      (v.aiAnalysis?.memeContext || '').toLowerCase().includes(q);
    return matchesStage && matchesQuery;
  });

  return (
    <div className="space-y-5">
      {/* Filter Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search filename or AI meme notes..."
            className="w-full pl-9 pr-3 py-2 text-xs bg-[#0f172a] border border-slate-800 rounded-lg text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-violet-500"
          />
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          {(['all', 'scheduled', 'published', 'failed'] as const).map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setStageFilter(st)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer capitalize ${
                stageFilter === st
                  ? 'border-violet-500 bg-violet-500/15 text-violet-300'
                  : 'border-slate-800 bg-[#0f172a] text-slate-400 hover:text-slate-200'
              }`}
            >
              {st}
            </button>
          ))}
        </div>
      </div>

      {/* Library Grid */}
      {filtered.length === 0 ? (
        <div className="bg-[#0f172a] border border-slate-800 rounded-xl p-10 text-center space-y-3">
          <Film className="w-8 h-8 text-slate-500 mx-auto" />
          <div className="text-sm font-medium text-slate-200">No meme videos found</div>
          <p className="text-xs text-slate-400 max-w-md mx-auto">
            Upload your 5 meme Shorts to validate dimensions, generate thumbnails, run optional AI safety checks, and schedule them automatically.
          </p>
          <button
            type="button"
            onClick={() => onNavigate('upload')}
            className="px-4 py-2 text-xs font-medium rounded-lg bg-violet-600 hover:bg-violet-500 text-white cursor-pointer"
          >
            Upload Shorts
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((video) => {
            const isBusy = busyVideoId === video.id;
            return (
              <div
                key={video.id}
                className="bg-[#0f172a] border border-slate-800 rounded-xl overflow-hidden flex flex-col"
              >
                {/* Thumbnail + Play Trigger */}
                <div className="relative h-44 bg-slate-950 border-b border-slate-800 flex items-center justify-center overflow-hidden group">
                  {video.hasThumbnail ? (
                    <img
                      src={`/api/videos/${video.id}/thumbnail`}
                      alt={video.originalFileName}
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    <Film className="w-8 h-8 text-slate-600" />
                  )}
                  <button
                    type="button"
                    onClick={() => setPreviewVideo(video)}
                    className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer"
                    aria-label={`Preview ${video.originalFileName}`}
                  >
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900/90 border border-slate-700 text-xs font-medium text-slate-100">
                      <Play className="w-3.5 h-3.5 text-cyan-400" />
                      Preview Short
                    </span>
                  </button>
                  <div className="absolute top-2.5 left-2.5 px-2 py-0.5 rounded bg-slate-950/85 border border-slate-800 text-[11px] font-mono text-slate-200 capitalize">
                    {video.folderStage}
                  </div>
                  <div className="absolute top-2.5 right-2.5 px-2 py-0.5 rounded bg-slate-950/85 border border-slate-800 text-[11px] font-mono tabular-nums text-cyan-400">
                    {video.validation.aspectRatio}
                  </div>
                </div>

                {/* Details */}
                <div className="p-4 flex-1 flex flex-col justify-between space-y-3">
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <h4 className="text-sm font-semibold text-slate-100 truncate">
                        {video.originalFileName}
                      </h4>
                    </div>
                    <div className="text-[11px] font-mono tabular-nums text-slate-400">
                      {(video.fileSizeBytes / (1024 * 1024)).toFixed(2)} MB ·{' '}
                      {video.validation.width && video.validation.height
                        ? `${video.validation.width}×${video.validation.height}`
                        : 'Pending dims'}{' '}
                      ·{' '}
                      {video.validation.durationSec !== null
                        ? `${video.validation.durationSec}s`
                        : '—'}{' '}
                      · {video.validation.fps ? `${video.validation.fps}fps` : '—'} ·{' '}
                      {video.validation.hasAudio === true
                        ? 'Audio OK'
                        : video.validation.hasAudio === false
                        ? 'No Audio'
                        : 'Audio ?'}
                    </div>

                    {/* FFprobe notes */}
                    <div className="text-xs text-slate-400 leading-relaxed">
                      {video.validation.status === 'passed' ? (
                        <span className="inline-flex items-center gap-1 text-emerald-400">
                          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                          {video.validation.notes[0]}
                        </span>
                      ) : (
                        <span className="inline-flex items-start gap-1 text-amber-300">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                          <span>{video.validation.notes[0]}</span>
                        </span>
                      )}
                    </div>

                    {/* AI Analysis Result */}
                    {video.aiAnalysis && (
                      <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 space-y-1.5 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="text-violet-400 font-medium">AI Meme Check</span>
                          <span
                            className={`font-mono text-[11px] ${
                              video.aiAnalysis.appropriateForChannel
                                ? 'text-emerald-400'
                                : 'text-rose-400'
                            }`}
                          >
                            {video.aiAnalysis.appropriateForChannel ? 'Suitable' : 'Flagged'} · Risk:{' '}
                            {video.aiAnalysis.copyrightRiskLevel}
                          </span>
                        </div>
                        <p className="text-slate-300">{video.aiAnalysis.memeContext}</p>
                        <p className="text-slate-400">
                          Punchline: {video.aiAnalysis.jokeAndPunchline}
                        </p>
                        <p className="text-cyan-400">
                          Audio Mood: {video.aiAnalysis.recommendedAudioMood}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="pt-3 border-t border-slate-800 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => onAnalyzeVideo(video.id)}
                      disabled={isBusy}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-200 disabled:opacity-50 cursor-pointer"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-violet-400" />
                      {isBusy ? 'Analyzing...' : video.aiAnalysis ? 'Re-Analyze' : 'AI Analyze'}
                    </button>

                    <div className="flex items-center gap-1.5">
                      {video.folderStage !== 'published' && (
                        <>
                          <button
                            type="button"
                            onClick={() => onRequestPublish(video)}
                            disabled={isBusy}
                            className="px-2.5 py-1.5 text-xs font-medium rounded-lg bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-50 cursor-pointer"
                          >
                            Publish Now
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteVideo(video.id)}
                            disabled={isBusy}
                            className="p-1.5 rounded-lg border border-slate-800 text-slate-400 hover:text-rose-400 hover:border-rose-500/40 cursor-pointer"
                            title="Delete before publication"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Video Preview Modal */}
      {previewVideo && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="bg-[#0f172a] border border-slate-700 rounded-xl max-w-lg w-full overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
              <div className="min-w-0">
                <h4 className="text-sm font-semibold text-slate-100 truncate">
                  {previewVideo.originalFileName}
                </h4>
                <p className="text-[11px] font-mono text-slate-400">
                  Fixed Title: {previewVideo.fixedTitle}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewVideo(null)}
                className="p-1.5 text-slate-400 hover:text-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="bg-black flex items-center justify-center max-h-[65vh]">
              {previewObjectUrl ? (
                <video
                  src={previewObjectUrl}
                  controls
                  autoPlay
                  className="max-h-[65vh] w-auto"
                />
              ) : (
                <div className="p-12 text-xs text-slate-400">
                  Loading local video preview...
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
