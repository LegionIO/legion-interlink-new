import { useState, useCallback, type FC, type ReactNode, type DragEvent } from 'react';
import { UploadCloudIcon, CheckCircle2Icon, AlertCircleIcon, Loader2Icon, FileIcon } from 'lucide-react';
import { legion } from '@/lib/ipc-client';

interface IngestResult {
  name: string;
  ok: boolean;
  error?: string;
}

export const KnowledgeDropZone: FC<{ children: ReactNode }> = ({ children }) => {
  const [dragging, setDragging] = useState(false);
  const [ingesting, setIngesting] = useState(false);
  const [results, setResults] = useState<IngestResult[]>([]);
  const [showResults, setShowResults] = useState(false);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes('Files')) {
      setDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only leave if we're exiting the zone (not entering a child)
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
      setDragging(false);
    }
  }, []);

  const handleDrop = useCallback(async (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    setIngesting(true);
    setResults([]);
    setShowResults(true);

    const newResults: IngestResult[] = [];
    for (const file of files) {
      const filePath = (file as File & { path?: string }).path;
      if (!filePath) {
        newResults.push({ name: file.name, ok: false, error: 'No file path available (sandbox restriction)' });
        continue;
      }
      try {
        const res = await legion.knowledge.ingestFile(filePath);
        newResults.push({ name: file.name, ok: res.ok, error: res.error });
      } catch (err) {
        newResults.push({ name: file.name, ok: false, error: err instanceof Error ? err.message : 'Ingest failed' });
      }
    }

    setResults(newResults);
    setIngesting(false);

    // Auto-hide results after 8 seconds if all succeeded
    if (newResults.every((r) => r.ok)) {
      setTimeout(() => setShowResults(false), 8000);
    }
  }, []);

  return (
    <div
      className="relative flex h-full flex-col"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={(e) => void handleDrop(e)}
    >
      {children}

      {/* Drop overlay */}
      {dragging && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-primary/5 backdrop-blur-sm border-2 border-dashed border-primary/40 rounded-lg m-2">
          <div className="flex flex-col items-center gap-3 text-primary">
            <UploadCloudIcon className="h-12 w-12 opacity-70" />
            <p className="text-sm font-medium">Drop files to ingest into Knowledge</p>
            <p className="text-xs opacity-60">Supports text, markdown, PDF, DOCX, and more</p>
          </div>
        </div>
      )}

      {/* Ingest results banner */}
      {showResults && (results.length > 0 || ingesting) && (
        <div className="absolute bottom-4 left-4 right-4 z-40 rounded-xl border border-border/50 bg-popover/95 p-3 shadow-lg backdrop-blur-xl">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium">
              {ingesting ? 'Ingesting files...' : `Ingested ${results.filter((r) => r.ok).length}/${results.length} files`}
            </span>
            {!ingesting && (
              <button type="button" onClick={() => setShowResults(false)} className="text-[10px] text-muted-foreground hover:text-foreground">
                Dismiss
              </button>
            )}
          </div>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {results.map((r, i) => (
              <div key={i} className="flex items-center gap-2 text-[11px]">
                {r.ok
                  ? <CheckCircle2Icon className="h-3 w-3 shrink-0 text-emerald-400" />
                  : <AlertCircleIcon className="h-3 w-3 shrink-0 text-red-400" />
                }
                <FileIcon className="h-3 w-3 shrink-0 text-muted-foreground/50" />
                <span className="truncate">{r.name}</span>
                {r.error && <span className="shrink-0 text-red-400/70 truncate max-w-[150px]">{r.error}</span>}
              </div>
            ))}
            {ingesting && (
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <Loader2Icon className="h-3 w-3 animate-spin" />Processing...
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
