import { useState, useEffect, useCallback, useRef, type FC } from 'react';
import {
  RefreshCwIcon,
  LoaderIcon,
  WifiOffIcon,
  BarChart3Icon,
  ActivityIcon,
} from 'lucide-react';
import { type SettingsProps } from './shared';
import { legion } from '@/lib/ipc-client';

type LoadState = 'idle' | 'loading' | 'loaded' | 'error';

interface HealthData {
  uptime?: number;
  ruby_version?: string;
  pid?: number;
  hostname?: string;
  request_count?: number;
  avg_response_time?: number;
  error_rate?: number;
  rss_bytes?: number;
  heap_size?: number;
  amqp_connected?: boolean;
  cache_connected?: boolean;
  db_connected?: boolean;
  [key: string]: unknown;
}

const AUTO_REFRESH_MS = 10_000;

function formatBytes(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1_024) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3_600);
  const m = Math.floor((seconds % 3_600) / 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(' ');
}

const ConnectedBadge: FC<{ value: boolean }> = ({ value }) => (
  <span
    className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium border ${
      value
        ? 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20'
        : 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20'
    }`}
  >
    {value ? 'connected' : 'disconnected'}
  </span>
);

const MetricRow: FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="space-y-0.5">
    <p className="text-[10px] text-muted-foreground">{label}</p>
    <p className="text-xs font-mono">{value}</p>
  </div>
);

const SectionCard: FC<{ title: string; icon: React.ReactNode; children: React.ReactNode }> = ({
  title,
  icon,
  children,
}) => (
  <div className="rounded-lg border border-border/50 bg-muted/10 p-3 space-y-2">
    <div className="flex items-center gap-1.5">
      <span className="text-muted-foreground">{icon}</span>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
    </div>
    <div className="grid grid-cols-2 gap-x-4 gap-y-2">{children}</div>
  </div>
);

export const DaemonMetrics: FC<SettingsProps> = () => {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [loadError, setLoadError] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchHealth = useCallback(async () => {
    setLoadState('loading');
    setLoadError('');
    try {
      const result = await legion.daemon.health();
      if (result.ok) {
        setHealth((result.data as HealthData) ?? {});
        setLoadState('loaded');
      } else {
        setLoadError(result.error ?? 'Failed to fetch metrics');
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

  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(fetchHealth, AUTO_REFRESH_MS);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [autoRefresh, fetchHealth]);

  if (loadState === 'idle' || loadState === 'loading') {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-8 justify-center">
        <LoaderIcon className="h-4 w-4 animate-spin" />
        Loading metrics...
      </div>
    );
  }

  if (loadState === 'error') {
    return (
      <div className="space-y-4">
        <h3 className="text-sm font-semibold">Metrics</h3>
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 space-y-3">
          <div className="flex items-start gap-2">
            <WifiOffIcon className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-medium text-destructive">Failed to load metrics</p>
              <p className="text-[10px] text-muted-foreground mt-1">{loadError}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={fetchHealth}
            className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs hover:bg-muted transition-colors"
          >
            <RefreshCwIcon className="h-3 w-3" />
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!health) return null;

  const hasSystem =
    health.uptime !== undefined ||
    health.ruby_version !== undefined ||
    health.pid !== undefined ||
    health.hostname !== undefined;

  const hasPerformance =
    health.request_count !== undefined ||
    health.avg_response_time !== undefined ||
    health.error_rate !== undefined;

  const hasMemory =
    health.rss_bytes !== undefined || health.heap_size !== undefined;

  const hasConnections =
    health.amqp_connected !== undefined ||
    health.cache_connected !== undefined ||
    health.db_connected !== undefined;

  const knownKeys = new Set([
    'uptime', 'ruby_version', 'pid', 'hostname',
    'request_count', 'avg_response_time', 'error_rate',
    'rss_bytes', 'heap_size',
    'amqp_connected', 'cache_connected', 'db_connected',
  ]);

  const unknownEntries = Object.entries(health).filter(([k]) => !knownKeys.has(k));
  const hasSections = hasSystem || hasPerformance || hasMemory || hasConnections;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Metrics</h3>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded"
            />
            <span className="text-[10px] text-muted-foreground">Auto-refresh (10s)</span>
          </label>
          <button
            type="button"
            onClick={fetchHealth}
            className="flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] hover:bg-muted transition-colors"
          >
            <RefreshCwIcon className="h-3 w-3" />
            Refresh
          </button>
        </div>
      </div>

      {hasSystem && (
        <SectionCard title="System" icon={<BarChart3Icon className="h-3.5 w-3.5" />}>
          {health.uptime !== undefined && (
            <MetricRow label="Uptime" value={formatUptime(health.uptime)} />
          )}
          {health.ruby_version !== undefined && (
            <MetricRow label="Ruby Version" value={String(health.ruby_version)} />
          )}
          {health.pid !== undefined && (
            <MetricRow label="PID" value={String(health.pid)} />
          )}
          {health.hostname !== undefined && (
            <MetricRow label="Hostname" value={String(health.hostname)} />
          )}
        </SectionCard>
      )}

      {hasPerformance && (
        <SectionCard title="Performance" icon={<ActivityIcon className="h-3.5 w-3.5" />}>
          {health.request_count !== undefined && (
            <MetricRow label="Request Count" value={String(health.request_count)} />
          )}
          {health.avg_response_time !== undefined && (
            <MetricRow
              label="Avg Response Time"
              value={`${(health.avg_response_time as number).toFixed(2)} ms`}
            />
          )}
          {health.error_rate !== undefined && (
            <MetricRow
              label="Error Rate"
              value={`${((health.error_rate as number) * 100).toFixed(2)}%`}
            />
          )}
        </SectionCard>
      )}

      {hasMemory && (
        <SectionCard title="Memory" icon={<BarChart3Icon className="h-3.5 w-3.5" />}>
          {health.rss_bytes !== undefined && (
            <MetricRow label="RSS" value={formatBytes(health.rss_bytes as number)} />
          )}
          {health.heap_size !== undefined && (
            <MetricRow label="Heap Size" value={formatBytes(health.heap_size as number)} />
          )}
        </SectionCard>
      )}

      {hasConnections && (
        <div className="rounded-lg border border-border/50 bg-muted/10 p-3 space-y-2">
          <div className="flex items-center gap-1.5">
            <ActivityIcon className="h-3.5 w-3.5 text-muted-foreground" />
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Connections
            </p>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            {health.amqp_connected !== undefined && (
              <div className="space-y-0.5">
                <p className="text-[10px] text-muted-foreground">AMQP</p>
                <ConnectedBadge value={health.amqp_connected as boolean} />
              </div>
            )}
            {health.cache_connected !== undefined && (
              <div className="space-y-0.5">
                <p className="text-[10px] text-muted-foreground">Cache</p>
                <ConnectedBadge value={health.cache_connected as boolean} />
              </div>
            )}
            {health.db_connected !== undefined && (
              <div className="space-y-0.5">
                <p className="text-[10px] text-muted-foreground">Database</p>
                <ConnectedBadge value={health.db_connected as boolean} />
              </div>
            )}
          </div>
        </div>
      )}

      {!hasSections && unknownEntries.length === 0 && (
        <p className="text-xs text-muted-foreground italic py-4 text-center">No metrics available.</p>
      )}

      {unknownEntries.length > 0 && (
        <div className="rounded-lg border border-border/50 bg-muted/10 p-3 space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Additional
          </p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            {unknownEntries.map(([key, value]) => (
              <MetricRow
                key={key}
                label={key.replace(/_/g, ' ')}
                value={typeof value === 'object' ? JSON.stringify(value) : String(value)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
