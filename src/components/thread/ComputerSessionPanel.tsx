import { useEffect, useMemo, useState, type FC } from 'react';
import { CheckCircle2Icon, ChevronDownIcon, ChevronRightIcon, ExternalLinkIcon, LoaderIcon, PauseIcon, PlayIcon, ShieldAlertIcon, SquareIcon } from 'lucide-react';
import { useComputerUse } from '@/providers/ComputerUseProvider';
import { useConfig } from '@/providers/ConfigProvider';
import { app } from '@/lib/ipc-client';
import { ComputerStepLog } from './ComputerStepLog';
import { ModelSelector } from './ModelSelector';
import { ProfileSelector } from './ProfileSelector';
import { FallbackToggle } from './FallbackToggle';
import { ReasoningEffortSelector } from './ReasoningEffortSelector';
import type { ComputerActionProposal, ComputerSession } from '../../../shared/computer-use';

type PanelProps = {
  session: ComputerSession;
};

function getBadgeClass(status: ComputerSession['status']): string {
  if (status === 'running') return 'bg-blue-500/10 text-blue-600 dark:text-blue-400';
  if (status === 'awaiting-approval') return 'bg-amber-500/10 text-amber-700 dark:text-amber-300';
  if (status === 'completed') return 'bg-green-500/10 text-green-600 dark:text-green-400';
  if (status === 'failed') return 'bg-destructive/10 text-destructive';
  return 'bg-muted text-muted-foreground';
}

function hasMissingLocalPermission(session: ComputerSession): boolean {
  const permissions = session.permissionState;
  if (!permissions || permissions.target !== 'local-macos') return false;
  return !permissions.accessibilityTrusted || !permissions.screenRecordingGranted || !permissions.automationGranted;
}

function isLikelyHumanTakeover(session: ComputerSession): boolean {
  if (session.humanInControl || session.pauseReason === 'takeover') return true;
  if (session.status !== 'paused') return false;
  const text = `${session.statusMessage ?? ''} ${session.lastError ?? ''} ${session.planSummary ?? ''}`.toLowerCase();
  return text.includes('human') || text.includes('takeover') || text.includes('manual control') || text.includes('in control');
}

function isPointerAction(action: Pick<ComputerActionProposal, 'kind'>): boolean {
  return action.kind === 'movePointer' || action.kind === 'click' || action.kind === 'doubleClick' || action.kind === 'drag';
}

function formatMovementPath(path: ComputerActionProposal['movementPath']): string {
  return path === 'teleport'
    ? 'teleport'
    : path === 'horizontal-first'
    ? 'horizontal first'
    : path === 'vertical-first'
      ? 'vertical first'
      : 'direct';
}

function formatElapsed(startedAt: string): string {
  const ms = Date.now() - new Date(startedAt).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export const ComputerSessionPanel: FC<PanelProps> = ({ session }) => {
  const {
    pauseSession,
    resumeSession,
    stopSession,
    approveAction,
    rejectAction,
    setSurface,
    requestLocalMacosPermissions,
    openLocalMacosPrivacySettings,
    updateSessionSettings,
    frameHistory,
  } = useComputerUse();
  const { config } = useConfig();
  const showStepLog = (config as Record<string, unknown> | null)?.computerUse
    ? ((config as Record<string, unknown>).computerUse as { showStepLog?: boolean })?.showStepLog ?? true
    : true;
  const sessionFrames = frameHistory.get(session.id) ?? [];
  const [rejectReasonByApproval, setRejectReasonByApproval] = useState<Record<string, string>>({});
  const [isRequestingPermissions, setIsRequestingPermissions] = useState(false);
  const [isResuming, setIsResuming] = useState(false);
  const [timelineExpanded, setTimelineExpanded] = useState(false);
  const [profilePrimaryModelKey, setProfilePrimaryModelKey] = useState<string | null>(null);

  // Resolve the profile's primary model key so the fallback toggle can update the model selector
  useEffect(() => {
    const profileKey = session.selectedProfileKey;
    if (!profileKey) {
      setProfilePrimaryModelKey(null);
      return;
    }
    app.profileCatalog()
      .then((catalog) => {
        const profile = (catalog as { profiles: Array<{ key: string; primaryModelKey: string }> }).profiles
          .find((p) => p.key === profileKey);
        setProfilePrimaryModelKey(profile?.primaryModelKey ?? null);
      })
      .catch(() => setProfilePrimaryModelKey(null));
  }, [session.selectedProfileKey]);
  const pendingApprovals = session.approvals.filter((approval) => approval.status === 'pending');
  const latestFrame = session.latestFrame;
  const canResume = session.status === 'paused' || session.status === 'failed';
  const canPause = session.status === 'running';
  const latestCheckpoint = session.checkpoints[session.checkpoints.length - 1];
  const timeline = useMemo(() => session.actions.slice(-4), [session.actions]);
  const missingPermission = hasMissingLocalPermission(session);
  const takeoverLikely = isLikelyHumanTakeover(session);
  const cursorClickedRecently = session.cursor?.clickedAt
    ? Date.now() - new Date(session.cursor.clickedAt).getTime() < 700
    : false;
  const isTerminal = session.status === 'completed' || session.status === 'failed' || session.status === 'stopped';

  const handleResume = async () => {
    if (isResuming) return;
    setIsResuming(true);
    try {
      await resumeSession(session.id);
    } finally {
      setIsResuming(false);
    }
  };

  return (
    <div className="space-y-3">
      {/* Header: goal + status + controls */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${getBadgeClass(session.status)}`}>
              {session.status}
            </span>
            {session.createdAt && (
              <span className="text-[10px] tabular-nums text-muted-foreground">{formatElapsed(session.createdAt)}</span>
            )}
            <span className="text-[10px] text-muted-foreground">{session.target} · {session.approvalMode}</span>
          </div>
          <p className="mt-1 text-sm font-medium leading-snug">{session.goal}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {canPause && (
            <button type="button" onClick={() => { void pauseSession(session.id); }} className="flex h-8 w-8 items-center justify-center rounded-xl border border-border/70 bg-card/70 transition-colors hover:bg-muted/50" title="Pause">
              <PauseIcon className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          )}
          {canResume && (
            <button
              type="button"
              onClick={() => { void handleResume(); }}
              disabled={isResuming}
              className="flex h-8 w-8 items-center justify-center rounded-xl border border-border/70 bg-card/70 transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-60"
              title={isResuming ? 'Resuming...' : 'Resume'}
            >
              {isResuming
                ? <LoaderIcon className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                : <PlayIcon className="h-3.5 w-3.5 text-muted-foreground" />}
            </button>
          )}
          {!isTerminal && (
            <button type="button" onClick={() => { void stopSession(session.id); }} className="flex h-8 w-8 items-center justify-center rounded-xl border border-border/70 bg-card/70 transition-colors hover:bg-destructive/10" title="Stop">
              <SquareIcon className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          )}
          <button type="button" onClick={() => { void setSurface(session.id, 'window'); }} className="flex h-8 w-8 items-center justify-center rounded-xl border border-border/70 bg-card/70 transition-colors hover:bg-muted/50" title="Detach to window">
            <ExternalLinkIcon className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        </div>
      </div>

      {/* Alert banners — only critical ones */}
      {takeoverLikely && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          Human in control. Resume when ready.
        </div>
      )}

      {/* Mid-session model/profile/fallback controls */}
      {!isTerminal && (
        <div className="flex flex-wrap items-center gap-1.5">
          <ProfileSelector
            selectedProfileKey={session.selectedProfileKey ?? null}
            onSelectProfile={(profileKey, primaryModelKey) => {
              setProfilePrimaryModelKey(primaryModelKey);
              if (profileKey !== null) {
                // Selecting a profile: auto-enable fallback, switch to profile's primary model
                void updateSessionSettings(session.id, {
                  profileKey,
                  fallbackEnabled: true,
                  ...(primaryModelKey ? { modelKey: primaryModelKey } : {}),
                });
              } else {
                // Returning to default: disable fallback, clear profile
                void updateSessionSettings(session.id, {
                  profileKey: null,
                  fallbackEnabled: false,
                });
              }
            }}
            dropdownDirection="down"
          />
          <FallbackToggle
            enabled={session.fallbackEnabled ?? false}
            onToggle={(enabled) => {
              if (enabled && session.selectedProfileKey && profilePrimaryModelKey) {
                void updateSessionSettings(session.id, { fallbackEnabled: enabled, modelKey: profilePrimaryModelKey });
              } else {
                void updateSessionSettings(session.id, { fallbackEnabled: enabled });
              }
            }}
          />
          <ModelSelector
            selectedModelKey={session.selectedModelKey}
            onSelectModel={(key) => {
              void updateSessionSettings(session.id, { modelKey: key });
            }}
            disabled={session.fallbackEnabled ?? false}
            filter={(model) => Boolean(
              (model.computerUseSupport && model.computerUseSupport !== 'none')
              || model.visionCapable,
            )}
            fallbackToUnfilteredWhenEmpty
            dropdownDirection="down"
          />
          <ReasoningEffortSelector
            value={(session.reasoningEffort as 'low' | 'medium' | 'high' | 'xhigh') ?? 'medium'}
            onChange={(value) => {
              void updateSessionSettings(session.id, { reasoningEffort: value });
            }}
            dropdownDirection="down"
          />
        </div>
      )}

      {missingPermission && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <div className="font-medium">Missing local permissions</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => {
                if (isRequestingPermissions) return;
                setIsRequestingPermissions(true);
                void requestLocalMacosPermissions().finally(() => setIsRequestingPermissions(false));
              }}
              disabled={isRequestingPermissions}
              className="inline-flex items-center gap-1.5 rounded-xl border border-border/70 bg-card/70 px-2.5 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isRequestingPermissions ? <LoaderIcon className="h-3 w-3 animate-spin" /> : null}
              <span>{isRequestingPermissions ? 'Requesting...' : 'Request Access'}</span>
            </button>
            <button
              type="button"
              onClick={() => { void openLocalMacosPrivacySettings(); }}
              className="inline-flex items-center gap-1.5 rounded-xl border border-border/70 bg-card/70 px-2.5 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-muted/50"
            >
              Open Settings
            </button>
          </div>
        </div>
      )}

      {session.status === 'failed' && session.lastError && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {session.lastError}
        </div>
      )}

      {session.statusMessage && !takeoverLikely && session.status !== 'failed' && (
        <div className="rounded-xl border border-border/60 bg-card/40 px-3 py-2 text-xs text-muted-foreground">
          {session.statusMessage}
        </div>
      )}

      {/* Pending approvals — full width, above viewport for visibility */}
      {pendingApprovals.length > 0 && (
        <div className="space-y-2">
          {pendingApprovals.map((approval) => {
            const action = session.actions.find((candidate) => candidate.id === approval.actionId);
            return (
              <div key={approval.id} className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <ShieldAlertIcon className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                      <span className="text-xs font-medium">Approval needed</span>
                    </div>
                    <p className="mt-1 text-xs">{approval.prompt}</p>
                    {approval.rationale && <p className="mt-0.5 text-[11px] text-muted-foreground">{approval.rationale}</p>}
                    {action && (
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {action.kind}{isPointerAction(action) ? ` · ${formatMovementPath(action.movementPath)}` : ''}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button type="button" onClick={() => { void approveAction(session.id, approval.actionId); }} className="rounded-xl bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90">
                      Approve
                    </button>
                    <button type="button" onClick={() => { void rejectAction(session.id, approval.actionId, rejectReasonByApproval[approval.id] || undefined); }} className="rounded-xl border border-border/70 px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted/50">
                      Reject
                    </button>
                  </div>
                </div>
                <input
                  type="text"
                  value={rejectReasonByApproval[approval.id] ?? ''}
                  onChange={(event) => setRejectReasonByApproval((current) => ({ ...current, [approval.id]: event.target.value }))}
                  placeholder="Rejection reason (optional)"
                  className="mt-2 w-full rounded-xl border border-border/60 bg-card/80 px-3 py-1.5 text-xs outline-none placeholder:text-muted-foreground/50"
                />
              </div>
            );
          })}
        </div>
      )}

      {/* Viewport */}
      {latestFrame ? (
        <div className="space-y-2">
          {/* Multi-display: show each display as a separate labeled image */}
          {latestFrame.displayFrames && latestFrame.displayFrames.length > 1 ? (
            <div className="grid gap-2" style={{ gridTemplateColumns: latestFrame.displayFrames.length <= 2 ? 'repeat(2, 1fr)' : 'repeat(3, 1fr)' }}>
              {latestFrame.displayFrames.map((df) => (
                <div key={df.displayIndex} className="overflow-hidden rounded-xl border border-border/60 bg-black/80">
                  <div className="flex items-center gap-1.5 border-b border-border/40 px-2 py-1">
                    <span className="text-[10px] font-medium text-muted-foreground">Display {df.displayIndex}</span>
                    <span className="text-[10px] text-muted-foreground/60 truncate">{df.displayName}</span>
                  </div>
                  <div className="relative">
                    <img src={df.dataUrl} alt={`Display ${df.displayIndex}: ${df.displayName}`} className="block max-h-[280px] w-full object-contain" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            /* Single display: show as before */
            <div className="overflow-hidden rounded-2xl border border-border/60 bg-black/80">
              <div className="flex justify-center">
                <div className="relative inline-block">
                  <img src={latestFrame.dataUrl} alt="Live viewport" className="block max-h-[380px] max-w-full object-contain" />
                  {session.cursor?.visible && (
                    <>
                      <div
                        className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary bg-primary/20 shadow-[0_0_0_6px_rgba(148,163,184,0.12)] transition-[left,top] duration-300 ease-out"
                        style={{ left: `${(session.cursor.x / Math.max(latestFrame.width, 1)) * 100}%`, top: `${(session.cursor.y / Math.max(latestFrame.height, 1)) * 100}%` }}
                      />
                      {cursorClickedRecently && (
                        <div
                          className="pointer-events-none absolute h-8 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full border border-primary/70 animate-ping"
                          style={{ left: `${(session.cursor.x / Math.max(latestFrame.width, 1)) * 100}%`, top: `${(session.cursor.y / Math.max(latestFrame.height, 1)) * 100}%` }}
                        />
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-center justify-center rounded-2xl border border-dashed border-border/60 bg-card/20 py-6">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <LoaderIcon className="h-3.5 w-3.5 animate-spin" />
            <span>Waiting for first frame...</span>
          </div>
        </div>
      )}

      {/* Subgoal */}
      {session.currentSubgoal && (
        <div className="rounded-xl border border-border/60 bg-card/40 px-3 py-2.5">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Current subgoal</div>
          <div className="mt-0.5 text-sm font-medium">{session.currentSubgoal}</div>
          {session.planSummary && <p className="mt-0.5 text-xs text-muted-foreground">{session.planSummary}</p>}
        </div>
      )}

      {/* Step Log or compact timeline */}
      {showStepLog ? (
        <ComputerStepLog
          session={session}
          frames={sessionFrames}
          onApprove={(actionId) => { void approveAction(session.id, actionId); }}
          onReject={(actionId, reason) => { void rejectAction(session.id, actionId, reason); }}
        />
      ) : timeline.length > 0 ? (
        <div className="rounded-xl border border-border/60 bg-card/40">
          <button
            type="button"
            onClick={() => setTimelineExpanded(!timelineExpanded)}
            className="flex w-full items-center gap-2 px-3 py-2 transition-colors hover:bg-muted/30"
          >
            {timelineExpanded
              ? <ChevronDownIcon className="h-3.5 w-3.5 text-muted-foreground" />
              : <ChevronRightIcon className="h-3.5 w-3.5 text-muted-foreground" />}
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Recent actions ({session.actions.length})
            </span>
          </button>
          {timelineExpanded && (
            <div className="space-y-1.5 border-t border-border/40 px-3 py-2">
              {timeline.map((action) => (
                <div key={action.id} className="flex items-start gap-2 text-xs">
                  <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${action.status === 'completed' ? 'bg-green-500/10 text-green-600 dark:text-green-400' : action.status === 'awaiting-approval' ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300' : action.status === 'failed' ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground'}`}>
                    {action.kind}
                  </span>
                  <span className="min-w-0 flex-1 text-[11px] text-muted-foreground">{action.rationale}</span>
                  {action.error && <span className="shrink-0 text-[10px] text-destructive">failed</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {/* Checkpoints — compact progress display */}
      {session.checkpoints.length > 0 && (
        <div className="rounded-xl border border-border/60 bg-card/40 px-3 py-2.5">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            <CheckCircle2Icon className="h-3.5 w-3.5" />
            Checkpoint {session.checkpoints.length}
          </div>
          {latestCheckpoint && (
            <div className="mt-1">
              <p className="text-xs font-medium">{latestCheckpoint.summary}</p>
              {latestCheckpoint.successCriteria.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {latestCheckpoint.successCriteria.slice(0, 3).map((criterion) => (
                    <span key={criterion} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{criterion}</span>
                  ))}
                  {latestCheckpoint.successCriteria.length > 3 && (
                    <span className="text-[10px] text-muted-foreground">+{latestCheckpoint.successCriteria.length - 3} more</span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Permissions — only when something is missing */}
      {missingPermission && session.permissionState && (
        <div className="rounded-xl border border-border/60 bg-card/40 px-3 py-2.5 text-xs text-muted-foreground">
          <div className="text-[10px] font-semibold uppercase tracking-wide">Permissions</div>
          <div className="mt-1 flex flex-wrap gap-2">
            <span className={session.permissionState.accessibilityTrusted ? 'text-green-600 dark:text-green-400' : 'text-destructive'}>
              Accessibility: {session.permissionState.accessibilityTrusted ? 'OK' : 'Missing'}
            </span>
            <span className={session.permissionState.screenRecordingGranted ? 'text-green-600 dark:text-green-400' : 'text-destructive'}>
              Screen: {session.permissionState.screenRecordingGranted ? 'OK' : 'Missing'}
            </span>
            <span className={session.permissionState.automationGranted ? 'text-green-600 dark:text-green-400' : 'text-destructive'}>
              Automation: {session.permissionState.automationGranted ? 'OK' : 'Missing'}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
