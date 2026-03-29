import { useState, useCallback, type DragEvent } from 'react';
import {
  UploadIcon,
  FileIcon,
  FolderOpenIcon,
  Loader2Icon,
  CheckCircleIcon,
  XCircleIcon,
} from 'lucide-react';
import { legion } from '@/lib/ipc-client';

type IngestStatus = 'pending' | 'ingesting' | 'done' | 'error';

interface QueueItem {
  id: string;
  path: string;
  name: string;
  status: IngestStatus;
  error?: string;
}

type DialogResult = { canceled: boolean; files?: Array<{ path: string; name: string }> };

function basename(filePath: string): string {
  return filePath.split('/').pop() ?? filePath;
}

export function IngestTab() {
  const [dragOver, setDragOver] = useState(false);
  const [queue, setQueue] = useState<QueueItem[]>([]);

  const updateItem = useCallback((id: string, patch: Partial<QueueItem>) => {
    setQueue((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }, []);

  const runQueue = useCallback(async (items: QueueItem[]) => {
    for (const item of items) {
      updateItem(item.id, { status: 'ingesting' });
      try {
        const result = await legion.knowledge.ingestFile(item.path);
        if (result.ok) {
          updateItem(item.id, { status: 'done' });
        } else {
          updateItem(item.id, { status: 'error', error: result.error ?? 'Ingest failed' });
        }
      } catch (err) {
        updateItem(item.id, {
          status: 'error',
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }
  }, [updateItem]);

  const enqueuePaths = useCallback((paths: string[]) => {
    const newItems: QueueItem[] = paths.map((p) => ({
      id: `${Date.now()}-${Math.random()}`,
      path: p,
      name: basename(p),
      status: 'pending' as IngestStatus,
    }));
    setQueue((prev) => [...prev, ...newItems]);
    void runQueue(newItems);
  }, [runQueue]);

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    const paths = files
      .map((f) => (f as File & { path?: string }).path)
      .filter((p): p is string => typeof p === 'string' && p.length > 0);
    if (paths.length > 0) enqueuePaths(paths);
  }, [enqueuePaths]);

  const handlePickFiles = useCallback(async () => {
    const raw = await legion.dialog.openFile({
      filters: [
        { name: 'Documents', extensions: ['pdf', 'docx', 'xlsx', 'pptx', 'html', 'htm', 'md', 'csv', 'json', 'txt'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    }) as DialogResult | undefined;
    if (!raw || raw.canceled || !raw.files || raw.files.length === 0) return;
    const paths = raw.files
      .map((f) => f.path)
      .filter((p): p is string => typeof p === 'string' && p.length > 0);
    if (paths.length > 0) enqueuePaths(paths);
  }, [enqueuePaths]);

  const handlePickDirectory = useCallback(async () => {
    const result = await legion.dialog.openDirectoryFiles();
    if (result.canceled || result.filePaths.length === 0) return;
    enqueuePaths(result.filePaths);
  }, [enqueuePaths]);

  return (
    <div className="space-y-6 p-6">
      {/* Drop zone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`flex flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed p-10 text-center transition-colors ${
          dragOver
            ? 'border-primary bg-primary/5'
            : 'border-border/60 hover:border-border'
        }`}
      >
        <UploadIcon
          className={`h-10 w-10 transition-colors ${dragOver ? 'text-primary' : 'text-muted-foreground/50'}`}
        />
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">
            Drop files here to ingest into Apollo
          </p>
          <p className="text-xs text-muted-foreground">
            PDF, DOCX, XLSX, PPTX, HTML, Markdown, CSV, JSON, TXT
          </p>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-3">
        <button
          type="button"
          onClick={handlePickFiles}
          className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/70"
        >
          <FileIcon className="h-4 w-4 text-muted-foreground" />
          Pick Files
        </button>
        <button
          type="button"
          onClick={handlePickDirectory}
          className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/70"
        >
          <FolderOpenIcon className="h-4 w-4 text-muted-foreground" />
          Pick Directory
        </button>
      </div>

      {/* Ingest queue */}
      {queue.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Ingest Queue
          </p>
          <div className="space-y-1.5">
            {queue.map((item) => (
              <QueueRow key={item.id} item={item} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function QueueRow({ item }: { item: QueueItem }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border/50 bg-muted/20 px-3 py-2">
      <StatusIcon status={item.status} />
      <span className="flex-1 truncate text-sm text-foreground" title={item.path}>
        {item.name}
      </span>
      {item.status === 'error' && item.error && (
        <span className="ml-2 shrink-0 text-xs text-red-400" title={item.error}>
          {item.error.length > 40 ? `${item.error.slice(0, 40)}…` : item.error}
        </span>
      )}
    </div>
  );
}

function StatusIcon({ status }: { status: IngestStatus }) {
  switch (status) {
    case 'pending':
      return <FileIcon className="h-4 w-4 shrink-0 text-muted-foreground" />;
    case 'ingesting':
      return <Loader2Icon className="h-4 w-4 shrink-0 animate-spin text-primary" />;
    case 'done':
      return <CheckCircleIcon className="h-4 w-4 shrink-0 text-emerald-400" />;
    case 'error':
      return <XCircleIcon className="h-4 w-4 shrink-0 text-red-400" />;
  }
}
