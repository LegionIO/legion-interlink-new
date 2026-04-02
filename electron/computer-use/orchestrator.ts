import type {
  ComputerActionProposal,
  ComputerSession,
  ComputerUseApprovalMode,
  ComputerUseEvent,
} from '../../shared/computer-use.js';
import { makeComputerUseId, nowIso } from '../../shared/computer-use.js';
import type { AppConfig } from '../config/schema.js';
import { resolveModelCatalog, resolveModelForThread, type ModelCatalogEntry } from '../agent/model-catalog.js';
import { anthropicPlanSession } from './provider-adapters/anthropic.js';
import { geminiPlanSession } from './provider-adapters/gemini.js';
import { openaiPlanSession } from './provider-adapters/openai.js';
import type { ModelChainEntry, FallbackCallbacks } from './provider-adapters/shared.js';
import { IsolatedBrowserHarness } from './harnesses/isolated-browser.js';
import { LocalMacosHarness } from './harnesses/local-macos.js';
import type { ComputerHarness, ComputerHarnessActionResult } from './harnesses/shared.js';
import { closeOverlayWindow, hideOverlayForCapture, showOverlayAfterCapture } from './overlay-window.js';

type SessionMutator = (sessionId: string, update: (session: ComputerSession) => ComputerSession) => ComputerSession | null;
type SessionReader = (sessionId: string) => ComputerSession | null;
type EventSink = (event: ComputerUseEvent) => void;

function getHarness(config: AppConfig, session: ComputerSession, getConfig: () => AppConfig): ComputerHarness {
  if (session.target === 'local-macos') return new LocalMacosHarness(getConfig);
  return new IsolatedBrowserHarness();
}

function getEntryForRole(config: AppConfig, session: ComputerSession, role: 'planner' | 'driver' | 'verifier' | 'recovery'): ModelCatalogEntry | null {
  const catalog = resolveModelCatalog(config);
  const computerModels = config.computerUse.models;
  const overrideKey = role === 'planner'
    ? computerModels.plannerModelKey
    : role === 'driver'
      ? computerModels.driverModelKey
      : role === 'verifier'
        ? computerModels.verifierModelKey
        : computerModels.recoveryModelKey;
  if (overrideKey) {
    return catalog.byKey.get(overrideKey) ?? null;
  }
  return resolveModelForThread(config, session.selectedModelKey ?? null);
}

function getModelChainForRole(config: AppConfig, session: ComputerSession, role: 'planner' | 'driver' | 'verifier' | 'recovery'): ModelChainEntry[] {
  const primaryEntry = getEntryForRole(config, session, role)
    ?? getEntryForRole(config, session, 'driver');
  if (!primaryEntry) return [];

  const primary: ModelChainEntry = {
    key: primaryEntry.key,
    modelConfig: primaryEntry.modelConfig,
    displayName: primaryEntry.displayName,
  };

  // If fallback is not enabled on the session, return only primary
  if (!session.fallbackEnabled) return [primary];

  // Build fallback chain: profile fallbacks → global fallback
  const catalog = resolveModelCatalog(config);
  const profileKey = session.selectedProfileKey ?? config.defaultProfileKey ?? null;
  const profile = profileKey
    ? (config.profiles ?? []).find((p) => p.key === profileKey)
    : undefined;
  const fallbackKeys = profile?.fallbackModelKeys ?? config.fallback?.modelKeys ?? [];

  const fallbacks: ModelChainEntry[] = fallbackKeys
    .filter((k) => k !== primaryEntry.key)
    .map((k) => catalog.byKey.get(k))
    .filter((e): e is ModelCatalogEntry => e != null)
    .map((e) => ({
      key: e.key,
      modelConfig: e.modelConfig,
      displayName: e.displayName,
    }));

  return [primary, ...fallbacks];
}

function getMaxRetries(config: AppConfig, session: ComputerSession): number {
  const profileKey = session.selectedProfileKey ?? config.defaultProfileKey ?? null;
  const profile = profileKey
    ? (config.profiles ?? []).find((p) => p.key === profileKey)
    : undefined;
  return profile?.maxRetries ?? config.advanced.maxRetries;
}

function approvalRequired(mode: ComputerUseApprovalMode, action: ComputerActionProposal, config: AppConfig): boolean {
  if (mode === 'autonomous') return false;
  if (mode === 'goal') return action.risk === 'high';
  if (config.computerUse.safety.pauseOnTerminal && action.appName?.toLowerCase().includes('terminal')) return true;
  return action.requiresApproval;
}

function getStartingCursor(action: ComputerActionProposal): { x: number; y: number; visible: true } | undefined {
  // For pointer actions, eagerly set the cursor to the target position so the
  // overlay indicator starts animating toward it immediately (before the action
  // completes). For drag, start at the drag origin; the end position is set
  // after the action finishes.
  if (action.kind === 'click' || action.kind === 'doubleClick' || action.kind === 'movePointer' || action.kind === 'drag') {
    if (action.x == null || action.y == null) return undefined;
    return { x: action.x, y: action.y, visible: true };
  }
  return undefined;
}

function getTerminalStatus(session: ComputerSession | null): session is ComputerSession {
  return Boolean(session && (session.status === 'failed' || session.status === 'completed' || session.status === 'stopped'));
}

function actionLoopFingerprint(action: Pick<ComputerActionProposal, 'kind' | 'selector' | 'elementId' | 'x' | 'y' | 'endX' | 'endY' | 'url' | 'text' | 'keys' | 'deltaX' | 'deltaY' | 'appName' | 'waitMs' | 'movementPath'>): string {
  return JSON.stringify({
    kind: action.kind,
    selector: action.selector ?? null,
    elementId: action.elementId ?? null,
    x: action.x ?? null,
    y: action.y ?? null,
    endX: action.endX ?? null,
    endY: action.endY ?? null,
    url: action.url ?? null,
    text: action.text ?? null,
    keys: action.keys ?? null,
    deltaX: action.deltaX ?? null,
    deltaY: action.deltaY ?? null,
    appName: action.appName ?? null,
    waitMs: action.waitMs ?? null,
    movementPath: action.movementPath,
  });
}

function getLoopRecoveryReason(session: ComputerSession): string | null {
  const candidates = session.actions
    .filter((action) => action.status === 'completed' || action.status === 'running' || action.status === 'failed')
    .slice(-8);
  if (candidates.length < 3) return null;

  const counts = new Map<string, number>();
  let repeatedAction: ComputerActionProposal | null = null;
  let repeatedCount = 0;

  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const action = candidates[index];
    const fingerprint = actionLoopFingerprint(action);
    const nextCount = (counts.get(fingerprint) ?? 0) + 1;
    counts.set(fingerprint, nextCount);
    if (nextCount >= 3) {
      repeatedAction = action;
      repeatedCount = nextCount;
      break;
    }
  }

  if (!repeatedAction || repeatedCount < 3) return null;

  const location = repeatedAction.x != null && repeatedAction.y != null
    ? ` at ${repeatedAction.x},${repeatedAction.y}`
    : '';
  return `Detected a repeated "${repeatedAction.kind}" action${location}. Switching to recovery strategy.`;
}

export class ComputerUseOrchestrator {
  private activeRuns = new Map<string, AbortController>();
  private cycleDurations = new Map<string, { avgMs: number; lastCaptureAt: string }>();

  /** Get the latest cycle timing data for a session (used by overlay). */
  getCycleTiming(sessionId: string): { avgCycleDurationMs: number; lastCaptureAt: string } | null {
    const data = this.cycleDurations.get(sessionId);
    if (!data) return null;
    return { avgCycleDurationMs: data.avgMs, lastCaptureAt: data.lastCaptureAt };
  }

  constructor(
    private readonly getConfig: () => AppConfig,
    private readonly readSession: SessionReader,
    private readonly mutateSession: SessionMutator,
    private readonly emitEvent: EventSink,
  ) {}

  resume(sessionId: string): void {
    if (this.activeRuns.has(sessionId)) return;
    const controller = new AbortController();
    this.activeRuns.set(sessionId, controller);
    void this.run(sessionId, controller).finally(() => {
      this.activeRuns.delete(sessionId);
    });
  }

  pause(sessionId: string): void {
    this.activeRuns.get(sessionId)?.abort();
    this.activeRuns.delete(sessionId);
  }

  stop(sessionId: string): void {
    this.pause(sessionId);
    this.cycleDurations.delete(sessionId);
  }

  async cleanupSession(sessionId: string): Promise<void> {
    this.cycleDurations.delete(sessionId);
    const session = this.readSession(sessionId);
    if (!session) return;
    const harness = getHarness(this.getConfig(), session, this.getConfig);
    await harness.dispose(sessionId).catch(() => {});
  }

  private async run(sessionId: string, controller: AbortController): Promise<void> {
    const session = this.readSession(sessionId);
    if (!session) return;
    const initialConfig = this.getConfig();
    const harness = getHarness(initialConfig, session, this.getConfig);
    try {
      await harness.initialize(session);
      this.mutateSession(sessionId, (current) => ({ ...current, status: 'running', updatedAt: nowIso() }));

      for (let step = 0; step < 12; step += 1) {
        if (controller.signal.aborted) return;
        const current = this.readSession(sessionId);
        if (!current || current.status === 'paused' || current.status === 'stopped' || current.status === 'completed') return;

        // Re-read config each step so mid-session changes take effect
        const config = this.getConfig();

        // Track cycle duration for the overlay countdown timer
        const stepStartMs = Date.now();
        const prevTiming = this.cycleDurations.get(sessionId);

        const frame = await harness.captureFrame(current);

        // Update cycle timing after capture
        if (prevTiming && step > 0) {
          const cycleDurationMs = stepStartMs - new Date(prevTiming.lastCaptureAt).getTime();
          const alpha = 0.3;
          const newAvg = prevTiming.avgMs > 0
            ? alpha * cycleDurationMs + (1 - alpha) * prevTiming.avgMs
            : cycleDurationMs;
          this.cycleDurations.set(sessionId, { avgMs: newAvg, lastCaptureAt: nowIso() });
        } else {
          this.cycleDurations.set(sessionId, { avgMs: 0, lastCaptureAt: nowIso() });
        }

        const environment = await harness.getEnvironmentMetadata(current);
        this.mutateSession(sessionId, (existing) => ({
          ...existing,
          latestFrame: frame,
          latestEnvironment: environment,
          displayLayout: frame.displayLayout ?? existing.displayLayout,
          updatedAt: nowIso(),
        }));
        this.emitEvent({ type: 'frame', sessionId, frame });

        const planningSession = this.readSession(sessionId) ?? current;
        const recoveryReason = getLoopRecoveryReason(planningSession);
        const planningRole = recoveryReason ? 'recovery' as const : 'driver' as const;

        // Build model chain with fallback support
        const modelChain = getModelChainForRole(config, planningSession, planningRole);
        if (modelChain.length === 0) {
          throw new Error('No model available for computer-use session.');
        }
        const maxRetries = getMaxRetries(config, planningSession);

        if (recoveryReason) {
          this.mutateSession(sessionId, (existing) => ({
            ...existing,
            statusMessage: recoveryReason,
            updatedAt: nowIso(),
          }));
        }

        const support = modelChain[0].modelConfig.provider === 'anthropic'
          ? 'anthropic-client-tool'
          : modelChain[0].modelConfig.provider === 'google'
            ? 'gemini-computer-use'
            : 'openai-responses';

        // Build fallback callbacks for status updates and events
        const fallbackCallbacks: FallbackCallbacks = {
          onModelStart: (model, _modelIndex, _totalModels) => {
            this.mutateSession(sessionId, (existing) => ({
              ...existing,
              statusMessage: `Planning with ${model}...`,
              updatedAt: nowIso(),
            }));
          },
          onRetry: (attempt, model, error) => {
            const msg = `Retrying with ${model} (attempt ${attempt}/${maxRetries})...`;
            this.mutateSession(sessionId, (existing) => ({
              ...existing,
              statusMessage: msg,
              updatedAt: nowIso(),
            }));
            console.warn(`[ComputerUse] ${msg} Error: ${error}`);
          },
          onFallback: (fromModel, toModel, toModelKey, error) => {
            this.mutateSession(sessionId, (existing) => ({
              ...existing,
              selectedModelKey: toModelKey,
              statusMessage: `Switched from ${fromModel} to ${toModel}`,
              updatedAt: nowIso(),
            }));
            this.emitEvent({
              type: 'model-fallback',
              sessionId,
              fromModel,
              toModel,
              toModelKey,
              error,
            });
            console.warn(`[ComputerUse] Fallback: ${fromModel} → ${toModel}. Error: ${error}`);
          },
        };

        // Consume any pending guidance messages before the next planning cycle
        const preSession = this.readSession(sessionId) ?? planningSession;
        const pendingGuidance = (preSession.guidanceMessages ?? []).filter((m) => !m.injectedAt);
        if (pendingGuidance.length > 0) {
          this.mutateSession(sessionId, (existing) => ({
            ...existing,
            guidanceMessages: (existing.guidanceMessages ?? []).map((m) =>
              pendingGuidance.some((pg) => pg.id === m.id)
                ? { ...m, injectedAt: nowIso() }
                : m,
            ),
            updatedAt: nowIso(),
          }));
        }

        const freshSession = this.readSession(sessionId) ?? planningSession;
        const excludedApps = config.computerUse.localMacos.captureExcludedApps;

        const plan = support === 'anthropic-client-tool'
          ? await anthropicPlanSession(freshSession, modelChain, maxRetries, planningRole, excludedApps, fallbackCallbacks)
          : support === 'gemini-computer-use'
            ? await geminiPlanSession(freshSession, modelChain, maxRetries, fallbackCallbacks)
            : await openaiPlanSession(freshSession, modelChain, maxRetries, planningRole, excludedApps, fallbackCallbacks);

        this.mutateSession(sessionId, (existing) => ({
          ...existing,
          plannerState: plan.plannerState,
          planSummary: plan.summary,
          currentSubgoal: plan.currentSubgoal,
          // Clear retry/fallback status messages after a successful plan
          statusMessage: undefined,
          updatedAt: nowIso(),
        }));

        if (plan.actions.length === 0 || plan.complete) {
          const checkpoint = {
            id: makeComputerUseId('checkpoint'),
            sessionId,
            createdAt: nowIso(),
            summary: plan.summary,
            successCriteria: plan.plannerState.successCriteria,
            activeSubgoal: plan.currentSubgoal,
            complete: plan.complete,
          };
          this.mutateSession(sessionId, (existing) => ({
            ...existing,
            status: plan.complete ? 'completed' : existing.status,
            checkpoints: [...existing.checkpoints, checkpoint],
            updatedAt: nowIso(),
          }));
          this.emitEvent({ type: 'checkpoint', sessionId, checkpoint });
          if (plan.complete) return;
          await new Promise((resolve) => setTimeout(resolve, 800));
          continue;
        }

        for (const proposed of plan.actions) {
          if (controller.signal.aborted) return;
          const currentSession = this.readSession(sessionId);
          if (!currentSession) return;
          const requiresApproval = approvalRequired(currentSession.approvalMode, proposed, config);
          const action: ComputerActionProposal = {
            ...proposed,
            requiresApproval,
            status: requiresApproval ? 'awaiting-approval' : 'running',
          };
          const startingCursor = getStartingCursor(action);
          this.mutateSession(sessionId, (existing) => ({
            ...existing,
            status: requiresApproval ? 'awaiting-approval' : 'running',
            actions: [...existing.actions, action],
            ...(startingCursor ? { cursor: { ...existing.cursor, ...startingCursor } } : {}),
            updatedAt: nowIso(),
          }));
          this.emitEvent({ type: 'action-updated', sessionId, action });

          if (requiresApproval) {
            const approval = {
              id: makeComputerUseId('approval'),
              sessionId,
              actionId: action.id,
              createdAt: nowIso(),
              status: 'pending' as const,
              prompt: `${action.kind} requires approval`,
              rationale: action.rationale,
            };
            this.mutateSession(sessionId, (existing) => ({
              ...existing,
              approvals: [...existing.approvals, approval],
              status: 'awaiting-approval',
              updatedAt: nowIso(),
            }));
            this.emitEvent({ type: 'approval-requested', sessionId, approval });
            return;
          }

          try {
            await this.executeAction(harness, action, controller.signal);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.markActionFailed(sessionId, action.id, message);
            throw error;
          }
        }

        // Wait after executing actions so the screen has time to update
        // before the next screenshot. This ensures the AI sees the result
        // of its actions rather than a stale frame.
        const postActionDelayMs = this.getConfig().computerUse?.postActionDelayMs ?? 300;
        if (postActionDelayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, postActionDelayMs));
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.mutateSession(sessionId, (current) => ({
        ...current,
        status: 'failed',
        lastError: message,
        updatedAt: nowIso(),
      }));
      this.emitEvent({ type: 'error', sessionId, error: message });
    } finally {
      const latest = this.readSession(sessionId);
      if (getTerminalStatus(latest)) {
        closeOverlayWindow(sessionId);
        await harness.dispose(sessionId).catch(() => {});
      }
    }
  }

  async executeApprovedAction(sessionId: string, actionId: string): Promise<void> {
    const session = this.readSession(sessionId);
    if (!session) return;
    const action = session.actions.find((candidate) => candidate.id === actionId);
    if (!action) return;
    const harness = getHarness(this.getConfig(), session, this.getConfig);
    try {
      await harness.initialize(session);
      await this.executeAction(harness, { ...action, status: 'running' }, undefined, sessionId);
      this.resume(sessionId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.markActionFailed(sessionId, actionId, message);
      this.mutateSession(sessionId, (current) => ({
        ...current,
        status: 'failed',
        lastError: message,
        updatedAt: nowIso(),
      }));
      this.emitEvent({ type: 'error', sessionId, error: message });
    } finally {
      const latest = this.readSession(sessionId);
      if (getTerminalStatus(latest)) {
        closeOverlayWindow(sessionId);
        await harness.dispose(sessionId).catch(() => {});
      }
    }
  }

  private markActionFailed(sessionId: string, actionId: string, error: string): void {
    const updated = this.mutateSession(sessionId, (existing) => ({
      ...existing,
      actions: existing.actions.map((candidate) => candidate.id === actionId
        ? { ...candidate, status: 'failed' as const, error }
        : candidate),
      updatedAt: nowIso(),
    }));
    const failedAction = updated?.actions.find((candidate) => candidate.id === actionId);
    if (failedAction) {
      this.emitEvent({ type: 'action-updated', sessionId, action: failedAction });
    }
  }

  private async executeAction(
    harness: ComputerHarness,
    action: ComputerActionProposal,
    signal?: AbortSignal,
    explicitSessionId?: string,
  ): Promise<void> {
    const sessionId = explicitSessionId ?? action.sessionId;
    const session = this.readSession(sessionId);
    if (!session) return;

    // Hide the overlay before pointer-based actions so the always-on-top overlay
    // window doesn't intercept synthetic CGEvents dispatched by the macOS helper.
    // The overlay uses setIgnoreMouseEvents(true, {forward: true}) but macOS may
    // still route synthetic HID-level events to the topmost window.
    const pointerAction = action.kind === 'click' || action.kind === 'doubleClick'
      || action.kind === 'drag' || action.kind === 'movePointer' || action.kind === 'scroll';
    if (pointerAction && session.target === 'local-macos') {
      await hideOverlayForCapture(sessionId);
    }

    let result: ComputerHarnessActionResult;
    try {
      result = await (action.kind === 'navigate'
        ? harness.navigate(session, action, { signal })
        : action.kind === 'movePointer'
          ? harness.movePointer(session, action, { signal })
          : action.kind === 'click'
            ? harness.click(session, action, { signal })
            : action.kind === 'doubleClick'
              ? harness.doubleClick(session, action, { signal })
              : action.kind === 'drag'
                ? harness.drag(session, action, { signal })
                : action.kind === 'scroll'
                  ? harness.scroll(session, action, { signal })
                  : action.kind === 'typeText'
                    ? harness.typeText(session, action, { signal })
                    : action.kind === 'pressKeys'
                      ? harness.pressKeys(session, action, { signal })
                      : action.kind === 'openApp'
                        ? harness.openApp(session, action, { signal })
                        : action.kind === 'focusWindow'
                          ? harness.focusWindow(session, action, { signal })
                          : harness.waitForIdle(session, action, { signal }));
    } finally {
      // Always restore the overlay, even if the action threw
      if (pointerAction && session.target === 'local-macos') {
        showOverlayAfterCapture(sessionId);
      }
    }

    const actionDisplayIndex = action.displayIndex ?? 0;
    const cursor = result.cursor
      ? {
          x: result.cursor.x ?? this.readSession(sessionId)?.cursor?.x ?? action.endX ?? action.x ?? 0,
          y: result.cursor.y ?? this.readSession(sessionId)?.cursor?.y ?? action.endY ?? action.y ?? 0,
          visible: result.cursor.visible ?? true,
          clickedAt: action.kind === 'click' || action.kind === 'doubleClick' ? nowIso() : this.readSession(sessionId)?.cursor?.clickedAt ?? null,
          displayIndex: actionDisplayIndex,
        }
      : action.kind === 'drag' && action.endX != null && action.endY != null
        ? { x: action.endX, y: action.endY, visible: true, clickedAt: this.readSession(sessionId)?.cursor?.clickedAt ?? null, displayIndex: actionDisplayIndex }
        : action.x != null && action.y != null
          ? { x: action.x, y: action.y, visible: true, clickedAt: action.kind === 'click' || action.kind === 'doubleClick' ? nowIso() : this.readSession(sessionId)?.cursor?.clickedAt ?? null, displayIndex: actionDisplayIndex }
          : this.readSession(sessionId)?.cursor;

    const updated = this.mutateSession(sessionId, (existing) => ({
      ...existing,
      status: 'running',
      ...(cursor ? { cursor } : {}),
      ...(result.frame ? { latestFrame: result.frame } : {}),
      ...(result.environment ? { latestEnvironment: result.environment } : {}),
      lastActionAt: nowIso(),
      lastCompletedActionId: action.id,
      updatedAt: nowIso(),
      actions: existing.actions.map((candidate) => candidate.id === action.id
        ? {
            ...candidate,
            status: 'completed',
            resultSummary: result.summary,
            ...(result.cursor && (action.kind === 'movePointer' || action.kind === 'click' || action.kind === 'doubleClick' || action.kind === 'drag')
              ? {
                  resolvedX: result.cursor.x ?? candidate.resolvedX ?? candidate.endX ?? candidate.x,
                  resolvedY: result.cursor.y ?? candidate.resolvedY ?? candidate.endY ?? candidate.y,
                }
              : {}),
          }
        : candidate),
    }));
    const nextAction = updated?.actions.find((candidate) => candidate.id === action.id);
    if (nextAction) {
      this.emitEvent({ type: 'action-updated', sessionId, action: nextAction });
    }
    if (result.frame) {
      this.emitEvent({ type: 'frame', sessionId, frame: result.frame });
    }
  }
}
