import { useState, useRef, useEffect, useMemo, type FC } from 'react';
import { CheckCircle2Icon, ChevronDownIcon, ChevronRightIcon, AlertCircleIcon, LoaderIcon, MousePointerClickIcon, TypeIcon, NavigationIcon, ScrollIcon, AppWindowIcon, GripHorizontalIcon, UserIcon } from 'lucide-react';
import type { ComputerActionProposal, ComputerCheckpoint, ComputerFrame, ComputerGuidanceMessage, ComputerSession } from '../../../shared/computer-use';

/* ---------- helpers ---------- */

function statusBorderColor(status: ComputerActionProposal['status']): string {
  switch (status) {
    case 'running': return 'border-l-blue-500/70';
    case 'completed': return 'border-l-green-500/60';
    case 'awaiting-approval': case 'proposed': case 'approved': return 'border-l-amber-500/60';
    case 'failed': return 'border-l-destructive/60';
    case 'rejected': case 'cancelled': return 'border-l-muted-foreground/40';
    default: return 'border-l-border';
  }
}

function statusBadgeClass(status: ComputerActionProposal['status']): string {
  switch (status) {
    case 'running': return 'bg-blue-500/10 text-blue-600 dark:text-blue-400';
    case 'completed': return 'bg-green-500/10 text-green-600 dark:text-green-400';
    case 'awaiting-approval': case 'proposed': case 'approved': return 'bg-amber-500/10 text-amber-700 dark:text-amber-300';
    case 'failed': return 'bg-destructive/10 text-destructive';
    default: return 'bg-muted text-muted-foreground';
  }
}

function actionIcon(kind: ComputerActionProposal['kind']): FC<{ className?: string }> {
  switch (kind) {
    case 'click': case 'doubleClick': return MousePointerClickIcon;
    case 'typeText': case 'pressKeys': return TypeIcon;
    case 'navigate': return NavigationIcon;
    case 'scroll': return ScrollIcon;
    case 'openApp': case 'focusWindow': return AppWindowIcon;
    case 'drag': return GripHorizontalIcon;
    default: return MousePointerClickIcon;
  }
}

function formatRelativeTime(createdAt: string): string {
  const ms = Date.now() - new Date(createdAt).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ${m % 60}m ago`;
}

function actionDetailEntries(action: ComputerActionProposal): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  const hasResolvedPosition = action.resolvedX != null && action.resolvedY != null;
  const resolvedDiffers = hasResolvedPosition && (action.resolvedX !== action.x || action.resolvedY !== action.y);
  if (action.x != null && action.y != null) {
    entries.push([resolvedDiffers ? 'requested position' : 'position', `(${action.x}, ${action.y})`]);
  }
  if (resolvedDiffers) entries.push(['applied position', `(${action.resolvedX}, ${action.resolvedY})`]);
  if (action.endX != null && action.endY != null) entries.push(['drag to', `(${action.endX}, ${action.endY})`]);
  if (action.text) entries.push(['text', action.text]);
  if (action.keys?.length) entries.push(['keys', action.keys.join(' + ')]);
  if (action.url) entries.push(['url', action.url]);
  if (action.appName) entries.push(['app', action.appName]);
  if (action.selector) entries.push(['selector', action.selector]);
  if (action.elementId) entries.push(['element', action.elementId]);
  if (action.waitMs) entries.push(['wait', `${action.waitMs}ms`]);
  if (action.deltaX != null || action.deltaY != null) entries.push(['scroll', `(${action.deltaX ?? 0}, ${action.deltaY ?? 0})`]);
  return entries;
}

/* ---------- types ---------- */

type TimelineItem =
  | { type: 'action'; action: ComputerActionProposal; index: number }
  | { type: 'checkpoint'; checkpoint: ComputerCheckpoint }
  | { type: 'guidance'; message: ComputerGuidanceMessage };

/* ---------- sub-components ---------- */

const GuidanceCard: FC<{ message: ComputerGuidanceMessage }> = ({ message }) => (
  <div className="rounded-xl border-l-4 border border-border/50 border-l-primary/60 bg-primary/5 px-3 py-2.5">
    <div className="flex items-center gap-2">
      <UserIcon className="h-3.5 w-3.5 shrink-0 text-primary/70" />
      <span className="text-[10px] font-medium text-primary/70">You</span>
      <span className="text-[10px] tabular-nums text-muted-foreground">{formatRelativeTime(message.createdAt)}</span>
      {message.injectedAt ? (
        <span className="rounded bg-green-500/10 px-1.5 py-0.5 text-[10px] font-medium text-green-600 dark:text-green-400">Injected</span>
      ) : (
        <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">Queued</span>
      )}
    </div>
    <p className="mt-1 text-sm leading-relaxed">{message.text}</p>
  </div>
);

const CheckpointDivider: FC<{ checkpoint: ComputerCheckpoint }> = ({ checkpoint }) => (
  <div className="flex items-center gap-2 py-1">
    <div className="h-px flex-1 bg-border/40" />
    <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/60">
      <CheckCircle2Icon className="h-3 w-3 text-green-500/60" />
      {checkpoint.summary}
    </div>
    <div className="h-px flex-1 bg-border/40" />
  </div>
);

const ScreenshotThumbnail: FC<{
  frame: ComputerFrame;
  /** Action target coordinates to render as a cursor indicator overlay */
  cursorX?: number;
  cursorY?: number;
  /** Drag end coordinates (shows a second indicator connected by a line) */
  dragEndX?: number;
  dragEndY?: number;
  /** Which display the action targeted (for multi-display) */
  actionDisplayIndex?: number;
}> = ({ frame, cursorX, cursorY, dragEndX, dragEndY, actionDisplayIndex }) => {
  const [expanded, setExpanded] = useState(false);
  const [selectedDisplayIndex, setSelectedDisplayIndex] = useState<number | null>(null);

  // Default to the action's target display, allow user to switch
  const activeDisplayIndex = selectedDisplayIndex ?? (actionDisplayIndex ?? 0);

  // For multi-display, find the targeted display's frame
  const displayFrames = frame.displayFrames;
  const hasMultipleDisplays = displayFrames && displayFrames.length > 1;
  const activeDisplayFrame = hasMultipleDisplays
    ? displayFrames.find((df) => df.displayIndex === activeDisplayIndex) ?? displayFrames[0]
    : null;

  // Use the active display's image and dimensions for cursor positioning
  const displayDataUrl = activeDisplayFrame?.dataUrl ?? frame.dataUrl;
  const displayWidth = activeDisplayFrame?.width ?? frame.width;
  const displayHeight = activeDisplayFrame?.height ?? frame.height;

  // Only show cursor when viewing the action's target display
  const showCursor = activeDisplayIndex === (actionDisplayIndex ?? 0);
  const hasCursor = showCursor && cursorX != null && cursorY != null && displayWidth > 0 && displayHeight > 0;
  const hasDragEnd = showCursor && dragEndX != null && dragEndY != null;

  return (
    <div className="mt-2 space-y-1.5">
      {/* Multi-display: show all display thumbnails in a row, highlight the active one */}
      {hasMultipleDisplays && (
        <div className="flex gap-1.5">
          {displayFrames.map((df) => (
            <button
              key={df.displayIndex}
              type="button"
              onClick={(e) => { e.stopPropagation(); setSelectedDisplayIndex(df.displayIndex); }}
              className={`relative overflow-hidden rounded border transition-all ${df.displayIndex === activeDisplayIndex ? 'border-purple-400/60 ring-1 ring-purple-400/30' : 'border-border/30 opacity-60 hover:opacity-80 hover:border-border/50'}`}
              style={{ flex: `0 0 ${Math.min(50, 100 / displayFrames.length)}%` }}
            >
              <img src={df.dataUrl} alt={df.displayName} className="block w-full max-h-[60px] object-contain bg-black/40" />
              <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-1 py-0.5 text-[8px] text-white/60 truncate">
                {df.displayIndex === (actionDisplayIndex ?? 0) && <span className="text-purple-300 mr-0.5">&#9654;</span>}
                {df.displayName}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Main viewport — shows the targeted display's image with cursor overlay */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="relative block overflow-hidden rounded-lg border border-border/50 transition-colors hover:border-border/80"
      >
        <img
          src={displayDataUrl}
          alt="Viewport"
          className={`block w-full object-contain bg-black/60 ${expanded ? 'max-h-[400px]' : 'max-h-[180px]'}`}
        />
        {/* Cursor indicator — purple circle at the action's target position */}
        {hasCursor && (
          <>
            {/* Outer glow ring */}
            <div
              className="pointer-events-none absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-purple-400/60 shadow-[0_0_8px_3px_rgba(168,85,247,0.25)]"
              style={{
                left: `${(cursorX / displayWidth) * 100}%`,
                top: `${(cursorY / displayHeight) * 100}%`,
              }}
            />
            {/* Inner dot */}
            <div
              className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-purple-500/70 border border-purple-300/80"
              style={{
                left: `${(cursorX / displayWidth) * 100}%`,
                top: `${(cursorY / displayHeight) * 100}%`,
              }}
            />
            {/* Drag end indicator */}
            {hasDragEnd && (
              <div
                className="pointer-events-none absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-dashed border-purple-400/40"
                style={{
                  left: `${(dragEndX / displayWidth) * 100}%`,
                  top: `${(dragEndY / displayHeight) * 100}%`,
                }}
              />
            )}
          </>
        )}
      </button>
      {frame.summary && (
        <p className="mt-1 text-[10px] text-muted-foreground/60">{frame.summary}</p>
      )}
    </div>
  );
};

const StepCard: FC<{
  action: ComputerActionProposal;
  isLatest: boolean;
  defaultExpanded: boolean;
  /** The closest frame captured around the time of this action */
  frame?: ComputerFrame;
  pendingApproval?: ComputerSession['approvals'][number];
  onApprove?: (actionId: string) => void;
  onReject?: (actionId: string, reason?: string) => void;
}> = ({ action, isLatest, defaultExpanded, frame, pendingApproval, onApprove, onReject }) => {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [rejectReason, setRejectReason] = useState('');
  const details = actionDetailEntries(action);
  const ActionIcon = actionIcon(action.kind);
  const isRunning = action.status === 'running';

  return (
    <div className={`rounded-xl border-l-4 border border-border/50 bg-card/60 overflow-hidden ${statusBorderColor(action.status)}`}>
      {/* Header — always visible, clickable */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-2 transition-colors hover:bg-muted/30"
      >
        {expanded
          ? <ChevronDownIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          : <ChevronRightIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
        <ActionIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="text-xs font-medium">{action.kind}</span>
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${statusBadgeClass(action.status)}`}>
          {isRunning && <LoaderIcon className="mr-1 inline h-2.5 w-2.5 animate-spin" />}
          {action.status}
        </span>
        {action.risk !== 'low' && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{action.risk}</span>
        )}
        <span className="ml-auto shrink-0 text-[10px] tabular-nums text-muted-foreground">{formatRelativeTime(action.createdAt)}</span>
      </button>

      {/* Expanded body */}
      {expanded && (
        <div className="border-t border-border/40">
          {/* Rationale — the AI's "thinking" */}
          <div className="px-3 py-2.5">
            <p className="text-sm leading-relaxed text-foreground/90">{action.rationale}</p>
          </div>

          {/* Action details (parameters) */}
          {details.length > 0 && (
            <div className="border-t border-border/30 px-3 py-2">
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {details.map(([key, value]) => (
                  <div key={key} className="text-[11px]">
                    <span className="text-muted-foreground">{key}:</span>{' '}
                    <span className="font-mono text-foreground/80">{value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Result summary */}
          {action.resultSummary && (
            <div className="border-t border-border/30 px-3 py-2">
              <div className="flex items-start gap-1.5 text-xs">
                <CheckCircle2Icon className="mt-0.5 h-3 w-3 shrink-0 text-green-500" />
                <span className="text-foreground/80">{action.resultSummary}</span>
              </div>
            </div>
          )}

          {/* Error */}
          {action.error && (
            <div className="border-t border-destructive/20 bg-destructive/5 px-3 py-2">
              <div className="flex items-start gap-1.5 text-xs">
                <AlertCircleIcon className="mt-0.5 h-3 w-3 shrink-0 text-destructive" />
                <span className="text-destructive">{action.error}</span>
              </div>
            </div>
          )}

          {/* Screenshot — shown for every action that has an associated frame */}
          {frame && (
            <div className="border-t border-border/30 px-3 py-2">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                {isLatest ? 'Current viewport' : 'Viewport at this step'}
              </div>
              <ScreenshotThumbnail
                frame={frame}
                cursorX={action.resolvedX ?? action.x}
                cursorY={action.resolvedY ?? action.y}
                dragEndX={action.endX}
                dragEndY={action.endY}
                actionDisplayIndex={action.displayIndex}
              />
            </div>
          )}

          {/* Approval inline */}
          {pendingApproval && (
            <div className="border-t border-amber-500/30 bg-amber-500/5 px-3 py-2.5">
              <div className="text-xs font-medium text-amber-700 dark:text-amber-300">{pendingApproval.prompt}</div>
              {pendingApproval.rationale && <p className="mt-0.5 text-[11px] text-muted-foreground">{pendingApproval.rationale}</p>}
              <input
                type="text"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Rejection reason (optional)"
                className="mt-2 w-full rounded-xl border border-border/60 bg-card/80 px-3 py-1.5 text-xs outline-none placeholder:text-muted-foreground/50"
              />
              <div className="mt-2 flex gap-1.5">
                <button type="button" onClick={() => onApprove?.(action.id)} className="rounded-xl bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90">
                  Approve
                </button>
                <button type="button" onClick={() => onReject?.(action.id, rejectReason || undefined)} className="rounded-xl border border-border/70 px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted/50">
                  Reject
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/* ---------- frame resolution ---------- */

/**
 * Find the closest frame captured at or before an action's createdAt time.
 * Falls back to the session's latestFrame for the most recent action.
 */
function resolveFrameForAction(
  action: ComputerActionProposal,
  frames: ComputerFrame[],
  isLatest: boolean,
  latestFrame?: ComputerFrame,
): ComputerFrame | undefined {
  // For the latest action, always use the current frame
  if (isLatest && latestFrame) return latestFrame;

  // Binary search for the last frame created at or before the action's time
  const actionTime = action.createdAt;
  let best: ComputerFrame | undefined;
  for (let i = frames.length - 1; i >= 0; i--) {
    if (frames[i].createdAt <= actionTime) {
      best = frames[i];
      break;
    }
  }
  // If no frame before the action, use the first frame after it
  if (!best && frames.length > 0) {
    for (const f of frames) {
      if (f.createdAt >= actionTime) {
        best = f;
        break;
      }
    }
  }
  return best;
}

/* ---------- main component ---------- */

export const ComputerStepLog: FC<{
  session: ComputerSession;
  /** Ordered list of captured frames for this session (from ComputerUseProvider.frameHistory) */
  frames?: ComputerFrame[];
  onApprove?: (actionId: string) => void;
  onReject?: (actionId: string, reason?: string) => void;
}> = ({ session, frames = [], onApprove, onReject }) => {
  const bottomRef = useRef<HTMLDivElement>(null);
  const pendingApprovalMap = useMemo(() => {
    const map = new Map<string, ComputerSession['approvals'][number]>();
    for (const approval of session.approvals) {
      if (approval.status === 'pending') {
        map.set(approval.actionId, approval);
      }
    }
    return map;
  }, [session.approvals]);

  // Build interleaved timeline: actions + checkpoint dividers + guidance messages
  const timeline = useMemo<TimelineItem[]>(() => {
    // Merge all timeline events into a single sorted list
    type Timed = { createdAt: string; item: TimelineItem };
    const all: Timed[] = [
      ...session.actions.map((action, index) => ({ createdAt: action.createdAt, item: { type: 'action' as const, action, index } })),
      ...session.checkpoints.map((checkpoint) => ({ createdAt: checkpoint.createdAt, item: { type: 'checkpoint' as const, checkpoint } })),
      ...(session.guidanceMessages ?? []).map((message) => ({ createdAt: message.createdAt, item: { type: 'guidance' as const, message } })),
    ];
    all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return all.map((entry) => entry.item);
  }, [session.actions, session.checkpoints, session.guidanceMessages]);

  const actionCount = session.actions.length;

  // Auto-scroll to bottom when new actions arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [actionCount]);

  if (session.actions.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border/50 bg-card/20 px-4 py-6 text-center text-xs text-muted-foreground">
        Waiting for first action...
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Stats bar */}
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
        <span>{session.actions.length} step{session.actions.length !== 1 ? 's' : ''}</span>
        <span className="text-border">·</span>
        <span>{session.actions.filter((a) => a.status === 'completed').length} completed</span>
        {session.checkpoints.length > 0 && (
          <>
            <span className="text-border">·</span>
            <span>{session.checkpoints.length} checkpoint{session.checkpoints.length !== 1 ? 's' : ''}</span>
          </>
        )}
      </div>

      {/* Timeline */}
      <div className="space-y-1.5">
        {timeline.map((item) => {
          if (item.type === 'checkpoint') {
            return <CheckpointDivider key={`cp-${item.checkpoint.id}`} checkpoint={item.checkpoint} />;
          }

          if (item.type === 'guidance') {
            return <GuidanceCard key={`guide-${item.message.id}`} message={item.message} />;
          }

          const isLatest = item.index === session.actions.length - 1;
          // Auto-expand the last 2 steps, and any awaiting approval
          const defaultExpanded = isLatest
            || item.index === session.actions.length - 2
            || item.action.status === 'awaiting-approval'
            || item.action.status === 'running';

          const frame = resolveFrameForAction(item.action, frames, isLatest, session.latestFrame);

          return (
            <StepCard
              key={item.action.id}
              action={item.action}
              isLatest={isLatest}
              defaultExpanded={defaultExpanded}
              frame={frame}
              pendingApproval={pendingApprovalMap.get(item.action.id)}
              onApprove={onApprove}
              onReject={onReject}
            />
          );
        })}
      </div>

      <div ref={bottomRef} />
    </div>
  );
};
