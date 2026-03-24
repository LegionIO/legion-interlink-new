import { useState, useEffect, useCallback, type FC } from 'react';
import { RefreshCwIcon, LoaderIcon, WifiOffIcon, ChevronDownIcon, ChevronRightIcon } from 'lucide-react';
import { type SettingsProps } from './shared';

type LoadState = 'idle' | 'loading' | 'loaded' | 'error';

interface Schedule {
  function_id: string;
  cron?: string;
  interval?: string;
  active: boolean;
  next_run?: string;
  [key: string]: unknown;
}

const daemonCall = (method: string, ...args: unknown[]) =>
  ((window as unknown as { legion: { daemon: Record<string, (...a: unknown[]) => Promise<{ ok: boolean; data?: unknown; error?: string }>> } }).legion.daemon[method](...args));

export const DaemonSchedules: FC<SettingsProps> = () => {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [loadError, setLoadError] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const fetchSchedules = useCallback(async () => {
    setLoadState('loading');
    setLoadError('');
    try {
      const result = await daemonCall('schedules');
      if (result.ok && Array.isArray(result.data)) {
        setSchedules(result.data as Schedule[]);
        setLoadState('loaded');
      } else {
        setLoadError(result.error || 'Failed to fetch schedules');
        setLoadState('error');
      }
    } catch (err) {
      setLoadError(String(err));
      setLoadState('error');
    }
  }, []);

  useEffect(() => {
    fetchSchedules();
  }, [fetchSchedules]);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  if (loadState === 'idle' || loadState === 'loading') {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-8 justify-center">
        <LoaderIcon className="h-4 w-4 animate-spin" />
        Loading schedules...
      </div>
    );
  }

  if (loadState === 'error') {
    return (
      <div className="space-y-4">
        <h3 className="text-sm font-semibold">Schedules</h3>
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 space-y-3">
          <div className="flex items-start gap-2">
            <WifiOffIcon className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-medium text-destructive">Failed to load schedules</p>
              <p className="text-[10px] text-muted-foreground mt-1">{loadError}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={fetchSchedules}
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
        <h3 className="text-sm font-semibold">Schedules</h3>
        <button
          type="button"
          onClick={fetchSchedules}
          className="flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] hover:bg-muted transition-colors"
        >
          <RefreshCwIcon className="h-3 w-3" />
          Refresh
        </button>
      </div>

      {schedules.length === 0 ? (
        <p className="text-xs text-muted-foreground italic py-4 text-center">No schedules configured.</p>
      ) : (
        <div className="space-y-1">
          {schedules.map((s) => {
            const isOpen = expanded.has(s.function_id);
            const trigger = s.cron ?? s.interval ?? 'unknown';
            const nextRun = s.next_run ? new Date(s.next_run).toLocaleString() : '—';
            const extraKeys = Object.keys(s).filter(
              (k) => !['function_id', 'cron', 'interval', 'active', 'next_run'].includes(k),
            );
            return (
              <div key={s.function_id} className="rounded-lg border border-border/50">
                <button
                  type="button"
                  onClick={() => toggleExpand(s.function_id)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/40 transition-colors rounded-lg"
                >
                  {isOpen ? (
                    <ChevronDownIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronRightIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <span className="flex-1 text-xs font-mono">{s.function_id}</span>
                  <span className="text-[10px] font-mono text-muted-foreground">{trigger}</span>
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium border ${
                      s.active
                        ? 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20'
                        : 'bg-muted/50 text-muted-foreground border-border/40'
                    }`}
                  >
                    {s.active ? 'active' : 'inactive'}
                  </span>
                </button>
                {isOpen && (
                  <div className="border-t border-border/30 px-4 py-2 space-y-1.5 bg-muted/10 rounded-b-lg">
                    <div className="grid grid-cols-2 gap-3 text-[10px]">
                      <div>
                        <span className="text-muted-foreground">Trigger: </span>
                        <span className="font-mono">{trigger}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Next run: </span>
                        <span className="font-mono">{nextRun}</span>
                      </div>
                    </div>
                    {extraKeys.length > 0 && (
                      <div className="rounded-md border border-border/30 bg-muted/20 p-2 text-[10px] font-mono space-y-0.5">
                        {extraKeys.map((k) => (
                          <div key={k}>
                            <span className="text-muted-foreground">{k}: </span>
                            {JSON.stringify(s[k])}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
