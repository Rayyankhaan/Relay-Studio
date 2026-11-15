import { useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  FolderSync,
  Play,
  Send,
  Trash2,
  Upload,
} from 'lucide-react';
import { formatFileSize, formatTier1Slot } from '../constants/assets.ts';
import type { AutomationState, ClipItem, ClipStatus } from '../types.ts';

interface FolderPipelineViewProps {
  state: AutomationState;
  onUploadClips: (files: FileList | File[]) => Promise<void>;
  onScanFolder: () => Promise<void>;
  onUpdateClip: (id: string, patch: Partial<ClipItem>) => Promise<void>;
  onDeleteClip: (id: string) => Promise<void>;
  onRunClip: (id: string, youtubeUrl?: string) => Promise<void>;
  uploading: boolean;
  scanning: boolean;
  busyClipId: string | null;
}

function ClipStatusLabel({ status }: { status: ClipStatus }) {
  if (status === 'submitted') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 whitespace-nowrap">
        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
        Submitted
      </span>
    );
  }
  if (status === 'scheduled') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 whitespace-nowrap">
        <Clock className="w-3.5 h-3.5 text-amber-600 shrink-0" />
        Scheduled
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-rose-700 whitespace-nowrap">
        <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
        Failed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 whitespace-nowrap">
      <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
      In Folder
    </span>
  );
}

export function FolderPipelineView({
  state,
  onUploadClips,
  onScanFolder,
  onUpdateClip,
  onDeleteClip,
  onRunClip,
  uploading,
  scanning,
  busyClipId,
}: FolderPipelineViewProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [selectedId, setSelectedId] = useState<string>(state.clips[0]?.id ?? '');
  const [pasteUrl, setPasteUrl] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const selectedClip =
    state.clips.find((c) => c.id === selectedId) ?? state.clips[0] ?? null;

  const campaignMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of state.campaigns) map.set(c.id, c.name);
    return map;
  }, [state.campaigns]);

  const scheduledCount = state.clips.filter((c) => c.status === 'scheduled').length;
  const submittedCount = state.clips.filter((c) => c.status === 'submitted').length;

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await onUploadClips(e.dataTransfer.files);
    }
  };

  const handleCopy = async (clip: ClipItem) => {
    if (!clip.youtubeShortUrl) return;
    await navigator.clipboard.writeText(clip.youtubeShortUrl);
    setCopiedId(clip.id);
    window.setTimeout(() => setCopiedId(null), 1800);
  };

  return (
    <div className="flex flex-col gap-6">
      {/* 4-Column Summary Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 bg-white border border-slate-200 rounded-lg divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
        <div className="p-5 flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-500">Watch Folder</span>
          <span className="text-lg font-semibold text-slate-900 font-mono">
            {state.config.watchFolderPath}
          </span>
          <span className="text-xs text-slate-500">
            Filename becomes Short Title + Hashtags
          </span>
        </div>

        <div className="p-5 flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-500">Target Audience</span>
          <span className="text-lg font-semibold text-slate-900 font-mono">
            {state.config.targetRegions.join(' · ')}
          </span>
          <span className="text-xs text-slate-500">
            US, Canada & Australia Tier-1 feed
          </span>
        </div>

        <div className="p-5 flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-500">Queued Clips</span>
          <span className="text-2xl font-semibold text-slate-900 font-mono tabular-nums">
            {scheduledCount}
          </span>
          <span className="text-xs text-slate-500">
            {state.config.postsPerDay} uploads/day · {state.config.peakWindowsEst.join(', ')} EST
          </span>
        </div>

        <div className="p-5 flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-500">Submitted Links</span>
          <span className="text-2xl font-semibold text-slate-900 font-mono tabular-nums">
            {submittedCount}
          </span>
          <span className="text-xs text-slate-500">
            Auto-matched to Content Rewards
          </span>
        </div>
      </div>

      {/* Real Video Folder Dropzone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
        className={`bg-white border border-dashed rounded-lg p-6 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
          dragActive ? 'border-rose-500 bg-rose-50/40' : 'border-slate-300'
        }`}
      >
        <div className="flex items-start gap-3.5">
          <div className="w-10 h-10 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0 text-slate-700">
            <Upload className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Drop Video Shorts into {state.config.watchFolderPath}
            </h2>
            <p className="text-xs text-slate-600 mt-1">
              Name each clip as your Short title with hashtags, e.g.{' '}
              <span className="font-mono text-slate-800">
                3 Mistakes Costing You Money #finance #whop #shorts.mp4
              </span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm,.mkv,.m4v"
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                onUploadClips(e.target.files);
                e.target.value = '';
              }
            }}
          />
          <button
            type="button"
            disabled={scanning}
            onClick={onScanFolder}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap cursor-pointer"
          >
            <FolderSync className={`w-3.5 h-3.5 ${scanning ? 'animate-spin' : ''}`} />
            {scanning ? 'Scanning...' : 'Scan Folder'}
          </button>
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50 whitespace-nowrap cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5" />
            {uploading ? 'Uploading Clips...' : 'Upload Clips'}
          </button>
        </div>
      </div>

      {/* Main Workspace: Clip Queue Table + Video & Title Inspector */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        <div className="xl:col-span-8 bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">
              Folder Clips Queue ({state.clips.length})
            </h3>
            <span className="text-xs text-slate-500">
              Targeting US · CA · AU
            </span>
          </div>

          {state.clips.length === 0 ? (
            <div className="p-12 text-center flex flex-col items-center gap-2.5">
              <p className="text-sm font-medium text-slate-800">
                Your {state.config.watchFolderPath} folder is empty
              </p>
              <p className="text-xs text-slate-500 max-w-md">
                Upload `.mp4`, `.mov`, or `.webm` clips above. The automation automatically turns each file name into the Short Title, extracts all `#hashtags`, schedules Tier-1 US/CA/AU slots, and handles Content Rewards submission.
              </p>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="mt-2 px-4 py-2 text-xs font-medium rounded-lg bg-slate-900 text-white hover:bg-slate-800 cursor-pointer"
              >
                Select Video Clips
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-medium text-slate-500">
                    <th className="py-2.5 px-4">Short Title (From File Name)</th>
                    <th className="py-2.5 px-3">US / CA / AU Slot</th>
                    <th className="py-2.5 px-3">Campaign</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {state.clips.map((clip) => {
                    const active = selectedClip?.id === clip.id;
                    const busy = busyClipId === clip.id;
                    return (
                      <tr
                        key={clip.id}
                        onClick={() => {
                          setSelectedId(clip.id);
                          setPasteUrl(clip.youtubeShortUrl || '');
                        }}
                        className={`transition-colors cursor-pointer ${
                          active ? 'bg-slate-50' : 'hover:bg-slate-50/60'
                        }`}
                      >
                        <td className="py-3 px-4 max-w-[280px]">
                          <div className="font-medium text-slate-900 truncate text-[13px]">
                            {clip.shortTitle}
                          </div>
                          <div className="text-xs text-slate-500 truncate mt-0.5 font-mono">
                            {clip.hashtags.join(' ')} · {formatFileSize(clip.fileSizeBytes)}
                          </div>
                        </td>
                        <td className="py-3 px-3 text-xs text-slate-600 font-mono tabular-nums whitespace-nowrap">
                          {formatTier1Slot(clip.scheduledAt)}
                        </td>
                        <td className="py-3 px-3 text-xs text-slate-700 max-w-[140px] truncate">
                          {campaignMap.get(clip.campaignId) || 'Unassigned'}
                        </td>
                        <td className="py-3 px-3">
                          <ClipStatusLabel status={clip.status} />
                        </td>
                        <td
                          className="py-3 px-4 text-right whitespace-nowrap"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="inline-flex items-center justify-end gap-1.5">
                            {clip.youtubeShortUrl ? (
                              <button
                                type="button"
                                onClick={() => handleCopy(clip)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 cursor-pointer"
                              >
                                {copiedId === clip.id ? (
                                  <>
                                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                                    Copied
                                  </>
                                ) : (
                                  <>
                                    <Copy className="w-3.5 h-3.5" />
                                    Copy Link
                                  </>
                                )}
                              </button>
                            ) : (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => onRunClip(clip.id)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50 cursor-pointer"
                              >
                                <Send className="w-3 h-3" />
                                {busy ? 'Running...' : 'Run Now'}
                              </button>
                            )}
                            <button
                              type="button"
                              aria-label="Delete clip"
                              onClick={() => onDeleteClip(clip.id)}
                              className="p-1.5 text-slate-400 hover:text-rose-600 rounded-md hover:bg-slate-100 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Right: Uploaded Video Player & Title/Hashtag Inspector */}
        <div className="xl:col-span-4 bg-white border border-slate-200 rounded-lg p-5 flex flex-col gap-4">
          {selectedClip ? (
            <>
              <div className="flex items-start justify-between gap-2 border-b border-slate-100 pb-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-mono text-slate-500 truncate">
                    {selectedClip.fileName}
                  </p>
                  <h3 className="text-sm font-semibold text-slate-900 mt-0.5 leading-snug">
                    {selectedClip.shortTitle}
                  </h3>
                </div>
                <ClipStatusLabel status={selectedClip.status} />
              </div>

              {selectedClip.hasVideoFile ? (
                <div className="mx-auto w-full max-w-[240px] aspect-[9/16] rounded-lg overflow-hidden bg-slate-950 border border-slate-200">
                  <video
                    key={selectedClip.id}
                    src={`/api/clips/${encodeURIComponent(selectedClip.id)}/video`}
                    controls
                    playsInline
                    className="w-full h-full object-contain"
                  />
                </div>
              ) : (
                <div className="py-10 text-center text-xs text-slate-500 bg-slate-50 rounded-lg border border-slate-200">
                  Video file removed from {state.config.watchFolderPath}
                </div>
              )}

              <div className="flex flex-col gap-3 pt-2 border-t border-slate-100 text-xs">
                <div>
                  <label className="font-medium text-slate-700">
                    Short Title (Auto-Parsed Hashtags)
                  </label>
                  <input
                    type="text"
                    value={selectedClip.shortTitle}
                    onChange={(e) =>
                      onUpdateClip(selectedClip.id, { shortTitle: e.target.value })
                    }
                    className="mt-1 w-full px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg text-slate-900"
                  />
                  <p className="mt-1 font-mono text-[11px] text-slate-500">
                    Extracted tags: {selectedClip.hashtags.join(' ')}
                  </p>
                </div>

                <div>
                  <label className="font-medium text-slate-700">
                    Content Rewards Campaign
                  </label>
                  <select
                    value={selectedClip.campaignId}
                    onChange={(e) =>
                      onUpdateClip(selectedClip.id, { campaignId: e.target.value })
                    }
                    className="mt-1 w-full px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg text-slate-900"
                  >
                    {state.campaigns.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.requiredTag})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="font-medium text-slate-700">
                    YouTube Short Link (Optional Paste or Auto-Capture)
                  </label>
                  <div className="mt-1 flex gap-2">
                    <input
                      type="url"
                      value={pasteUrl || selectedClip.youtubeShortUrl}
                      onChange={(e) => setPasteUrl(e.target.value)}
                      placeholder="https://youtube.com/shorts/..."
                      className="flex-1 min-w-0 px-3 py-1.5 text-xs font-mono bg-white border border-slate-200 rounded-lg text-slate-900"
                    />
                    <button
                      type="button"
                      disabled={busyClipId === selectedClip.id}
                      onClick={() =>
                        onRunClip(
                          selectedClip.id,
                          pasteUrl.trim() || selectedClip.youtubeShortUrl || undefined
                        )
                      }
                      className="px-3 py-1.5 text-xs font-medium rounded-lg bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50 whitespace-nowrap cursor-pointer"
                    >
                      {busyClipId === selectedClip.id ? 'Running...' : 'Submit'}
                    </button>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="py-12 text-center text-xs text-slate-500">
              Upload a clip to inspect its video, parsed title, hashtags, and submission link.
            </div>
          )}
        </div>
      </div>

      {/* Automation Activity Log */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">
            Automation Execution Log
          </h3>
          <span className="text-xs font-mono tabular-nums text-slate-500">
            {state.events.length} events
          </span>
        </div>
        {state.events.length === 0 ? (
          <div className="p-6 text-xs text-slate-500">
            No automation actions executed yet. Drop clips above to begin.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {state.events.slice(0, 10).map((evt) => (
              <div
                key={evt.id}
                className="px-5 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
              >
                <div className="flex items-start sm:items-center gap-3 min-w-0">
                  <Play className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5 sm:mt-0" />
                  <div className="min-w-0">
                    <span className="font-medium text-slate-900">{evt.stage}</span>
                    <span className="text-slate-400 mx-1.5">·</span>
                    <span className="text-slate-700">{evt.clipTitle}</span>
                    <p className="text-slate-500 truncate mt-0.5">{evt.detail}</p>
                  </div>
                </div>
                <span className="text-slate-400 font-mono tabular-nums whitespace-nowrap shrink-0">
                  {formatTier1Slot(evt.timestamp)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
