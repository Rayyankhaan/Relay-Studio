import {
  CheckCircle2,
  FolderSync,
  Lock,
  UploadCloud,
  X,
} from 'lucide-react';
import { useRef, useState } from 'react';
import type { DashboardSnapshot, VideoRecord } from '../types.ts';
import {
  computeBlobSha256,
  safeFetchJson,
  saveLocalVideoBlob,
} from '../lib/clipStorage.ts';

interface UploadShortsViewProps {
  snapshot: DashboardSnapshot;
  onUploadComplete: () => Promise<void>;
  onNotify: (msg: string, level: 'success' | 'error' | 'info') => void;
  onNavigate: (tab: string) => void;
}

export function UploadShortsView({
  snapshot,
  onUploadComplete,
  onNotify,
  onNavigate,
}: UploadShortsViewProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [lastSummary, setLastSummary] = useState<{
    imported: VideoRecord[];
    duplicates: VideoRecord[];
    errors: string[];
  } | null>(null);

  const handleAddFiles = (fileList: FileList | null) => {
    if (!fileList) return;
    const valid = Array.from(fileList).filter((f) =>
      /\.(mp4|mov|webm)$/i.test(f.name)
    );
    if (valid.length === 0) {
      onNotify('Select MP4, MOV, or WebM video files only.', 'error');
      return;
    }
    setSelectedFiles((prev) => [...prev, ...valid].slice(0, 10));
  };

  const removeSelected = (index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleUploadBatch = async () => {
    if (selectedFiles.length === 0) return;
    setUploading(true);
    setLastSummary(null);

    try {
      const totalBytes = selectedFiles.reduce((s, f) => s + f.size, 0);

      // Vercel serverless functions have a ~4.5 MB payload cap; cache locally in IndexedDB and register metadata when needed
      if (snapshot.environment.isVercel && totalBytes > 4 * 1024 * 1024) {
        const imported: VideoRecord[] = [];
        const duplicates: VideoRecord[] = [];
        const errors: string[] = [];

        for (const file of selectedFiles) {
          try {
            const sha256 = await computeBlobSha256(file);
            const res = await safeFetchJson<{ duplicate: boolean; video: VideoRecord }>(
              '/api/videos/register',
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  originalFileName: file.name,
                  fileSizeBytes: file.size,
                  sha256,
                }),
              }
            );
            if (res.duplicate) {
              duplicates.push(res.video);
            } else {
              await saveLocalVideoBlob(res.video.id, file);
              imported.push(res.video);
            }
          } catch (err) {
            errors.push(
              `${file.name}: ${err instanceof Error ? err.message : 'Registration failed'}`
            );
          }
        }
        setLastSummary({ imported, duplicates, errors });
        setSelectedFiles([]);
        await onUploadComplete();
        onNotify(
          `Imported ${imported.length} Short(s)${duplicates.length ? `, skipped ${duplicates.length} duplicate(s)` : ''}.`,
          errors.length > 0 && imported.length === 0 ? 'error' : 'success'
        );
        return;
      }

      const form = new FormData();
      for (const file of selectedFiles) {
        form.append('videos', file);
      }

      const res = await safeFetchJson<{
        imported: VideoRecord[];
        duplicates: VideoRecord[];
        errors: string[];
      }>('/api/videos/upload', {
        method: 'POST',
        body: form,
      });

      setLastSummary(res);
      setSelectedFiles([]);
      await onUploadComplete();
      onNotify(
        `Imported ${res.imported.length} Short(s)${res.duplicates.length ? `, ${res.duplicates.length} duplicate(s) skipped` : ''}.`,
        res.errors.length > 0 && res.imported.length === 0 ? 'error' : 'success'
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Upload failed.', 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleScanIncoming = async () => {
    setScanning(true);
    try {
      const res = await safeFetchJson<{
        imported: number;
        duplicates: number;
        errors: string[];
      }>('/api/folder/scan', { method: 'POST' });
      await onUploadComplete();
      onNotify(
        `Folder scan complete: ${res.imported} imported, ${res.duplicates} duplicate(s) skipped.`,
        res.errors.length > 0 ? 'error' : 'info'
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Folder scan failed.', 'error');
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Locked Fixed Metadata Notice */}
      <div className="bg-[#0f172a] border border-slate-800 rounded-xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs text-violet-400 font-medium">
            <Lock className="w-3.5 h-3.5" />
            <span>Locked Channel Metadata (Applied Automatically to All Shorts)</span>
          </div>
          <div className="text-base font-mono text-slate-100 select-all">
            {snapshot.fixedMetadata.title}
          </div>
          <p className="text-xs text-slate-400">
            Zero manual title editing or extra hashtags. Every uploaded video inherits this exact title, description, and hashtag set.
          </p>
        </div>
        <button
          type="button"
          onClick={handleScanIncoming}
          disabled={scanning}
          className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-200 disabled:opacity-50 transition-colors cursor-pointer shrink-0"
        >
          <FolderSync className={`w-4 h-4 text-cyan-400 ${scanning ? 'animate-spin' : ''}`} />
          Scan shorts/incoming/
        </button>
      </div>

      {/* Drag & Drop Zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragActive(false);
          handleAddFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-10 text-center transition-colors cursor-pointer ${
          dragActive
            ? 'border-violet-500 bg-violet-500/10'
            : 'border-slate-700 bg-[#0f172a] hover:border-slate-600'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".mp4,.mov,.webm,video/mp4,video/quicktime,video/webm"
          className="hidden"
          onChange={(e) => {
            handleAddFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <div className="w-12 h-12 mx-auto rounded-lg bg-slate-900 border border-slate-700 flex items-center justify-center mb-3">
          <UploadCloud className="w-6 h-6 text-violet-400" />
        </div>
        <h3 className="text-sm font-semibold text-slate-100">
          Drop your 5 daily meme videos here, or click to browse
        </h3>
        <p className="text-xs text-slate-400 mt-1.5">
          Supports MP4, MOV, WebM · Vertical 9:16 preferred · Automatic SHA-256 duplicate protection &amp; FFprobe validation
        </p>
      </div>

      {/* Selected Batch Queue */}
      {selectedFiles.length > 0 && (
        <div className="bg-[#0f172a] border border-slate-800 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-100">
              Ready to Import ({selectedFiles.length} video{selectedFiles.length === 1 ? '' : 's'})
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSelectedFiles([])}
                disabled={uploading}
                className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 cursor-pointer"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={handleUploadBatch}
                disabled={uploading}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium rounded-lg bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-50 transition-colors cursor-pointer"
              >
                {uploading ? 'Importing & Validating...' : 'Import & Schedule Batch'}
              </button>
            </div>
          </div>
          <div className="divide-y divide-slate-800">
            {selectedFiles.map((file, idx) => (
              <div
                key={`${file.name}-${idx}`}
                className="px-5 py-3 flex items-center justify-between gap-4 text-xs"
              >
                <div className="min-w-0">
                  <div className="text-slate-100 font-medium truncate">{file.name}</div>
                  <div className="text-slate-400 font-mono tabular-nums mt-0.5">
                    {(file.size / (1024 * 1024)).toFixed(2)} MB · {file.type || 'video'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeSelected(idx);
                  }}
                  disabled={uploading}
                  className="p-1.5 rounded-md text-slate-400 hover:text-rose-400 hover:bg-slate-800 cursor-pointer"
                  aria-label="Remove file"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Import Result Summary */}
      {lastSummary && (
        <div className="bg-[#0f172a] border border-slate-800 rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              Batch Import Complete
            </div>
            <button
              type="button"
              onClick={() => onNavigate('library')}
              className="text-xs text-cyan-400 hover:text-cyan-300 cursor-pointer"
            >
              Inspect in Video Library &rarr;
            </button>
          </div>
          <div className="grid grid-cols-3 gap-3 text-xs font-mono tabular-nums">
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
              <div className="text-slate-400">Imported</div>
              <div className="text-lg font-semibold text-emerald-400 mt-0.5">
                {lastSummary.imported.length}
              </div>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
              <div className="text-slate-400">Duplicates Skipped</div>
              <div className="text-lg font-semibold text-amber-400 mt-0.5">
                {lastSummary.duplicates.length}
              </div>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
              <div className="text-slate-400">Errors</div>
              <div className="text-lg font-semibold text-rose-400 mt-0.5">
                {lastSummary.errors.length}
              </div>
            </div>
          </div>
          {lastSummary.errors.length > 0 && (
            <ul className="text-xs text-rose-300 space-y-1 pt-1">
              {lastSummary.errors.map((err, i) => (
                <li key={i}>{err}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
