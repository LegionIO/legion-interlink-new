import { useState, useEffect, useCallback } from 'react';
import {
  FolderSyncIcon,
  PlusIcon,
  RefreshCwIcon,
  PlayIcon,
  Trash2Icon,
  Loader2Icon,
  AlertCircleIcon,
} from 'lucide-react';
import { legion } from '@/lib/ipc-client';

interface Monitor {
  id: string;
  path: string;
  file_count?: number;
  last_scan?: string;
  status?: string;
}

type DialogResult = { canceled: boolean; files?: Array<{ path: string }> };

function parseMonitors(data: unknown): Monitor[] {
  if (Array.isArray(data)) return data as Monitor[];
  if (data && typeof data === 'object' && Array.isArray((data as { monitors?: unknown }).monitors)) {
    return (data as { monitors: Monitor[] }).monitors;
  }
  return [];
}

function formatLastScan(ts: string): string {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
}

export function MonitorsTab() {
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [scanningIds, setScanningIds] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);

  const fetchMonitors = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await legion.knowledge.monitorsList();
      if (result.ok) {
        setMonitors(parseMonitors(result.data));
      } else {
        setError(result.error ?? 'Failed to load monitors');
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMonitors();
  }, [fetchMonitors]);

  const handleAddMonitor = async () => {
    setAdding(true);
    try {
      const raw = await legion.dialog.openFile();
      const result = raw as DialogResult;
      if (result.canceled || !result.files?.length) return;

      const selectedPath = result.files[0].path;
      // Use the directory of the selected file as the corpus path
      const dirPath = selectedPath.includes('/')
        ? selectedPath.substring(0, selectedPath.lastIndexOf('/'))
        : selectedPath;

      const addResult = await legion.knowledge.monitorAdd(dirPath);
      if (addResult.ok) {
        await fetchMonitors();
      } else {
        setError(addResult.error ?? 'Failed to add monitor');
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setAdding(false);
    }
  };

  const handleScan = async (id: string) => {
    setScanningIds((prev) => new Set(prev).add(id));
    try {
      await legion.knowledge.monitorScan(id);
      await fetchMonitors();
    } catch {
      // scan errors are non-fatal; list refresh will reflect any state change
    } finally {
      setScanningIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handleRemove = async (id: string) => {
    try {
      await legion.knowledge.monitorRemove(id);
      setMonitors((prev) => prev.filter((m) => m.id !== id));
    } catch (err) {
      setError(String(err));
    }
  };

  return (
    <div className="flex flex-col gap-4 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">Corpus Monitors</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={fetchMonitors}
            disabled={loading}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted/50 disabled:opacity-50"
            title="Refresh"
          >
            {loading ? (
              <Loader2Icon className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCwIcon className="h-4 w-4" />
            )}
          </button>
          <button
            type="button"
            onClick={handleAddMonitor}
            disabled={adding}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {adding ? (
              <Loader2Icon className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <PlusIcon className="h-3.5 w-3.5" />
            )}
            Add Monitor
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-start gap-2.5 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3">
          <AlertCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {/* Loading state */}
      {loading && monitors.length === 0 && (
        <div className="flex items-center justify-center py-12">
          <Loader2Icon className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Empty state */}
      {!loading && monitors.length === 0 && !error && (
        <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
          <FolderSyncIcon className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-sm font-medium text-muted-foreground">No monitors configured</p>
          <p className="text-xs text-muted-foreground/70">
            Add a directory to automatically scan and ingest its contents.
          </p>
        </div>
      )}

      {/* Monitor list */}
      {monitors.length > 0 && (
        <div className="flex flex-col gap-2">
          {monitors.map((monitor) => {
            const scanning = scanningIds.has(monitor.id);
            return (
              <div
                key={monitor.id}
                className="flex items-center gap-3 rounded-lg border border-border/50 bg-card/30 px-4 py-3"
              >
                <FolderSyncIcon className="h-4 w-4 shrink-0 text-muted-foreground" />

                {/* Path + metadata */}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium" title={monitor.path}>
                    {monitor.path}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {monitor.file_count !== undefined && (
                      <span>{monitor.file_count} files</span>
                    )}
                    {monitor.file_count !== undefined && monitor.last_scan && (
                      <span className="mx-1.5 opacity-40">&middot;</span>
                    )}
                    {monitor.last_scan && (
                      <span>Last scan: {formatLastScan(monitor.last_scan)}</span>
                    )}
                    {monitor.status && (
                      <>
                        {(monitor.file_count !== undefined || monitor.last_scan) && (
                          <span className="mx-1.5 opacity-40">&middot;</span>
                        )}
                        <span
                          className={
                            monitor.status === 'active' || monitor.status === 'ok'
                              ? 'text-emerald-400'
                              : monitor.status === 'error'
                                ? 'text-red-400'
                                : ''
                          }
                        >
                          {monitor.status}
                        </span>
                      </>
                    )}
                  </p>
                </div>

                {/* Scan button */}
                <button
                  type="button"
                  onClick={() => handleScan(monitor.id)}
                  disabled={scanning}
                  className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted/50 disabled:opacity-50"
                  title="Scan now"
                >
                  {scanning ? (
                    <Loader2Icon className="h-4 w-4 animate-spin" />
                  ) : (
                    <PlayIcon className="h-4 w-4" />
                  )}
                </button>

                {/* Remove button */}
                <button
                  type="button"
                  onClick={() => handleRemove(monitor.id)}
                  className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-400"
                  title="Remove monitor"
                >
                  <Trash2Icon className="h-4 w-4" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
