export type ComputerUseSurface = 'docked' | 'window';

export type ComputerUseTarget = 'isolated-browser' | 'local-macos';

export type ComputerUseApprovalMode = 'step' | 'goal' | 'autonomous';

export type ComputerUsePermissionSection = 'accessibility' | 'screen-recording' | 'automation' | 'input-monitoring';

export type ComputerUseSupport =
  | 'openai-responses'
  | 'anthropic-client-tool'
  | 'gemini-computer-use'
  | 'custom'
  | 'none';

export type ComputerUseActionKind =
  | 'navigate'
  | 'movePointer'
  | 'click'
  | 'doubleClick'
  | 'drag'
  | 'scroll'
  | 'typeText'
  | 'pressKeys'
  | 'wait'
  | 'openApp'
  | 'focusWindow';

export type ComputerUseActionRisk = 'low' | 'medium' | 'high';

export type ComputerUseMovementPath = 'teleport' | 'direct' | 'horizontal-first' | 'vertical-first';

export type ComputerUseActionStatus =
  | 'proposed'
  | 'awaiting-approval'
  | 'approved'
  | 'rejected'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type ComputerUseSessionStatus =
  | 'starting'
  | 'running'
  | 'paused'
  | 'awaiting-approval'
  | 'completed'
  | 'failed'
  | 'stopped';

export type ComputerUseRole = 'planner' | 'driver' | 'verifier' | 'recovery';

export type ComputerUsePauseReason = 'user' | 'approval' | 'takeover' | 'permissions' | 'safety' | 'system';

export type ComputerUseCursorState = {
  x: number;
  y: number;
  visible: boolean;
  clickedAt?: string | null;
  /** Which display the cursor is on (0-indexed). Coordinates are relative to this display's frame. */
  displayIndex?: number;
};

export type ComputerDisplayInfo = {
  /** macOS CGDirectDisplayID as string */
  displayId: string;
  /** Display name (e.g., "Built-in Retina Display") */
  name: string;
  /** Pixel dimensions (for screenshot image coordinates) */
  pixelWidth: number;
  pixelHeight: number;
  /** Logical point dimensions (for macOS CGEvent mouse positioning) */
  logicalWidth: number;
  logicalHeight: number;
  /** Position in macOS global coordinate space (logical points) */
  globalX: number;
  globalY: number;
  /** Retina scale factor */
  scaleFactor: number;
  /** Whether this is the primary/main display */
  isPrimary: boolean;
  /** Index in the sorted display list (0-based) */
  displayIndex: number;
};

export type ComputerDisplayLayout = {
  displays: ComputerDisplayInfo[];
};

export type ComputerInteractiveElement = {
  id: string;
  selector?: string;
  role?: string;
  label?: string;
  text?: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ComputerFrame = {
  id: string;
  sessionId: string;
  createdAt: string;
  mimeType: string;
  dataUrl: string;
  width: number;
  height: number;
  source: ComputerUseTarget;
  summary?: string;
  diffScore?: number;
  /** Display layout metadata when captured from multiple displays */
  displayLayout?: ComputerDisplayLayout;
  /** Per-display screenshots (base64 data URLs) indexed by display position */
  displayFrames?: Array<{
    displayIndex: number;
    displayName: string;
    dataUrl: string;
    width: number;
    height: number;
  }>;
};

export type ComputerEnvironmentMetadata = {
  url?: string;
  title?: string;
  appName?: string;
  windowTitle?: string;
  scrollX?: number;
  scrollY?: number;
  visibleText?: string;
  interactiveElements?: ComputerInteractiveElement[];
  permissionState?: Partial<Record<'accessibility' | 'screenRecording' | 'automation', boolean>>;
};

export type ComputerActionProposal = {
  id: string;
  sessionId: string;
  createdAt: string;
  role: ComputerUseRole;
  kind: ComputerUseActionKind;
  status: ComputerUseActionStatus;
  rationale: string;
  risk: ComputerUseActionRisk;
  requiresApproval: boolean;
  selector?: string;
  elementId?: string;
  x?: number;
  y?: number;
  resolvedX?: number;
  resolvedY?: number;
  endX?: number;
  endY?: number;
  url?: string;
  text?: string;
  keys?: string[];
  deltaX?: number;
  deltaY?: number;
  appName?: string;
  waitMs?: number;
  movementPath: ComputerUseMovementPath;
  /** Which display the action targets (0-indexed). When omitted, defaults to primary (0). */
  displayIndex?: number;
  resultSummary?: string;
  error?: string;
};

export type ComputerApprovalRequest = {
  id: string;
  sessionId: string;
  actionId: string;
  createdAt: string;
  status: 'pending' | 'approved' | 'rejected';
  prompt: string;
  rationale: string;
};

export type ComputerCheckpoint = {
  id: string;
  sessionId: string;
  createdAt: string;
  summary: string;
  successCriteria: string[];
  activeSubgoal?: string;
  complete: boolean;
};

export type ComputerPlannerState = {
  summary: string;
  subgoals: string[];
  successCriteria: string[];
  activeSubgoalIndex: number;
};

export type ComputerUsePermissions = {
  target: ComputerUseTarget;
  accessibilityTrusted: boolean;
  screenRecordingGranted: boolean;
  automationGranted: boolean;
  /** Whether Input Monitoring permission is granted (required for the takeover monitor event tap). */
  inputMonitoringGranted: boolean;
  helperReady: boolean;
  message?: string;
};

export type ComputerUsePermissionRequestResult = {
  permissions: ComputerUsePermissions;
  requested: ComputerUsePermissionSection[];
  openedSettings: ComputerUsePermissionSection[];
  message?: string;
};

export type ComputerGuidanceMessage = {
  id: string;
  text: string;
  createdAt: string;
  /** Set by the orchestrator when the message is consumed in a planning cycle. */
  injectedAt?: string;
};

export type ComputerSession = {
  id: string;
  conversationId: string;
  goal: string;
  target: ComputerUseTarget;
  surface: ComputerUseSurface;
  approvalMode: ComputerUseApprovalMode;
  selectedModelKey: string | null;
  selectedProfileKey?: string | null;
  fallbackEnabled?: boolean;
  reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh';
  status: ComputerUseSessionStatus;
  providerAdapter: string;
  createdAt: string;
  updatedAt: string;
  currentSubgoal?: string;
  planSummary?: string;
  conversationContext?: string;
  plannerState?: ComputerPlannerState;
  latestFrame?: ComputerFrame;
  latestEnvironment?: ComputerEnvironmentMetadata;
  cursor?: ComputerUseCursorState;
  actions: ComputerActionProposal[];
  approvals: ComputerApprovalRequest[];
  checkpoints: ComputerCheckpoint[];
  lastError?: string;
  lastActionAt?: string;
  lastCompletedActionId?: string;
  operatorWindowOpen?: boolean;
  permissionState?: ComputerUsePermissions;
  humanInControl?: boolean;
  pauseReason?: ComputerUsePauseReason;
  statusMessage?: string;
  guidanceMessages: ComputerGuidanceMessage[];
  /** Whether the user has viewed the completed session (clears the sidebar indicator) */
  completionSeen?: boolean;
  /** Current multi-display layout (populated from frame capture) */
  displayLayout?: ComputerDisplayLayout;
};

export type ComputerOverlayState = {
  sessionId: string;
  modelDisplayName: string;
  goal: string;
  currentSubgoal?: string;
  checkpoints: Array<{ summary: string; complete: boolean }>;
  status: ComputerUseSessionStatus;
  pauseReason?: ComputerUsePauseReason;
  lastCaptureAt?: string;
  avgCycleDurationMs?: number;
  cursor?: ComputerUseCursorState;
  /** Frame dimensions (screenshot image size) for cursor coordinate mapping. */
  frameWidth?: number;
  frameHeight?: number;
  /** Full screen dimensions so the overlay can map cursor coords to screen position. */
  screenWidth?: number;
  screenHeight?: number;
  /** Work area origin — offset from display origin to account for menu bar and dock. */
  workAreaX?: number;
  workAreaY?: number;
  /** Multi-display layout for cursor positioning across monitors */
  displayLayout?: ComputerDisplayLayout;
  /** Which display this overlay window covers (set per-overlay-window) */
  overlayDisplayId?: string;
  /** Total number of actions taken so far */
  actionCount?: number;
  /** Number of completed actions */
  completedActionCount?: number;
  /** Summary of the last completed action */
  lastActionSummary?: string;
  /** High-level plan summary from the planner */
  planSummary?: string;
  /** Status message (e.g. recovery reason, error context) */
  statusMessage?: string;
  /** Session start time ISO string for elapsed timer */
  sessionStartedAt?: string;
};

export type StartComputerSessionOptions = {
  conversationId: string;
  target?: ComputerUseTarget;
  surface?: ComputerUseSurface;
  approvalMode?: ComputerUseApprovalMode;
  modelKey?: string | null;
  profileKey?: string | null;
  fallbackEnabled?: boolean;
  reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh';
  contextSummary?: string;
};

export type ComputerUseEvent =
  | { type: 'session-updated'; session: ComputerSession }
  | { type: 'frame'; sessionId: string; frame: ComputerFrame }
  | { type: 'action-updated'; sessionId: string; action: ComputerActionProposal }
  | { type: 'approval-requested'; sessionId: string; approval: ComputerApprovalRequest }
  | { type: 'checkpoint'; sessionId: string; checkpoint: ComputerCheckpoint }
  | { type: 'guidance-sent'; sessionId: string; message: ComputerGuidanceMessage }
  | { type: 'session-removed'; sessionId: string }
  | { type: 'error'; sessionId: string; error: string }
  | { type: 'model-fallback'; sessionId: string; fromModel: string; toModel: string; toModelKey: string; error: string }
  | { type: 'overlay-state'; state: ComputerOverlayState };

export function supportsComputerUse(support?: ComputerUseSupport | null): boolean {
  return Boolean(support && support !== 'none');
}

export function isRiskyAction(kind: ComputerUseActionKind): boolean {
  return kind === 'openApp'
    || kind === 'focusWindow'
    || kind === 'pressKeys'
    || kind === 'typeText'
    || kind === 'drag';
}

export function isComputerSessionTerminal(status: ComputerUseSessionStatus): boolean {
  return status === 'completed'
    || status === 'failed'
    || status === 'stopped';
}

export function shouldShowComputerSetup(session?: Pick<ComputerSession, 'status'> | null): boolean {
  return !session || isComputerSessionTerminal(session.status);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function makeComputerUseId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
