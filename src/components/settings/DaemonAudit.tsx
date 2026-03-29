import { useState, useEffect, useCallback, type FC } from 'react';
import {
  RefreshCwIcon,
  LoaderIcon,
  WifiOffIcon,
  ShieldCheckIcon,
  AlertTriangleIcon,
  CheckCircle2Icon,
} from 'lucide-react';
import { settingsSelectClass, type SettingsProps } from './shared';
import { legion } from '@/lib/ipc-client';

type LoadState = 'idle' | 'loading' | 'loaded' | 'error';
type VerifyState = 'idle' | 'verifying' | 'ok' | 'fail';

interface AuditEntry {
  timestamp: string;
  event_type: string;
  principal_id?: string;
  status: string;
  source?: string;
  [key: string]: unknown;
}

const STATUS_COLORS: Record<string, string> = {
  success: 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20',
  ok: 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20',
  failure: 'bg-destructive/10 text-destructive border-destructive/20',
  error: 'bg-destructive/10 text-destructive border-destructive/20',
  denied: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20',
};

const statusClass = (status: string) =>
  STATUS_COLORS[status.toLowerCase()] ?? 'bg-muted/50 text-muted-foreground border-border/40';

export const DaemonAudit: FC<SettingsProps> = () => {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [loadError, setLoadError] = useState('');
  const [eventTypeFilter, setEventTypeFilter] = useState('');
  const [verifyState, setVerifyState] = useState<VerifyState>('idle');
  const [verifyMessage, setVerifyMessage] = useState('');

  const fetchAudit = useCallback(async () => {
    setLoadState('loading');
    setLoadError('');
    const filters: Record<string, string> | undefined = eventTypeFilter ? { event_type: eventTypeFilter } : undefined;
    try {
      const result = await legion.daemon.audit(filters);
      if (result.ok && Array.isArray(result.data)) {
        setEntries(result.data as AuditEntry[]);
        setLoadState('loaded');
      } else {
        setLoadError(result.error || 'Failed to fetch audit log');
        setLoadState('error');
      }
    } catch (err) {
      setLoadError(String(err));
      setLoadState('error');
    }
  }, [eventTypeFilter]);

  useEffect(() => {
    fetchAudit();
  }, [fetchAudit]);

  const verifyChain = async () => {
    setVerifyState('verifying');
    setVerifyMessage('');
    try {
      const result = await legion.daemon.auditVerify();
      if (result.ok) {
        setVerifyState('ok');
        setVerifyMessage(typeof result.data === 'string' ? result.data : 'Chain integrity verified.');
      } else {
        setVerifyState('fail');
        setVerifyMessage(result.error || 'Chain verification failed.');
      }
    } catch (err) {
      setVerifyState('fail');
      setVerifyMessage(String(err));
    }
    setTimeout(() => setVerifyState('idle'), 5000);
  };

  const eventTypes = Array.from(new Set(entries.map((e) => e.event_type))).sort();

  if (loadState === 'idle' || loadState === 'loading') {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-8 justify-center">
        <LoaderIcon className="h-4 w-4 animate-spin" />
        Loading audit log...
      </div>
    );
  }

  if (loadState === 'error') {
    return (
      <div className="space-y-4">
        <h3 className="text-sm font-semibold">Audit Log</h3>
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 space-y-3">
          <div className="flex items-start gap-2">
            <WifiOffIcon className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-medium text-destructive">Failed to load audit log</p>
              <p className="text-[10px] text-muted-foreground mt-1">{loadError}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={fetchAudit}
            className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs hover:bg-muted transition-colors"
          >
            <RefreshCwIcon className="h-3 w-3" />
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Audit Log</h3>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={verifyChain}
            disabled={verifyState === 'verifying'}
            className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] hover:bg-muted transition-colors disabled:opacity-50"
          >
            {verifyState === 'verifying' ? (
              <LoaderIcon className="h-3 w-3 animate-spin" />
            ) : (
              <ShieldCheckIcon className="h-3 w-3" />
            )}
            Verify Chain
          </button>
          <button
            type="button"
            onClick={fetchAudit}
            className="flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] hover:bg-muted transition-colors"
          >
            <RefreshCwIcon className="h-3 w-3" />
            Refresh
          </button>
        </div>
      </div>

      {verifyState !== 'idle' && verifyState !== 'verifying' && (
        <div
          className={`flex items-center gap-2 rounded-md border px-3 py-2 text-xs ${
            verifyState === 'ok'
              ? 'border-green-500/30 bg-green-500/5 text-green-700 dark:text-green-400'
              : 'border-destructive/30 bg-destructive/5 text-destructive'
          }`}
        >
          {verifyState === 'ok' ? (
            <CheckCircle2Icon className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <AlertTriangleIcon className="h-3.5 w-3.5 shrink-0" />
          )}
          {verifyMessage}
        </div>
      )}

      <div className="flex items-center gap-2">
        <label className="text-[10px] text-muted-foreground shrink-0">Filter by event type:</label>
        <select
          className={settingsSelectClass}
          value={eventTypeFilter}
          onChange={(e) => setEventTypeFilter(e.target.value)}
        >
          <option value="">All</option>
          {eventTypes.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>

      {entries.length === 0 ? (
        <p className="text-xs text-muted-foreground italic py-4 text-center">No audit entries found.</p>
      ) : (
        <div className="space-y-1 max-h-96 overflow-y-auto">
          {entries.map((entry, i) => (
            <div
              key={i}
              className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 items-center rounded-lg border border-border/40 px-3 py-2 text-[10px]"
            >
              <div className="min-w-0">
                <span className="font-mono text-muted-foreground">
                  {new Date(entry.timestamp).toLocaleString()}
                </span>
                <span className="mx-1.5 text-border">·</span>
                <span className="font-semibold">{entry.event_type}</span>
                {entry.source && (
                  <>
                    <span className="mx-1.5 text-border">·</span>
                    <span className="text-muted-foreground font-mono">{entry.source}</span>
                  </>
                )}
              </div>
              <span className="text-muted-foreground font-mono truncate max-w-[120px]">
                {entry.principal_id ?? '—'}
              </span>
              <span
                className={`inline-flex rounded-full border px-2 py-0.5 font-medium ${statusClass(entry.status)}`}
              >
                {entry.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
