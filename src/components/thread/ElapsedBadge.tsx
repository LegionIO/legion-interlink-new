import { useEffect, useMemo, useRef, useState, type FC } from 'react';
import { formatElapsed, parseTimestampMs } from '@/lib/response-timing';

export const ElapsedBadge: FC<{
  startedAt?: string;
  finishedAt?: string;
  /** Server-computed wall-clock duration — preferred over finishedAt-startedAt for sub-second tools */
  durationMs?: number;
  isRunning: boolean;
  isError?: boolean;
  className?: string;
}> = ({ startedAt, finishedAt, durationMs, isRunning, isError = false, className = '' }) => {
  const fallbackStartedMsRef = useRef<number>(Date.now());
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [frozenEndMs, setFrozenEndMs] = useState<number | null>(null);

  const startedMs = useMemo(
    () => parseTimestampMs(startedAt) ?? fallbackStartedMsRef.current,
    [startedAt],
  );
  const finishedMs = useMemo(() => parseTimestampMs(finishedAt), [finishedAt]);

  useEffect(() => {
    if (isRunning) {
      setFrozenEndMs(null);
      const tick = () => setNowMs(Date.now());
      tick();
      const interval = window.setInterval(tick, 100);
      return () => window.clearInterval(interval);
    }

    if (finishedMs == null && frozenEndMs == null) {
      setFrozenEndMs(Date.now());
    }

    return undefined;
  }, [isRunning, finishedMs, frozenEndMs]);

  const endMs = finishedMs ?? frozenEndMs ?? nowMs;
  // Prefer server-computed durationMs (millisecond precision from Ruby Time.now)
  // over ISO timestamp subtraction which loses sub-ms precision and shows 0ms for fast tools.
  // Enforce minimum display of 1ms so completed tools never show "0ms".
  const elapsedMs = isRunning
    ? Math.max(0, endMs - startedMs)
    : Math.max(1, durationMs ?? Math.max(0, endMs - startedMs));
  const colorClasses = isRunning
    ? 'border-blue-500/20 bg-blue-500/10 text-blue-600 dark:text-blue-400'
    : isError
      ? 'border-destructive/20 bg-destructive/10 text-destructive'
      : 'border-green-500/20 bg-green-500/10 text-green-600 dark:text-green-400';

  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold leading-none tabular-nums ${colorClasses} ${className}`.trim()}>
      {formatElapsed(elapsedMs)}
    </span>
  );
};
