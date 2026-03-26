import type {
  ComputerActionProposal,
  ComputerSession,
  ComputerUseApprovalMode,
  ComputerUseEvent,
} from '../../shared/computer-use.js';
import { makeComputerUseId, nowIso } from '../../shared/computer-use.js';
import type { LegionConfig } from '../config/schema.js';
import { resolveModelCatalog, resolveModelForThread, type ModelCatalogEntry } from '../agent/model-catalog.js';
import { anthropicPlanSession } from './provider-adapters/anthropic.js';
import { geminiPlanSession } from './provider-adapters/gemini.js';
import { openaiPlanSession } from './provider-adapters/openai.js';
import { IsolatedBrowserHarness } from './harnesses/isolated-browser.js';
import { LocalMacosHarness } from './harnesses/local-macos.js';
import type { ComputerHarness, ComputerHarnessActionResult } from './harnesses/shared.js';
import { closeOverlayWindow } from './overlay-window.js';

type SessionMutator = (sessionId: string, update: (session: ComputerSession) => ComputerSession) => ComputerSession | null;
type SessionReader = (sessionId: string) => ComputerSession | null;
type EventSink = (event: ComputerUseEvent) => void;

function getHarness(config: LegionConfig, session: ComputerSession, getConfig: () => LegionConfig): ComputerHarness {
  if (session.target === 'local-macos') return new LocalMacosHarness(getConfig);
  return new IsolatedBrowserHarness();
}

function getEntryForRole(config: LegionConfig, session: ComputerSession, role: 'planner' | 'driver' | 'verifier' | 'recovery'): ModelCatalogEntry | null {
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

function approvalRequired(mode: ComputerUseApprovalMode, action: ComputerActionProposal, config: LegionConfig): boolean {
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
    private readonly getConfig: () => LegionConfig,
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
    const config = this.getConfig();
    const harness = getHarness(config, session, this.getConfig);
    try {
      await harness.initialize(session);
      this.mutateSession(sessionId, (current) => ({ ...current, status: 'running', updatedAt: nowIso() }));

      for (let step = 0; step < 12; step += 1) {
        if (controller.signal.aborted) return;
        const current = this.readSession(sessionId);
        if (!current || current.status === 'paused' || current.status === 'stopped' || current.status === 'completed') return;

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
        const modelEntry = getEntryForRole(config, planningSession, planningRole)
          ?? getEntryForRole(config, planningSession, 'driver');
        if (!modelEntry) {
          throw new Error('No model available for computer-use session.');
        }

        if (recoveryReason) {
          this.mutateSession(sessionId, (existing) => ({
            ...existing,
            statusMessage: recoveryReason,
            updatedAt: nowIso(),
          }));
        }

        const support = modelEntry.modelConfig.provider === 'anthropic'
          ? 'anthropic-client-tool'
          : modelEntry.modelConfig.provider === 'google'
            ? 'gemini-computer-use'
            : 'openai-responses';

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
          ? await anthropicPlanSession(freshSession, modelEntry.modelConfig, planningRole, excludedApps)
          : support === 'gemini-computer-use'
            ? await geminiPlanSession(freshSession, modelEntry.modelConfig)
            : await openaiPlanSession(freshSession, modelEntry.modelConfig, planningRole, excludedApps);

        this.mutateSession(sessionId, (existing) => ({
          ...existing,
          plannerState: plan.plannerState,
          planSummary: plan.summary,
          currentSubgoal: plan.currentSubgoal,
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
      } else if (latest) {
        // Run finished without a terminal status (e.g., loop exhausted).
        // Close the overlay unless the session is in a resumable state.
        const status = (latest as ComputerSession).status;
        if (status !== 'paused' && status !== 'awaiting-approval') {
          closeOverlayWindow(sessionId);
        }
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

    const result: ComputerHarnessActionResult = await (action.kind === 'navigate'
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
