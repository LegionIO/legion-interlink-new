import { useEffect, useState, type FC } from 'react';
import { Monitor, Target, CheckCircle, Circle, Pause, AlertTriangle, Camera, MousePointerClick, Zap, Clock } from 'lucide-react';
import type { ComputerOverlayState } from '../../../shared/computer-use';

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function formatSeconds(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return `${seconds}s`;
}

const ScreenshotTimer: FC<{
  lastCaptureAt?: string;
  avgCycleDurationMs?: number;
}> = ({ lastCaptureAt, avgCycleDurationMs }) => {
  const now = useNow(1000);

  if (!lastCaptureAt) return null;

  const lastCaptureMs = new Date(lastCaptureAt).getTime();
  const elapsed = now - lastCaptureMs;
  const lastText = formatSeconds(elapsed);

  const hasEstimate = avgCycleDurationMs != null && avgCycleDurationMs > 0;
  const remaining = hasEstimate ? avgCycleDurationMs - elapsed : 0;
  const nextText = hasEstimate ? `~${formatSeconds(Math.max(0, remaining))}` : null;

  return (
    <div className="flex items-center gap-1.5 text-[10px]">
      <Camera className="h-3 w-3 text-white/40" />
      <span className="text-white/50">
        Last capture: <span className="text-white/70">{lastText} ago</span>
      </span>
      {nextText && (
        <span className="text-white/40">
          · Next: <span className="text-white/60">{nextText}</span>
        </span>
      )}
    </div>
  );
};

/**
 * Purple circle that follows the AI cursor position on the macOS screen.
 */
const CursorIndicator: FC<{
  cursor: NonNullable<ComputerOverlayState['cursor']>;
  frameWidth?: number;
  frameHeight?: number;
  screenWidth?: number;
  screenHeight?: number;
}> = ({ cursor, frameWidth, frameHeight, screenWidth, screenHeight }) => {
  if (!cursor.visible) return null;

  const scaleX = frameWidth && screenWidth && frameWidth > 0 ? screenWidth / frameWidth : 1;
  const scaleY = frameHeight && screenHeight && frameHeight > 0 ? screenHeight / frameHeight : 1;
  const left = cursor.x * scaleX;
  const top = cursor.y * scaleY;

  const clickedRecently = cursor.clickedAt
    ? Date.now() - new Date(cursor.clickedAt).getTime() < 800
    : false;

  return (
    <>
      {/* Outer glow ring */}
      <div
        className="pointer-events-none absolute h-10 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-purple-400/80 shadow-[0_0_16px_6px_rgba(168,85,247,0.40)] transition-[left,top] duration-300 ease-out"
        style={{ left: `${left}px`, top: `${top}px` }}
      />
      {/* Inner filled dot */}
      <div
        className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-purple-500/80 border border-purple-300/80 transition-[left,top] duration-300 ease-out"
        style={{ left: `${left}px`, top: `${top}px` }}
      />
      {/* Click ripple */}
      {clickedRecently && (
        <div
          className="pointer-events-none absolute h-12 w-12 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-purple-400/80 animate-ping"
          style={{ left: `${left}px`, top: `${top}px` }}
        />
      )}
    </>
  );
};

export const OverlayContent: FC<{ state: ComputerOverlayState }> = ({ state }) => {
  const isPaused = state.status === 'paused';
  const isFailed = state.status === 'failed';
  const isRunning = state.status === 'running';
  const now = useNow(1000);
  const elapsedMs = state.sessionStartedAt ? now - new Date(state.sessionStartedAt).getTime() : 0;

  const completedCheckpoints = state.checkpoints.filter((cp) => cp.complete).length;
  const totalCheckpoints = state.checkpoints.length;

  return (
    <div className="relative h-full w-full">
      {/* Expanded status banner at top */}
      <div className="flex w-full items-center justify-center p-4">
        <div
          className={`
            w-full max-w-4xl rounded-2xl px-6 py-4
            backdrop-blur-2xl
            border
            ${isPaused
              ? 'border-amber-400/80 bg-amber-950/80'
              : isFailed
                ? 'border-red-400/80 bg-red-950/80'
                : 'border-purple-400/80 bg-black/80 overlay-pulse-border'
            }
          `}
        >
          {/* Top row: status icon, model, status badges, elapsed time */}
          <div className="flex items-center gap-3">
            <div className="flex-shrink-0">
              {isPaused ? (
                <Pause className="h-7 w-7 text-amber-400" />
              ) : isFailed ? (
                <AlertTriangle className="h-7 w-7 text-red-400" />
              ) : (
                <Monitor className="h-7 w-7 text-purple-400 overlay-pulse-icon" />
              )}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-purple-200 truncate">
                  {state.modelDisplayName}
                </span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                  isPaused ? 'bg-amber-400/20 text-amber-300'
                    : isFailed ? 'bg-red-400/20 text-red-300'
                      : isRunning ? 'bg-emerald-400/15 text-emerald-300'
                        : 'bg-white/10 text-white/60'
                }`}>
                  {isPaused && state.pauseReason === 'takeover' ? 'Human Takeover' : state.status}
                </span>
              </div>
            </div>

            {/* Right side: elapsed + step count */}
            <div className="flex flex-shrink-0 items-center gap-3">
              {(state.actionCount ?? 0) > 0 && (
                <div className="flex items-center gap-1.5 rounded-lg bg-white/5 px-2.5 py-1.5">
                  <MousePointerClick className="h-3 w-3 text-white/40" />
                  <span className="text-[11px] tabular-nums text-white/70">
                    {state.completedActionCount ?? 0}/{state.actionCount ?? 0} steps
                  </span>
                </div>
              )}
              {elapsedMs > 0 && (
                <div className="flex items-center gap-1.5 rounded-lg bg-white/5 px-2.5 py-1.5">
                  <Clock className="h-3 w-3 text-white/40" />
                  <span className="text-[11px] tabular-nums text-white/70">
                    {formatDuration(elapsedMs)}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Goal + subgoal */}
          <div className="mt-2.5 space-y-1">
            <div className="flex items-start gap-1.5">
              <Target className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-purple-400/60" />
              <span className="text-[12px] leading-snug text-white/80">{state.goal}</span>
            </div>
            {state.currentSubgoal && (
              <div className="flex items-start gap-1.5 pl-[22px]">
                <Zap className="mt-0.5 h-3 w-3 flex-shrink-0 text-purple-400/40" />
                <span className="text-[11px] leading-snug text-white/55">{state.currentSubgoal}</span>
              </div>
            )}
          </div>

          {/* Progress: checkpoints row + last action */}
          {(totalCheckpoints > 0 || state.lastActionSummary || state.planSummary) && (
            <div className="mt-3 flex items-start gap-4 border-t border-white/8 pt-3">
              {/* Checkpoints */}
              {totalCheckpoints > 0 && (
                <div className="flex-shrink-0 space-y-1">
                  <div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-white/30">
                    Checkpoints ({completedCheckpoints}/{totalCheckpoints})
                  </div>
                  <div className="flex items-center gap-1">
                    {state.checkpoints.slice(-8).map((cp, i) => (
                      <div key={i} title={cp.summary}>
                        {cp.complete ? (
                          <CheckCircle className="h-3.5 w-3.5 text-emerald-400/80" />
                        ) : (
                          <Circle className="h-3.5 w-3.5 text-white/20" />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Last action / plan summary */}
              <div className="min-w-0 flex-1 space-y-1">
                {state.lastActionSummary && (
                  <div className="text-[10px] text-white/45 truncate">
                    <span className="text-white/25">Last: </span>
                    {state.lastActionSummary}
                  </div>
                )}
                {state.planSummary && (
                  <div className="text-[10px] text-white/40 truncate">
                    <span className="text-white/25">Plan: </span>
                    {state.planSummary}
                  </div>
                )}
                {state.statusMessage && !isPaused && !isFailed && (
                  <div className="text-[10px] text-amber-300/50 truncate">
                    {state.statusMessage}
                  </div>
                )}
              </div>

              {/* Screenshot timer */}
              <div className="flex-shrink-0">
                <ScreenshotTimer
                  lastCaptureAt={state.lastCaptureAt}
                  avgCycleDurationMs={state.avgCycleDurationMs}
                />
              </div>
            </div>
          )}

          {/* Screenshot timer fallback when no checkpoints */}
          {totalCheckpoints === 0 && !state.lastActionSummary && !state.planSummary && (
            <div className="mt-2">
              <ScreenshotTimer
                lastCaptureAt={state.lastCaptureAt}
                avgCycleDurationMs={state.avgCycleDurationMs}
              />
            </div>
          )}
        </div>
      </div>

      {/* AI cursor indicator */}
      {state.cursor?.visible && (
        <CursorIndicator
          cursor={state.cursor}
          frameWidth={state.frameWidth}
          frameHeight={state.frameHeight}
          screenWidth={state.screenWidth}
          screenHeight={state.screenHeight}
        />
      )}
    </div>
  );
};
