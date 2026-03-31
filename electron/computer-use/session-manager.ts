import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, BrowserWindow, Notification, screen } from 'electron';
import type {
  ComputerOverlayState,
  ComputerSession,
  ComputerUseEvent,
  ComputerUsePermissionRequestResult,
  ComputerUsePermissionSection,
  ComputerUsePermissions,
  ComputerUseSurface,
  ComputerUseTarget,
  StartComputerSessionOptions,
} from '../../shared/computer-use.js';
import { isComputerSessionTerminal, makeComputerUseId, nowIso } from '../../shared/computer-use.js';
import type { AppConfig } from '../config/schema.js';
import { resolveModelCatalog, resolveModelForThread } from '../agent/model-catalog.js';
import { ComputerUseOrchestrator } from './orchestrator.js';
import { closeOperatorWindow, openComputerSetupWindow, openOperatorWindow } from './operator-window.js';
import {
  closeOverlayWindow,
  createOverlayWindow,
  updateOverlayState,
} from './overlay-window.js';
import {
  getComputerUsePermissions,
  openLocalMacosPrivacySettings as openLocalMacosPrivacySettingsExternal,
  requestLocalMacosPermissions as requestLocalMacosPermissionsFlow,
  requestSinglePermission as requestSinglePermissionExternal,
} from './permissions.js';
import { startLocalMacosTakeoverMonitor, stopLocalMacosTakeoverMonitor, type LocalMacosTakeoverEvent } from './takeover-monitor.js';

type SessionMap = Map<string, ComputerSession>;
type SessionAlertKind = 'completed' | 'failed' | 'takeover';

const SYSTEM_SOUND_DIR = '/System/Library/Sounds';
const SESSION_ALERT_SOUND_BY_KIND: Record<SessionAlertKind, string> = {
  completed: 'Glass',
  failed: 'Basso',
  takeover: 'Ping',
};

function readActiveConversationId(appHome: string): string | null {
  const storePath = join(appHome, 'data', 'conversations.json');
  if (!existsSync(storePath)) return null;
  try {
    const store = JSON.parse(readFileSync(storePath, 'utf-8')) as {
      activeConversationId?: string | null;
    };
    return typeof store.activeConversationId === 'string' && store.activeConversationId.trim()
      ? store.activeConversationId
      : null;
  } catch {
    return null;
  }
}

function normalizeHydratedSession(session: ComputerSession): ComputerSession {
  return {
    ...session,
    actions: session.actions.map((action) => ({
      ...action,
      movementPath: action.movementPath ?? 'teleport',
    })),
  };
}

function resolveSystemSoundPath(name: string): string | null {
  for (const extension of ['aiff', 'caf', 'wav']) {
    const candidate = join(SYSTEM_SOUND_DIR, `${name}.${extension}`);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function playSessionAlertSound(kind: SessionAlertKind): void {
  const soundPath = resolveSystemSoundPath(SESSION_ALERT_SOUND_BY_KIND[kind]);
  if (!soundPath) return;
  try {
    const child = spawn('afplay', [soundPath], { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    // Ignore local notification sound failures.
  }
}

function summarizeForNotification(value: string | undefined, maxLength: number): string {
  const text = (value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length <= maxLength ? text : `${text.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function focusAnyAppWindow(): void {
  try {
    app.focus({ steal: true });
  } catch {
    app.focus();
  }
  const win = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function showSessionAlert(params: {
  kind: SessionAlertKind;
  title: string;
  subtitle: string;
  body: string;
}): void {
  playSessionAlertSound(params.kind);
  if (!Notification.isSupported()) return;
  try {
    const notification = new Notification({
      title: params.title,
      subtitle: params.subtitle,
      body: params.body,
      silent: true,
    });
    notification.on('click', () => focusAnyAppWindow());
    notification.show();
  } catch {
    // Ignore macOS notification failures and still keep the session state updated.
  }
}

function resolveSessionAlertKind(previous: ComputerSession | null, next: ComputerSession): SessionAlertKind | null {
  if (next.status === 'completed' && previous?.status !== 'completed') {
    return 'completed';
  }
  if (next.status === 'failed' && previous?.status !== 'failed') {
    return 'failed';
  }
  const pausedForTakeover = next.status === 'paused' && next.pauseReason === 'takeover';
  const wasPausedForTakeover = previous?.status === 'paused' && previous.pauseReason === 'takeover';
  if (pausedForTakeover && !wasPausedForTakeover) {
    return 'takeover';
  }
  return null;
}

function notifyForSessionTransition(previous: ComputerSession | null, next: ComputerSession): void {
  const kind = resolveSessionAlertKind(previous, next);
  if (!kind) return;

  const goal = summarizeForNotification(next.goal, 90);
  if (kind === 'completed') {
    showSessionAlert({
      kind,
      title: 'Computer Session Completed',
      subtitle: goal || 'Goal finished successfully',
      body: 'The AI completed the current computer-use task.',
    });
    return;
  }

  if (kind === 'failed') {
    showSessionAlert({
      kind,
      title: 'Computer Session Error',
      subtitle: goal || 'The session hit an error',
      body: summarizeForNotification(next.lastError ?? next.statusMessage ?? 'The computer-use session stopped because of an error.', 140) || 'The computer-use session stopped because of an error.',
    });
    return;
  }

  showSessionAlert({
    kind,
    title: 'Computer Session Paused',
    subtitle: goal || 'Human takeover detected',
    body: 'AI control paused because mouse or keyboard input came from you.',
  });
}

export class ComputerUseSessionManager extends EventEmitter {
  private readonly sessions: SessionMap = new Map();
  private readonly sessionsDir: string;
  private readonly orchestrator: ComputerUseOrchestrator;
  private takeoverMonitorActive = false;

  constructor(
    private readonly appHome: string,
    private readonly getConfig: () => AppConfig,
  ) {
    super();
    this.sessionsDir = join(appHome, 'data', 'computer-use');
    mkdirSync(this.sessionsDir, { recursive: true });
    this.orchestrator = new ComputerUseOrchestrator(
      () => this.getConfig(),
      (sessionId) => this.sessions.get(sessionId) ?? null,
      (sessionId, update) => {
        const current = this.sessions.get(sessionId);
        if (!current) return null;
        const next = update(current);
        this.sessions.set(sessionId, next);
        this.persistSession(next);
        notifyForSessionTransition(current, next);
        this.emitEvent({ type: 'session-updated', session: next });
        this.refreshTakeoverMonitor();

        // Update or close the overlay based on session state
        if (next.status === 'completed' || next.status === 'failed' || next.status === 'stopped') {
          closeOverlayWindow(sessionId);
        } else {
          this.pushOverlayState(next);
        }

        return next;
      },
      (event) => this.emitEvent(event),
    );
    this.hydrate();
    this.refreshTakeoverMonitor();
  }

  private hydrate(): void {
    if (!existsSync(this.sessionsDir)) return;
    for (const entry of readdirSync(this.sessionsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const sessionPath = join(this.sessionsDir, entry.name, 'session.json');
      if (!existsSync(sessionPath)) continue;
      try {
        const session = normalizeHydratedSession(JSON.parse(readFileSync(sessionPath, 'utf-8')) as ComputerSession);
        this.sessions.set(session.id, session);
      } catch {
        // Ignore malformed session files.
      }
    }
  }

  private sessionPath(sessionId: string): string {
    return join(this.sessionsDir, sessionId);
  }

  private persistSession(session: ComputerSession): void {
    const dir = this.sessionPath(session.id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'session.json'), JSON.stringify(session, null, 2), 'utf-8');
  }

  private emitEvent(event: ComputerUseEvent): void {
    this.emit('event', event);
  }

  private upsertSession(session: ComputerSession): ComputerSession {
    const previous = this.sessions.get(session.id) ?? null;

    // Reset completionSeen when a session newly reaches a terminal state
    // (so the sidebar indicator reappears for fresh completions)
    if (session.status === 'completed' && previous?.status !== 'completed') {
      session = { ...session, completionSeen: false };
    }

    this.sessions.set(session.id, session);
    this.persistSession(session);
    notifyForSessionTransition(previous, session);
    this.emitEvent({ type: 'session-updated', session });
    this.refreshTakeoverMonitor();

    // Update or close the overlay based on session state
    if (session.status === 'completed' || session.status === 'failed' || session.status === 'stopped') {
      closeOverlayWindow(session.id);
    } else {
      this.pushOverlayState(session);
    }

    return session;
  }

  private openOverlayIfEnabled(session: ComputerSession): void {
    const config = this.getConfig();
    if (!config.computerUse.overlay?.enabled) return;
    if (session.target !== 'local-macos') return;

    createOverlayWindow(session.id, {
      position: config.computerUse.overlay.position ?? 'top',
      heightPx: config.computerUse.overlay.heightPx ?? 120,
      opacity: config.computerUse.overlay.opacity ?? 0.75,
    }, session.displayLayout);
    this.pushOverlayState(session);
  }

  private pushOverlayState(session: ComputerSession): void {
    const config = this.getConfig();
    const catalog = resolveModelCatalog(config);
    const modelEntry = session.selectedModelKey
      ? catalog.byKey.get(session.selectedModelKey)
      : resolveModelForThread(config, null);

    const cycleTiming = this.orchestrator.getCycleTiming(session.id);

    // Get screen dimensions so the overlay can position the cursor indicator
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: screenWidth, height: screenHeight } = primaryDisplay.bounds;

    // Resolve frame dimensions for the cursor's display (may differ from primary)
    const cursorDisplayIndex = session.cursor?.displayIndex ?? 0;
    const cursorDisplayFrame = session.latestFrame?.displayFrames?.find((f) => f.displayIndex === cursorDisplayIndex);
    const cursorFrameWidth = cursorDisplayFrame?.width ?? session.latestFrame?.width;
    const cursorFrameHeight = cursorDisplayFrame?.height ?? session.latestFrame?.height;

    const state: ComputerOverlayState = {
      sessionId: session.id,
      modelDisplayName: modelEntry?.displayName ?? session.selectedModelKey ?? 'AI',
      goal: session.goal,
      currentSubgoal: session.currentSubgoal ?? session.plannerState?.subgoals[session.plannerState.activeSubgoalIndex],
      checkpoints: session.checkpoints.map((cp) => ({
        summary: cp.summary,
        complete: cp.complete,
      })),
      status: session.status,
      pauseReason: session.pauseReason,
      lastCaptureAt: cycleTiming?.lastCaptureAt,
      avgCycleDurationMs: cycleTiming?.avgCycleDurationMs,
      cursor: session.cursor,
      frameWidth: cursorFrameWidth,
      frameHeight: cursorFrameHeight,
      screenWidth,
      screenHeight,
      workAreaX: 0,
      workAreaY: 0,
      displayLayout: session.displayLayout,
      actionCount: session.actions.length,
      completedActionCount: session.actions.filter((a) => a.status === 'completed').length,
      lastActionSummary: session.actions.filter((a) => a.status === 'completed').slice(-1)[0]?.resultSummary,
      planSummary: session.planSummary,
      statusMessage: session.statusMessage,
      sessionStartedAt: session.createdAt,
    };
    updateOverlayState(session.id, state);
  }

  private buildDefaultPermissions(target: ComputerUseTarget): ComputerUsePermissions {
    return {
      target,
      accessibilityTrusted: true,
      screenRecordingGranted: true,
      automationGranted: true,
      inputMonitoringGranted: true,
      helperReady: true,
    };
  }

  private async getPermissionsForTarget(target: ComputerUseTarget, options?: {
    /** Skip the timing-dependent Input Monitoring probe (used during session start/resume). */
    skipInputMonitoringProbe?: boolean;
  }): Promise<ComputerUsePermissions> {
    if (target === 'local-macos') {
      return getComputerUsePermissions({
        probeInputMonitoring: !options?.skipInputMonitoringProbe,
      });
    }

    return this.buildDefaultPermissions(target);
  }

  private getPreflightBlocker(target: ComputerUseTarget, permissions: ComputerUsePermissions): string | null {
    if (target === 'local-macos') {
      const missing: string[] = [];
      if (!permissions.helperReady) {
        missing.push(permissions.message ?? 'Local macOS helper could not start. Ensure Xcode command line tools are installed.');
      }
      if (!permissions.accessibilityTrusted) {
        missing.push('Enable Accessibility for ' + __BRAND_PRODUCT_NAME + ' in System Settings > Privacy & Security > Accessibility.');
      }
      if (!permissions.screenRecordingGranted) {
        missing.push('Enable Screen Recording for ' + __BRAND_PRODUCT_NAME + ' in System Settings > Privacy & Security > Screen Recording.');
      }
      if (!permissions.automationGranted) {
        missing.push('Allow Automation for ' + __BRAND_PRODUCT_NAME + ' so it can drive System Events and read focused window metadata.');
      }
      if (!permissions.inputMonitoringGranted) {
        missing.push('Enable Input Monitoring for ' + __BRAND_PRODUCT_NAME + ' in System Settings > Privacy & Security > Input Monitoring so it can detect when you take over control.');
      }
      return missing.length > 0 ? missing.join(' ') : null;
    }

    return null;
  }

  private firstMissingLocalMacPermission(permissions: ComputerUsePermissions): ComputerUsePermissionSection | null {
    if (!permissions.accessibilityTrusted) return 'accessibility';
    if (!permissions.screenRecordingGranted) return 'screen-recording';
    if (!permissions.automationGranted) return 'automation';
    if (!permissions.inputMonitoringGranted) return 'input-monitoring';
    return null;
  }

  private async syncLocalMacPermissionState(result: ComputerUsePermissionRequestResult): Promise<void> {
    const blocker = this.getPreflightBlocker('local-macos', result.permissions);
    const timestamp = nowIso();

    for (const session of this.sessions.values()) {
      if (session.target !== 'local-macos') continue;
      const wasBlockedByPermissions = session.pauseReason === 'permissions' || (session.status === 'failed' && session.permissionState?.target === 'local-macos');
      const nextStatus = !blocker && wasBlockedByPermissions && session.status === 'failed'
        ? 'paused'
        : session.status;
      const nextPauseReason = !blocker && wasBlockedByPermissions
        ? 'user'
        : blocker
          ? 'permissions'
          : session.pauseReason;
      const nextStatusMessage = wasBlockedByPermissions
        ? (blocker ?? 'Permissions look ready. Resume when you are ready to continue.')
        : session.statusMessage;
      const nextLastError = wasBlockedByPermissions
        ? blocker ?? undefined
        : session.lastError;

      this.upsertSession({
        ...session,
        status: nextStatus,
        permissionState: blocker ? { ...result.permissions, message: blocker } : result.permissions,
        pauseReason: nextPauseReason,
        statusMessage: nextStatusMessage,
        lastError: nextLastError,
        updatedAt: timestamp,
      });
    }
  }

  async requestLocalMacosPermissions(): Promise<ComputerUsePermissionRequestResult> {
    const result = await requestLocalMacosPermissionsFlow({
      openSettings: this.getConfig().computerUse.localMacos.autoOpenPrivacySettings,
    });
    await this.syncLocalMacPermissionState(result);
    return result;
  }

  async requestSingleLocalMacosPermission(section: ComputerUsePermissionSection): Promise<ComputerUsePermissions> {
    const openSettings = this.getConfig().computerUse.localMacos.autoOpenPrivacySettings;
    return requestSinglePermissionExternal(section, { openSettings });
  }

  async getLocalMacosPermissions(): Promise<ComputerUsePermissions> {
    return getComputerUsePermissions();
  }

  async openLocalMacosPrivacySettings(section?: ComputerUsePermissionSection): Promise<{ opened: ComputerUsePermissionSection | null }> {
    const permissions = await getComputerUsePermissions();
    const targetSection = section ?? this.firstMissingLocalMacPermission(permissions) ?? 'accessibility';
    await openLocalMacosPrivacySettingsExternal(targetSection);
    return { opened: targetSection };
  }

  private async evaluatePreflight(
    target: ComputerUseTarget,
    options?: { requestMissing?: boolean },
  ): Promise<{ permissions: ComputerUsePermissions; blocker: string | null }> {
    // Skip the timing-dependent Input Monitoring probe during automated preflight.
    // The probe requires the user to be actively moving the mouse/keyboard within
    // a 3-second window, which almost never happens at session start (the user is
    // idle waiting). The interactive setup UI calls getLocalMacosPermissions()
    // separately with the probe enabled where the user is prompted to move their
    // mouse. At this stage we trust that if Accessibility is granted, the
    // listenOnly event tap used by the takeover monitor will work.
    let permissions = await this.getPermissionsForTarget(target, { skipInputMonitoringProbe: true });
    let blocker = this.getPreflightBlocker(target, permissions);

    if (target === 'local-macos' && blocker && options?.requestMissing && this.getConfig().computerUse.localMacos.autoRequestPermissions) {
      const requestResult = await requestLocalMacosPermissionsFlow({
        openSettings: this.getConfig().computerUse.localMacos.autoOpenPrivacySettings,
      });
      permissions = requestResult.permissions;
      blocker = this.getPreflightBlocker(target, permissions);
      if (blocker && requestResult.message) {
        blocker = `${blocker} ${requestResult.message}`.trim();
      }
    }

    return { permissions, blocker };
  }

  private shouldRunTakeoverMonitor(): boolean {
    if (!this.getConfig().computerUse.safety.manualTakeoverPauses) return false;
    for (const session of this.sessions.values()) {
      if (session.target !== 'local-macos') continue;
      if (session.status === 'stopped' || session.status === 'completed' || session.status === 'failed') continue;
      return true;
    }
    return false;
  }

  private refreshTakeoverMonitor(): void {
    if (this.shouldRunTakeoverMonitor()) {
      if (!this.takeoverMonitorActive) {
        startLocalMacosTakeoverMonitor({
          onEvent: (event) => this.handleTakeoverEvent(event),
          onError: (message) => console.warn('[Computer Use] takeover monitor:', message),
        });
        this.takeoverMonitorActive = true;
      }
      return;
    }

    if (this.takeoverMonitorActive) {
      stopLocalMacosTakeoverMonitor();
      this.takeoverMonitorActive = false;
    }
  }

  private handleTakeoverEvent(event: LocalMacosTakeoverEvent): void {
    if (!this.getConfig().computerUse.safety.manualTakeoverPauses) return;
    const timestamp = nowIso();
    const message = event.eventType.startsWith('key')
      ? 'Human in control. Session paused after keyboard activity.'
      : 'Human in control. Session paused after mouse activity.';

    for (const session of this.sessions.values()) {
      if (session.target !== 'local-macos' || session.status !== 'running') continue;
      this.orchestrator.pause(session.id);
      this.upsertSession({
        ...session,
        status: 'paused',
        humanInControl: true,
        pauseReason: 'takeover',
        statusMessage: message,
        updatedAt: timestamp,
      });
    }
  }

  private handleOperatorWindowClosed(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.status === 'stopped') return;
    if (!session.operatorWindowOpen && session.surface !== 'window') return;
    this.upsertSession({
      ...session,
      surface: session.surface === 'window' ? 'docked' : session.surface,
      operatorWindowOpen: false,
      updatedAt: nowIso(),
    });
  }

  listSessions(): ComputerSession[] {
    return Array.from(this.sessions.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  getSession(sessionId: string): ComputerSession | null {
    return this.sessions.get(sessionId) ?? null;
  }

  openSetupWindow(conversationId?: string | null): void {
    openComputerSetupWindow(conversationId);
  }

  async startSession(goal: string, options: StartComputerSessionOptions): Promise<ComputerSession> {
    const config = this.getConfig();
    const sessionId = makeComputerUseId('cs');
    const conversationId = options.conversationId.trim().toLowerCase() === 'current'
      ? readActiveConversationId(this.appHome) ?? options.conversationId
      : options.conversationId;
    const target = options.target ?? config.computerUse.defaultTarget;
    const surface = options.surface ?? config.computerUse.defaultSurface;
    const approvalMode = options.approvalMode ?? config.computerUse.approvalModeDefault;

    // Singleton guard: only one local-macos session can run at a time
    // Paused sessions don't block new ones — user may want to start fresh
    if (target === 'local-macos') {
      for (const existing of this.sessions.values()) {
        if (
          existing.target === 'local-macos'
          && existing.status !== 'completed'
          && existing.status !== 'stopped'
          && existing.status !== 'failed'
          && existing.status !== 'paused'
        ) {
          throw new Error(`A local Mac session is already active (${existing.id}). Stop it before starting a new one.`);
        }
      }
    }

    const { permissions, blocker } = await this.evaluatePreflight(target, { requestMissing: true });

    const session: ComputerSession = {
      id: sessionId,
      conversationId,
      goal,
      conversationContext: options.contextSummary?.trim() || undefined,
      target,
      surface,
      approvalMode,
      selectedModelKey: options.modelKey ?? null,
      selectedProfileKey: options.profileKey ?? null,
      fallbackEnabled: options.fallbackEnabled ?? false,
      reasoningEffort: options.reasoningEffort ?? undefined,
      status: blocker ? 'failed' : 'starting',
      providerAdapter: 'hybrid',
      createdAt: nowIso(),
      updatedAt: nowIso(),
      actions: [],
      approvals: [],
      checkpoints: [],
      guidanceMessages: [],
      permissionState: blocker ? { ...permissions, message: blocker } : permissions,
      cursor: { x: 0, y: 0, visible: false, clickedAt: null },
      operatorWindowOpen: !blocker && surface === 'window',
      humanInControl: false,
      pauseReason: blocker ? 'permissions' : undefined,
      statusMessage: blocker ?? undefined,
      lastError: blocker ?? undefined,
    };

    this.upsertSession(session);
    if (!blocker && surface === 'window') {
      openOperatorWindow(session.id, () => this.handleOperatorWindowClosed(session.id), {
        conversationId: session.conversationId,
      });
    }
    if (!blocker) {
      this.openOverlayIfEnabled(session);
      this.orchestrator.resume(session.id);
    }
    return session;
  }

  pauseSession(sessionId: string): ComputerSession | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    this.orchestrator.pause(sessionId);
    return this.upsertSession({
      ...session,
      status: 'paused',
      humanInControl: false,
      pauseReason: 'user',
      statusMessage: 'Paused by user.',
      updatedAt: nowIso(),
    });
  }

  async resumeSession(sessionId: string): Promise<ComputerSession | null> {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    const { permissions, blocker } = await this.evaluatePreflight(session.target, { requestMissing: true });
    if (blocker) {
      return this.upsertSession({
        ...session,
        status: 'failed',
        permissionState: { ...permissions, message: blocker },
        humanInControl: false,
        pauseReason: 'permissions',
        statusMessage: blocker,
        lastError: blocker,
        updatedAt: nowIso(),
      });
    }

    const next = this.upsertSession({
      ...session,
      status: 'running',
      permissionState: permissions,
      humanInControl: false,
      pauseReason: undefined,
      statusMessage: undefined,
      lastError: undefined,
      updatedAt: nowIso(),
    });
    this.openOverlayIfEnabled(next);
    this.orchestrator.resume(sessionId);
    return next;
  }

  stopSession(sessionId: string): ComputerSession | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    this.orchestrator.stop(sessionId);
    closeOperatorWindow(sessionId);
    closeOverlayWindow(sessionId);
    const next = this.upsertSession({
      ...session,
      status: 'stopped',
      updatedAt: nowIso(),
      operatorWindowOpen: false,
      humanInControl: false,
      pauseReason: undefined,
      statusMessage: undefined,
    });
    void this.orchestrator.cleanupSession(sessionId);
    return next;
  }

  updateSessionSettings(sessionId: string, settings: {
    modelKey?: string | null;
    profileKey?: string | null;
    fallbackEnabled?: boolean;
    reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh';
  }): ComputerSession | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    // Don't update terminal sessions
    if (session.status === 'completed' || session.status === 'stopped' || session.status === 'failed') return null;

    return this.upsertSession({
      ...session,
      ...(settings.modelKey !== undefined ? { selectedModelKey: settings.modelKey } : {}),
      ...(settings.profileKey !== undefined ? { selectedProfileKey: settings.profileKey } : {}),
      ...(settings.fallbackEnabled !== undefined ? { fallbackEnabled: settings.fallbackEnabled } : {}),
      ...(settings.reasoningEffort !== undefined ? { reasoningEffort: settings.reasoningEffort } : {}),
      updatedAt: nowIso(),
    });
  }

  async sendGuidance(sessionId: string, text: string): Promise<ComputerSession | null> {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    // Don't accept guidance for terminal sessions
    if (session.status === 'completed' || session.status === 'stopped' || session.status === 'failed') return null;

    const wasPaused = session.status === 'paused';

    const message = {
      id: makeComputerUseId('guide'),
      text: text.trim(),
      createdAt: nowIso(),
    };

    const next = this.upsertSession({
      ...session,
      guidanceMessages: [...(session.guidanceMessages ?? []), message],
      updatedAt: nowIso(),
    });
    this.emitEvent({ type: 'guidance-sent', sessionId, message });

    // Auto-resume if the session was paused so the guidance gets consumed
    if (wasPaused) {
      await this.resumeSession(sessionId);
    }

    return this.sessions.get(sessionId) ?? next;
  }

  /**
   * Continue a completed/stopped/failed session with a new goal.
   * Preserves all existing actions, checkpoints, guidance, and frames.
   * The new goal is appended to the original, and execution resumes.
   */
  async continueSession(sessionId: string, newGoal: string): Promise<ComputerSession | null> {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    if (!isComputerSessionTerminal(session.status)) return null; // only terminal sessions can be continued

    const target = session.target;

    // Re-check permissions for local-macos
    const { permissions, blocker } = target === 'local-macos'
      ? await this.evaluatePreflight(target, { requestMissing: true })
      : { permissions: session.permissionState, blocker: null as string | null };

    if (blocker) {
      return this.upsertSession({
        ...session,
        status: 'failed',
        permissionState: permissions ? { ...permissions, message: blocker } : session.permissionState,
        lastError: blocker,
        statusMessage: blocker,
        updatedAt: nowIso(),
      });
    }

    // Append the new goal to the original
    const continuedGoal = `${session.goal}\n\nFollow-up: ${newGoal.trim()}`;

    // Add a guidance message so the orchestrator sees the new instruction
    const guidanceMessage = {
      id: makeComputerUseId('guide'),
      text: newGoal.trim(),
      createdAt: nowIso(),
    };

    const next = this.upsertSession({
      ...session,
      goal: continuedGoal,
      status: 'running',
      lastError: undefined,
      statusMessage: undefined,
      pauseReason: undefined,
      humanInControl: false,
      guidanceMessages: [...(session.guidanceMessages ?? []), guidanceMessage],
      updatedAt: nowIso(),
      ...(permissions ? { permissionState: permissions } : {}),
    });

    this.openOverlayIfEnabled(next);
    this.orchestrator.resume(sessionId);
    return next;
  }

  async approveAction(sessionId: string, actionId: string): Promise<ComputerSession | null> {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    const next: ComputerSession = {
      ...session,
      approvals: session.approvals.map((approval) => approval.actionId === actionId ? { ...approval, status: 'approved' as const } : approval),
      actions: session.actions.map((action) => action.id === actionId ? { ...action, status: 'approved' as const } : action),
      status: 'running',
      humanInControl: false,
      pauseReason: undefined,
      statusMessage: undefined,
      updatedAt: nowIso(),
    };
    this.upsertSession(next);
    await this.orchestrator.executeApprovedAction(sessionId, actionId);
    return this.sessions.get(sessionId) ?? null;
  }

  rejectAction(sessionId: string, actionId: string, reason?: string): ComputerSession | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    return this.upsertSession({
      ...session,
      approvals: session.approvals.map((approval) => approval.actionId === actionId ? { ...approval, status: 'rejected' as const, rationale: reason ?? approval.rationale } : approval),
      actions: session.actions.map((action) => action.id === actionId ? { ...action, status: 'rejected' as const, error: reason ?? 'Rejected by user' } : action),
      status: 'paused',
      humanInControl: false,
      pauseReason: 'approval',
      statusMessage: reason ?? 'Action rejected by user.',
      updatedAt: nowIso(),
    });
  }

  setSurface(sessionId: string, surface: ComputerUseSurface): ComputerSession | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    if (surface === 'window') {
      openOperatorWindow(sessionId, () => this.handleOperatorWindowClosed(sessionId), {
        conversationId: session.conversationId,
      });
    } else {
      closeOperatorWindow(sessionId);
    }
    return this.upsertSession({
      ...session,
      surface,
      operatorWindowOpen: surface === 'window',
      updatedAt: nowIso(),
    });
  }

  removeSession(sessionId: string): void {
    this.stopSession(sessionId);
    this.sessions.delete(sessionId);
    rmSync(this.sessionPath(sessionId), { recursive: true, force: true });
    this.emitEvent({ type: 'session-removed', sessionId });
    this.refreshTakeoverMonitor();
  }

  /** Remove all sessions associated with a conversation (used when deleting a conversation). */
  removeSessionsByConversation(conversationId: string): void {
    const toRemove: string[] = [];
    for (const session of this.sessions.values()) {
      if (session.conversationId === conversationId) {
        toRemove.push(session.id);
      }
    }
    for (const sessionId of toRemove) {
      this.removeSession(sessionId);
    }
  }

  /** Mark a session's completion as seen (clears the sidebar notification dot). */
  markCompletionSeen(sessionId: string): ComputerSession | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    if (session.completionSeen) return session;
    return this.upsertSession({ ...session, completionSeen: true, updatedAt: nowIso() });
  }

  /** Mark all completed sessions for a conversation as seen. */
  markConversationSessionsSeen(conversationId: string): void {
    for (const session of this.sessions.values()) {
      if (session.conversationId === conversationId && session.status === 'completed' && !session.completionSeen) {
        this.upsertSession({ ...session, completionSeen: true, updatedAt: nowIso() });
      }
    }
  }
}
