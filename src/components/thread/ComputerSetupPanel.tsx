import { useEffect, useRef, useState, useCallback, type FC, type KeyboardEvent } from 'react';
import { ExternalLinkIcon, LoaderIcon, MonitorIcon, ShieldCheckIcon, ShieldAlertIcon, MaximizeIcon, MousePointerIcon } from 'lucide-react';
import { useConfig } from '@/providers/ConfigProvider';
import { useComputerUse } from '@/providers/ComputerUseProvider';
import { legion } from '@/lib/ipc-client';
import { ModelSelector } from './ModelSelector';
import { ProfileSelector } from './ProfileSelector';
import { FallbackToggle } from './FallbackToggle';
import { ReasoningEffortSelector, type ReasoningEffort } from './ReasoningEffortSelector';
import type {
  ComputerSession,
  ComputerUsePermissions,
  ComputerUseSurface,
  ComputerUseTarget,
} from '../../../shared/computer-use';
import { isComputerSessionTerminal } from '../../../shared/computer-use';

type ComputerSetupPanelProps = {
  conversationId: string | null;
  selectedModelKey: string | null;
  onSelectModel: (key: string) => void;
  reasoningEffort: ReasoningEffort;
  onChangeReasoningEffort: (value: ReasoningEffort) => void;
  selectedProfileKey: string | null;
  onSelectProfile: (key: string | null, primaryModelKey: string | null) => void;
  fallbackEnabled: boolean;
  onToggleFallback: (value: boolean) => void;
  startSurface?: ComputerUseSurface;
  activeComputerSession?: ComputerSession;
  onOpenPopout?: () => void;
};

const TARGET_LABELS: Record<ComputerUseTarget, string> = {
  'isolated-browser': 'Browser',
  'local-macos': 'Local Mac',
};

const APPROVAL_LABELS: Record<string, string> = {
  step: 'Step',
  goal: 'Goal',
  autonomous: 'Auto',
};

export const ComputerSetupPanel: FC<ComputerSetupPanelProps> = ({
  conversationId,
  selectedModelKey,
  onSelectModel,
  reasoningEffort,
  onChangeReasoningEffort,
  selectedProfileKey,
  onSelectProfile,
  fallbackEnabled,
  onToggleFallback,
  startSurface = 'docked',
  activeComputerSession,
  onOpenPopout,
}) => {
  const { config } = useConfig();
  const {
    startSession,
    continueSession,
    checkLocalMacosPermissions,
    requestLocalMacosPermissions,
    openLocalMacosPrivacySettings,
    probeInputMonitoring,
  } = useComputerUse();
  const [computerGoal, setComputerGoal] = useState('');
  const [computerTarget, setComputerTarget] = useState<ComputerUseTarget>('isolated-browser');
  const [computerApprovalMode, setComputerApprovalMode] = useState<'step' | 'goal' | 'autonomous'>('step');
  const [isStartingComputerSession, setIsStartingComputerSession] = useState(false);
  const [probedLocalPermissionState, setProbedLocalPermissionState] = useState<ComputerUsePermissions | null>(null);
  const [isCheckingLocalPermissions, setIsCheckingLocalPermissions] = useState(false);
  const [showLocalPermissionSpinner, setShowLocalPermissionSpinner] = useState(false);
  const [isRequestingLocalPermissions, setIsRequestingLocalPermissions] = useState(false);
  const [isProbingInputMonitoring, setIsProbingInputMonitoring] = useState(false);
  const [inputMonitoringProbeAttempts, setInputMonitoringProbeAttempts] = useState(0);
  const [fullScreenApps, setFullScreenApps] = useState<string[]>([]);
  const [isExitingFullScreen, setIsExitingFullScreen] = useState(false);
  const goalRef = useRef<HTMLTextAreaElement>(null);

  const computerConfig = (config as Record<string, unknown> | null)?.computerUse as {
    defaultTarget?: ComputerUseTarget;
    approvalModeDefault?: 'step' | 'goal' | 'autonomous';
    isolated?: { remoteVmUrl?: string };
  } | undefined;

  useEffect(() => {
    setComputerTarget(computerConfig?.defaultTarget ?? 'isolated-browser');
    setComputerApprovalMode(computerConfig?.approvalModeDefault ?? 'step');
  }, [computerConfig?.approvalModeDefault, computerConfig?.defaultTarget]);

  const localPermissionState = activeComputerSession?.permissionState?.target === 'local-macos'
    ? activeComputerSession.permissionState
    : probedLocalPermissionState;
  const localPermissionAuthorized = localPermissionState?.target === 'local-macos'
    && localPermissionState.helperReady
    && localPermissionState.accessibilityTrusted
    && localPermissionState.screenRecordingGranted
    && localPermissionState.automationGranted
    && localPermissionState.inputMonitoringGranted;
  // When all standard permissions pass but only input monitoring failed,
  // show a dedicated "move your mouse" probe UI instead of the generic missing permissions message.
  const onlyInputMonitoringMissing = localPermissionState?.target === 'local-macos'
    && localPermissionState.helperReady
    && localPermissionState.accessibilityTrusted
    && localPermissionState.screenRecordingGranted
    && localPermissionState.automationGranted
    && !localPermissionState.inputMonitoringGranted;
  const showLocalMacPreflight = computerTarget === 'local-macos' && (showLocalPermissionSpinner || !localPermissionAuthorized);
  const canStart = Boolean(conversationId) && Boolean(computerGoal.trim()) && !isStartingComputerSession;

  useEffect(() => {
    if (computerTarget !== 'local-macos') {
      setProbedLocalPermissionState(null);
      setIsCheckingLocalPermissions(false);
      setShowLocalPermissionSpinner(false);
      setInputMonitoringProbeAttempts(0);
      return;
    }

    if (activeComputerSession?.permissionState?.target === 'local-macos') {
      setProbedLocalPermissionState(null);
      setIsCheckingLocalPermissions(false);
      setShowLocalPermissionSpinner(false);
      return;
    }

    let cancelled = false;
    const spinnerTimer = window.setTimeout(() => {
      if (!cancelled) {
        setShowLocalPermissionSpinner(true);
      }
    }, 500);

    setIsCheckingLocalPermissions(true);
    setShowLocalPermissionSpinner(false);

    void checkLocalMacosPermissions()
      .then((permissions) => {
        if (!cancelled) {
          setProbedLocalPermissionState(permissions);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setProbedLocalPermissionState(null);
        }
      })
      .finally(() => {
        window.clearTimeout(spinnerTimer);
        if (!cancelled) {
          setIsCheckingLocalPermissions(false);
          setShowLocalPermissionSpinner(false);
        }
      });

    return () => {
      cancelled = true;
      window.clearTimeout(spinnerTimer);
    };
  }, [activeComputerSession?.permissionState, checkLocalMacosPermissions, computerTarget]);

  // Check for full-screen apps when local-macos target is selected
  useEffect(() => {
    if (computerTarget !== 'local-macos') {
      setFullScreenApps([]);
      return;
    }
    let cancelled = false;
    void legion.computerUse.checkFullScreenApps().then(({ problematicApps }) => {
      if (!cancelled) setFullScreenApps(problematicApps);
    }).catch(() => {
      if (!cancelled) setFullScreenApps([]);
    });
    return () => { cancelled = true; };
  }, [computerTarget]);

  const handleExitFullScreenApps = async () => {
    if (isExitingFullScreen || fullScreenApps.length === 0) return;
    setIsExitingFullScreen(true);
    try {
      await legion.computerUse.exitFullScreenApps(fullScreenApps);
      // Re-check after exiting
      const { problematicApps } = await legion.computerUse.checkFullScreenApps();
      setFullScreenApps(problematicApps);
    } finally {
      setIsExitingFullScreen(false);
    }
  };

  const handleRequestLocalPermissions = async () => {
    if (isRequestingLocalPermissions) return;
    setIsRequestingLocalPermissions(true);
    try {
      const result = await requestLocalMacosPermissions();
      setProbedLocalPermissionState(result.permissions);
    } finally {
      setIsRequestingLocalPermissions(false);
    }
  };

  const handleRetryInputMonitoringProbe = async () => {
    if (isProbingInputMonitoring) return;
    setIsProbingInputMonitoring(true);
    setInputMonitoringProbeAttempts((n) => n + 1);
    try {
      const granted = await probeInputMonitoring(3000);
      if (granted && probedLocalPermissionState) {
        setProbedLocalPermissionState({ ...probedLocalPermissionState, inputMonitoringGranted: true });
      }
    } finally {
      setIsProbingInputMonitoring(false);
    }
  };

  // Detect if there's a previous session that can be continued
  const canContinue = Boolean(activeComputerSession && isComputerSessionTerminal(activeComputerSession.status));

  const handleStart = useCallback(() => {
    if (!canStart || !conversationId || !computerGoal.trim()) return;
    setIsStartingComputerSession(true);

    // If there's a completed/stopped/failed session, continue it instead of starting new
    const promise = canContinue && activeComputerSession
      ? continueSession(activeComputerSession.id, computerGoal.trim())
      : startSession(computerGoal.trim(), {
          conversationId,
          target: computerTarget,
          surface: startSurface,
          approvalMode: computerApprovalMode,
          modelKey: selectedModelKey,
          profileKey: selectedProfileKey,
          fallbackEnabled,
          reasoningEffort,
        });

    void promise.then(() => {
      setComputerGoal('');
    }).finally(() => {
      setIsStartingComputerSession(false);
    });
  }, [canStart, canContinue, conversationId, computerGoal, startSession, continueSession, activeComputerSession, computerTarget, startSurface, computerApprovalMode, selectedModelKey, selectedProfileKey]);

  const handleGoalKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      handleStart();
    }
  };

  const cycleTarget = () => {
    const targets: ComputerUseTarget[] = ['isolated-browser', 'local-macos'];
    setComputerTarget(targets[(targets.indexOf(computerTarget) + 1) % targets.length]);
  };

  const cycleApproval = () => {
    const modes: Array<'step' | 'goal' | 'autonomous'> = ['step', 'goal', 'autonomous'];
    setComputerApprovalMode(modes[(modes.indexOf(computerApprovalMode) + 1) % modes.length]);
  };

  return (
    <div className="space-y-3 px-1 pb-1">
      {/* Goal input — Enter to start, Shift+Enter for newline */}
      <textarea
        ref={goalRef}
        value={computerGoal}
        onChange={(event) => setComputerGoal(event.target.value)}
        onKeyDown={handleGoalKeyDown}
        placeholder={!conversationId ? 'Select a conversation first...' : canContinue ? 'Continue the session with a follow-up... (Enter to resume)' : 'What should Interlink do on your computer? (Enter to start)'}
        disabled={!conversationId}
        rows={2}
        className="w-full resize-none rounded-xl border border-border/70 bg-card/80 px-3 py-2.5 text-sm outline-none placeholder:text-muted-foreground/50 disabled:cursor-not-allowed disabled:opacity-50"
      />

      {/* Permission alerts — only when there's a real problem */}
      {showLocalMacPreflight && (
        <div className="flex items-start gap-2.5 rounded-xl border border-border/60 bg-card/40 px-3 py-2 text-xs text-muted-foreground">
          {isCheckingLocalPermissions && showLocalPermissionSpinner ? (
            <div className="inline-flex items-center gap-2">
              <LoaderIcon className="h-3.5 w-3.5 animate-spin shrink-0" />
              <span>Checking permissions...</span>
            </div>
          ) : localPermissionAuthorized ? (
            <div className="inline-flex items-center gap-1.5">
              <ShieldCheckIcon className="h-3.5 w-3.5 text-green-500 shrink-0" />
              <span>Local Mac permissions granted</span>
            </div>
          ) : onlyInputMonitoringMissing ? (
            <div className="flex-1">
              <div className="inline-flex items-center gap-1.5 font-medium">
                {isProbingInputMonitoring
                  ? <LoaderIcon className="h-3.5 w-3.5 animate-spin shrink-0" />
                  : <MousePointerIcon className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                }
                <span>{isProbingInputMonitoring ? 'Checking takeover monitor...' : 'Takeover monitor check'}</span>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground/80">
                {isProbingInputMonitoring
                  ? 'Move your mouse or press any key to verify the takeover monitor can detect your input.'
                  : inputMonitoringProbeAttempts === 0
                    ? 'Move your mouse or press a key, then tap Verify below to confirm the takeover monitor works.'
                    : 'No input detected. Ensure Input Monitoring is enabled for Interlink in System Settings \u203A Privacy & Security \u203A Input Monitoring, then try again.'
                }
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => { void handleRetryInputMonitoringProbe(); }}
                  disabled={isProbingInputMonitoring}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-border/70 bg-card/70 px-2.5 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isProbingInputMonitoring ? <LoaderIcon className="h-3 w-3 animate-spin" /> : <MousePointerIcon className="h-3 w-3" />}
                  <span>{isProbingInputMonitoring ? 'Listening...' : 'Verify'}</span>
                </button>
                {inputMonitoringProbeAttempts > 0 && (
                  <button
                    type="button"
                    onClick={() => { void openLocalMacosPrivacySettings('input-monitoring'); }}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-border/70 bg-card/70 px-2.5 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-muted/50"
                  >
                    Open Settings
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="flex-1">
              <div className="inline-flex items-center gap-1.5 font-medium">
                <ShieldAlertIcon className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                <span>Missing local permissions</span>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => { void handleRequestLocalPermissions(); }}
                  disabled={isRequestingLocalPermissions}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-border/70 bg-card/70 px-2.5 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isRequestingLocalPermissions ? <LoaderIcon className="h-3 w-3 animate-spin" /> : null}
                  <span>{isRequestingLocalPermissions ? 'Requesting...' : 'Request Access'}</span>
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
        </div>
      )}

      {/* Full-screen app warning — only for local-macos target */}
      {computerTarget === 'local-macos' && fullScreenApps.length > 0 && (
        <div className="flex items-start gap-2.5 rounded-xl border border-border/60 bg-card/40 px-3 py-2 text-xs text-muted-foreground">
          <div className="flex-1">
            <div className="inline-flex items-center gap-1.5 font-medium">
              <MaximizeIcon className="h-3.5 w-3.5 text-amber-500 shrink-0" />
              <span>Full-screen apps detected</span>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground/80">
              <span className="font-medium text-foreground">{fullScreenApps.join(', ')}</span> {fullScreenApps.length === 1 ? 'is' : 'are'} in
              full-screen mode. Screenshots may appear blank, which can cause the AI to get stuck.
            </p>
            <div className="mt-1.5">
              <button
                type="button"
                onClick={() => { void handleExitFullScreenApps(); }}
                disabled={isExitingFullScreen}
                className="inline-flex items-center gap-1.5 rounded-xl border border-border/70 bg-card/70 px-2.5 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isExitingFullScreen ? <LoaderIcon className="h-3 w-3 animate-spin" /> : <MaximizeIcon className="h-3 w-3" />}
                <span>{isExitingFullScreen ? 'Exiting full-screen...' : `Exit full-screen for ${fullScreenApps.length === 1 ? fullScreenApps[0] : 'all'}`}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Controls row — compact pills + selectors + start button */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {/* Target selector (clickable pill) */}
          <button
            type="button"
            onClick={cycleTarget}
            title={`Target: ${TARGET_LABELS[computerTarget]} (click to change)`}
            className="inline-flex items-center gap-1.5 rounded-xl border border-border/70 bg-card/70 px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-muted/50"
          >
            <MonitorIcon className="h-3.5 w-3.5 text-muted-foreground" />
            <span>{TARGET_LABELS[computerTarget]}</span>
          </button>

          {/* Approval mode selector (clickable pill) */}
          <button
            type="button"
            onClick={cycleApproval}
            title={`Approval: ${APPROVAL_LABELS[computerApprovalMode]} (click to change)`}
            className="inline-flex items-center gap-1.5 rounded-xl border border-border/70 bg-card/70 px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-muted/50"
          >
            <ShieldCheckIcon className="h-3.5 w-3.5 text-muted-foreground" />
            <span>{APPROVAL_LABELS[computerApprovalMode]}</span>
          </button>

          <ProfileSelector
            selectedProfileKey={selectedProfileKey}
            onSelectProfile={onSelectProfile}
          />
          <FallbackToggle
            enabled={fallbackEnabled}
            onToggle={onToggleFallback}
          />
          <ModelSelector
            selectedModelKey={selectedModelKey}
            onSelectModel={onSelectModel}
            disabled={fallbackEnabled}
            filter={(model) => Boolean(
              (model.computerUseSupport && model.computerUseSupport !== 'none')
              || model.visionCapable,
            )}
            fallbackToUnfilteredWhenEmpty
          />
          <ReasoningEffortSelector
            value={reasoningEffort}
            onChange={onChangeReasoningEffort}
          />

          {onOpenPopout ? (
            <button
              type="button"
              onClick={onOpenPopout}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-card/70 transition-colors hover:bg-muted/50"
              title="Open in popout window"
            >
              <ExternalLinkIcon className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          ) : null}
        </div>

        {/* Start button */}
        <button
          type="button"
          onClick={handleStart}
          disabled={!canStart}
          title={!conversationId ? 'Select a conversation first' : !computerGoal.trim() ? 'Enter a goal first' : isStartingComputerSession ? (canContinue ? 'Resuming...' : 'Starting...') : canContinue ? 'Continue session' : 'Start computer session'}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
        >
          {isStartingComputerSession ? (
            <LoaderIcon className="h-4 w-4 animate-spin" />
          ) : (
            <MonitorIcon className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* Active session indicator — compact */}
      {activeComputerSession ? (
        <div className="text-[11px] text-muted-foreground">
          Session <span className="font-medium text-foreground">{activeComputerSession.status}</span> — view in Computer tab above
        </div>
      ) : null}
    </div>
  );
};
