import { useState, useEffect, useCallback, useRef, type FC } from 'react';
import { RefreshCwIcon, LoaderIcon, WifiOffIcon, RadioIcon, CircleStopIcon } from 'lucide-react';
import { type SettingsProps } from './shared';
import { legion } from '@/lib/ipc-client';

type LoadState = 'idle' | 'loading' | 'loaded' | 'error';

interface DaemonEvent {
  timestamp: string;
  type: string;
  data?: unknown;
}

const LIVE_INTERVAL_MS = 3000;
const MAX_EVENTS = 200;

export const DaemonEvents: FC<SettingsProps> = () => {
  const [events, setEvents] = useState<DaemonEvent[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [loadError, setLoadError] = useState('');
  const [live, setLive] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);

  const fetchEvents = useCallback(async (append = false) => {
    if (!append) {
      setLoadState('loading');
      setLoadError('');
    }
    try {
      const result = await legion.daemon.eventsRecent(50);
      if (result.ok && Array.isArray(result.data)) {
        const incoming = result.data as DaemonEvent[];
        if (append) {
          setEvents((prev) => {
            const existingTs = new Set(prev.map((e) => `${e.timestamp}|${e.type}`));
            const novel = incoming.filter((e) => !existingTs.has(`${e.timestamp}|${e.type}`));
            if (novel.length === 0) return prev;
            const merged = [...prev, ...novel];
            return merged.length > MAX_EVENTS ? merged.slice(merged.length - MAX_EVENTS) : merged;
          });
        } else {
          setEvents(incoming);
          setLoadState('loaded');
        }
      } else {
        if (!append) {
          setLoadError(result.error || 'Failed to fetch events');
          setLoadState('error');
        }
      }
    } catch (err) {
      if (!append) {
        setLoadError(String(err));
        setLoadState('error');
      }
    }
  }, []);

  useEffect(() => {
    fetchEvents(false);
  }, [fetchEvents]);

  useEffect(() => {
    if (live) {
      intervalRef.current = setInterval(() => fetchEvents(true), LIVE_INTERVAL_MS);
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
  }, [live, fetchEvents]);

  useEffect(() => {
    if (live && feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [events, live]);

  const toggleLive = async () => {
    if (!live) {
      try {
        await legion.daemon.eventsSubscribe();
      } catch {
        // subscribe is best-effort
      }
      setLive(true);
    } else {
      setLive(false);
      try {
        await legion.daemon.eventsUnsubscribe();
      } catch {
        // unsubscribe is best-effort
      }
    }
  };

  const dataPreview = (data: unknown): string => {
    if (data === undefined || data === null) return '';
    const str = JSON.stringify(data);
    return str.length > 120 ? str.slice(0, 120) + '…' : str;
  };

  if (loadState === 'idle' || loadState === 'loading') {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-8 justify-center">
        <LoaderIcon className="h-4 w-4 animate-spin" />
        Loading events...
      </div>
    );
  }

  if (loadState === 'error') {
    return (
      <div className="space-y-4">
        <h3 className="text-sm font-semibold">Events</h3>
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 space-y-3">
          <div className="flex items-start gap-2">
            <WifiOffIcon className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-medium text-destructive">Failed to load events</p>
              <p className="text-[10px] text-muted-foreground mt-1">{loadError}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => fetchEvents(false)}
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
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">Events</h3>
          {live && (
            <span className="inline-flex items-center gap-1 rounded-full border border-green-500/20 bg-green-500/10 px-2 py-0.5 text-[10px] text-green-700 dark:text-green-400">
              <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
              Live
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleLive}
            className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] transition-colors ${
              live
                ? 'border-destructive/30 bg-destructive/5 text-destructive hover:bg-destructive/10'
                : 'hover:bg-muted'
            }`}
          >
            {live ? (
              <>
                <CircleStopIcon className="h-3 w-3" />
                Stop
              </>
            ) : (
              <>
                <RadioIcon className="h-3 w-3" />
                Live
              </>
            )}
          </button>
          <button
            type="button"
            onClick={() => fetchEvents(false)}
            disabled={live}
            className="flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] hover:bg-muted transition-colors disabled:opacity-40"
          >
            <RefreshCwIcon className="h-3 w-3" />
            Refresh
          </button>
        </div>
      </div>

      {events.length === 0 ? (
        <p className="text-xs text-muted-foreground italic py-4 text-center">No recent events.</p>
      ) : (
        <div
          ref={feedRef}
          className="space-y-0.5 max-h-[480px] overflow-y-auto rounded-lg border border-border/40 bg-muted/10 p-2"
        >
          {events.map((evt, i) => (
            <div
              key={i}
              className="flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-muted/30 transition-colors"
            >
              <span className="shrink-0 text-[10px] font-mono text-muted-foreground w-[140px]">
                {new Date(evt.timestamp).toLocaleTimeString(undefined, {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                  fractionalSecondDigits: 3,
                })}
              </span>
              <span className="shrink-0 text-[10px] font-semibold font-mono w-[160px] truncate">
                {evt.type}
              </span>
              {evt.data !== undefined && (
                <span className="text-[10px] font-mono text-muted-foreground truncate">
                  {dataPreview(evt.data)}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {events.length >= MAX_EVENTS && (
        <p className="text-[10px] text-muted-foreground italic text-center">
          Showing last {MAX_EVENTS} events.
        </p>
      )}
    </div>
  );
};
