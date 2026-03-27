import { useState, useEffect, useCallback } from 'react';
import {
  CheckCircleIcon,
  AlertTriangleIcon,
  WrenchIcon,
  RefreshCwIcon,
  Loader2Icon,
  AlertCircleIcon,
} from 'lucide-react';
import { legion } from '@/lib/ipc-client';

interface HealthData {
  entry_count?: number;
  orphan_count?: number;
  index_status?: string;
  quality_score?: number;
  last_maintenance?: string;
}

type LoadState = 'loading' | 'loaded' | 'error';
type MaintainState = 'idle' | 'running' | 'success' | 'error';

function qualityColor(score: number): string {
  if (score >= 80) return 'text-emerald-400';
  if (score >= 50) return 'text-amber-400';
  return 'text-red-400';
}

export function HealthTab() {
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [health, setHealth] = useState<HealthData | null>(null);
  const [maintainState, setMaintainState] = useState<MaintainState>('idle');
  const [maintainMessage, setMaintainMessage] = useState('');

  const fetchHealth = useCallback(async () => {
    setLoadState('loading');
    setLoadError('');
    try {
      const result = await legion.knowledge.health();
      if (result.ok) {
        setHealth((result.data as HealthData) ?? {});
        setLoadState('loaded');
      } else {
        setLoadError(result.error ?? 'Failed to fetch health data');
        setLoadState('error');
      }
    } catch (err) {
      setLoadError(String(err));
      setLoadState('error');
    }
  }, []);

  useEffect(() => {
    fetchHealth();
  }, [fetchHealth]);

  const runMaintenance = useCallback(async () => {
    setMaintainState('running');
    setMaintainMessage('');
    try {
      const result = await legion.knowledge.maintain();
      if (result.ok) {
        setMaintainState('success');
        const data = result.data as { message?: string } | undefined;
        setMaintainMessage(data?.message ?? 'Maintenance completed successfully.');
        fetchHealth();
      } else {
        setMaintainState('error');
        setMaintainMessage(result.error ?? 'Maintenance failed.');
      }
    } catch (err) {
      setMaintainState('error');
      setMaintainMessage(String(err));
    }
  }, [fetchHealth]);

  if (loadState === 'loading') {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2Icon className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (loadState === 'error') {
    return (
      <div className="p-6 space-y-4">
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4 flex items-start gap-3">
          <AlertCircleIcon className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-red-400">Failed to load health data</p>
            <p className="mt-1 text-xs text-muted-foreground">{loadError}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={fetchHealth}
          className="flex items-center gap-1.5 rounded-lg border border-border/50 px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted/50"
        >
          <RefreshCwIcon className="h-3.5 w-3.5" />
          Retry
        </button>
      </div>
    );
  }

  const h = health ?? {};
  const qualityPct = h.quality_score !== undefined ? Math.round(h.quality_score) : null;

  return (
    <div className="p-6 space-y-6">
      {/* Status cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {/* Entries */}
        <div className="rounded-lg border border-border/50 bg-card/30 p-4 space-y-1">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Entries</p>
          <p className="text-2xl font-bold">
            {h.entry_count !== undefined ? h.entry_count.toLocaleString() : '—'}
          </p>
        </div>

        {/* Orphans */}
        <div className="rounded-lg border border-border/50 bg-card/30 p-4 space-y-1">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Orphans</p>
          <p className={`text-2xl font-bold ${h.orphan_count !== undefined && h.orphan_count > 0 ? 'text-amber-400' : ''}`}>
            {h.orphan_count !== undefined ? h.orphan_count.toLocaleString() : '—'}
          </p>
        </div>

        {/* Index */}
        <div className="rounded-lg border border-border/50 bg-card/30 p-4 space-y-1">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Index</p>
          {h.index_status !== undefined ? (
            <div className="flex items-center gap-2 pt-1">
              {h.index_status === 'healthy' ? (
                <CheckCircleIcon className="h-5 w-5 text-emerald-400 shrink-0" />
              ) : (
                <AlertTriangleIcon className="h-5 w-5 text-amber-400 shrink-0" />
              )}
              <span className="text-sm font-medium capitalize">{h.index_status}</span>
            </div>
          ) : (
            <p className="text-2xl font-bold">—</p>
          )}
        </div>

        {/* Quality */}
        <div className="rounded-lg border border-border/50 bg-card/30 p-4 space-y-1">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Quality</p>
          <p className={`text-2xl font-bold ${qualityPct !== null ? qualityColor(qualityPct) : ''}`}>
            {qualityPct !== null ? `${qualityPct}%` : '—'}
          </p>
        </div>
      </div>

      {/* Last maintenance */}
      {h.last_maintenance && (
        <p className="text-xs text-muted-foreground">
          Last maintenance:{' '}
          <span className="text-foreground">
            {new Date(h.last_maintenance).toLocaleString()}
          </span>
        </p>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={runMaintenance}
          disabled={maintainState === 'running'}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {maintainState === 'running' ? (
            <Loader2Icon className="h-4 w-4 animate-spin" />
          ) : (
            <WrenchIcon className="h-4 w-4" />
          )}
          {maintainState === 'running' ? 'Running…' : 'Run Maintenance'}
        </button>

        <button
          type="button"
          onClick={fetchHealth}
          className="flex items-center gap-2 rounded-lg border border-border/50 px-4 py-2 text-sm font-medium transition-colors hover:bg-muted/50"
        >
          <RefreshCwIcon className="h-4 w-4" />
          Refresh
        </button>
      </div>

      {/* Maintenance result */}
      {(maintainState === 'success' || maintainState === 'error') && maintainMessage && (
        <div
          className={`rounded-lg border p-4 flex items-start gap-3 ${
            maintainState === 'success'
              ? 'border-emerald-500/30 bg-emerald-500/5'
              : 'border-red-500/30 bg-red-500/5'
          }`}
        >
          {maintainState === 'success' ? (
            <CheckCircleIcon className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
          ) : (
            <AlertCircleIcon className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
          )}
          <p className={`text-sm ${maintainState === 'success' ? 'text-emerald-400' : 'text-red-400'}`}>
            {maintainMessage}
          </p>
        </div>
      )}
    </div>
  );
}
