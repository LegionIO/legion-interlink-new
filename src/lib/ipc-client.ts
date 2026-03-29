// Type-safe wrapper for the Electron IPC bridge exposed via preload
// window.legion is set by electron/preload.ts via contextBridge

import type {
  ComputerUseEvent,
  ComputerUsePermissions,
  ComputerUsePermissionRequestResult,
  ComputerUsePermissionSection,
  ComputerUseSurface,
} from '../../shared/computer-use';

type DaemonResult<T = unknown> = { ok: boolean; data?: T; error?: string };

type LegionAPI = {
  config: {
    get: () => Promise<unknown>;
    set: (path: string, value: unknown) => Promise<unknown>;
    autoDetectRuntime: () => Promise<unknown>;
    onChanged: (callback: (config: unknown) => void) => () => void;
  };
  agent: {
    stream: (conversationId: string, messages: unknown[], modelKey?: string, reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh', profileKey?: string, fallbackEnabled?: boolean) => Promise<unknown>;
    cancelStream: (conversationId: string) => Promise<unknown>;
    generateTitle: (messages: unknown[], modelKey?: string) => Promise<{ title: string | null }>;
    legionStatus: () => Promise<unknown>;
    onStreamEvent: (callback: (event: unknown) => void) => () => void;
    sendSubAgentMessage: (subAgentConversationId: string, message: string) => Promise<{ ok: boolean }>;
    stopSubAgent: (subAgentConversationId: string) => Promise<{ ok: boolean }>;
    listSubAgents: () => Promise<{ ids: string[] }>;
  };
  conversations: {
    list: () => Promise<unknown[]>;
    get: (id: string) => Promise<unknown>;
    put: (conversation: unknown) => Promise<unknown>;
    delete: (id: string) => Promise<unknown>;
    clear: () => Promise<unknown>;
    getActiveId: () => Promise<string | null>;
    setActiveId: (id: string) => Promise<unknown>;
    onChanged: (callback: (store: unknown) => void) => () => void;
  };
  daemon: {
    settings: () => Promise<{ ok: boolean; settings?: Record<string, unknown>; error?: string }>;
    settingsUpdate: (key: string, value: unknown) => Promise<{ ok: boolean; error?: string }>;
    catalog: () => Promise<DaemonResult>;
    extensions: () => Promise<DaemonResult>;
    extension: (id: string) => Promise<DaemonResult>;
    extensionRunners: (id: string) => Promise<DaemonResult>;
    tasks: (filters?: Record<string, string>) => Promise<DaemonResult>;
    task: (id: string) => Promise<DaemonResult>;
    taskLogs: (id: string) => Promise<DaemonResult>;
    taskCreate: (body: unknown) => Promise<DaemonResult>;
    taskDelete: (id: string) => Promise<DaemonResult>;
    taskGraph: (filters?: Record<string, string>) => Promise<DaemonResult>;
    workers: (filters?: Record<string, string>) => Promise<DaemonResult>;
    worker: (id: string) => Promise<DaemonResult>;
    workerHealth: (id: string) => Promise<DaemonResult>;
    workerCosts: (id: string) => Promise<DaemonResult>;
    workerLifecycle: (id: string, body: unknown) => Promise<DaemonResult>;
    schedules: () => Promise<DaemonResult>;
    schedule: (id: string) => Promise<DaemonResult>;
    scheduleCreate: (body: unknown) => Promise<DaemonResult>;
    scheduleUpdate: (id: string, body: unknown) => Promise<DaemonResult>;
    scheduleDelete: (id: string) => Promise<DaemonResult>;
    audit: (filters?: Record<string, string>) => Promise<DaemonResult>;
    auditVerify: () => Promise<DaemonResult>;
    transport: () => Promise<DaemonResult>;
    transportExchanges: () => Promise<DaemonResult>;
    transportQueues: () => Promise<DaemonResult>;
    transportPublish: (body: unknown) => Promise<DaemonResult>;
    prompts: () => Promise<DaemonResult>;
    prompt: (name: string) => Promise<DaemonResult>;
    promptRun: (name: string, body: unknown) => Promise<DaemonResult>;
    webhooks: () => Promise<DaemonResult>;
    webhookCreate: (body: unknown) => Promise<DaemonResult>;
    webhookDelete: (id: string) => Promise<DaemonResult>;
    tenants: () => Promise<DaemonResult>;
    tenant: (id: string) => Promise<DaemonResult>;
    capacity: () => Promise<DaemonResult>;
    capacityForecast: (params?: Record<string, string>) => Promise<DaemonResult>;
    governanceApprovals: (filters?: Record<string, string>) => Promise<DaemonResult>;
    governanceApprove: (id: string, body: unknown) => Promise<DaemonResult>;
    governanceReject: (id: string, body: unknown) => Promise<DaemonResult>;
    rbacRoles: () => Promise<DaemonResult>;
    rbacAssignments: (filters?: Record<string, string>) => Promise<DaemonResult>;
    rbacCheck: (body: unknown) => Promise<DaemonResult>;
    nodes: () => Promise<DaemonResult>;
    eventsSubscribe: () => Promise<DaemonResult>;
    eventsUnsubscribe: () => Promise<DaemonResult>;
    eventsRecent: (count?: number) => Promise<DaemonResult>;
    onEvent: (callback: (event: unknown) => void) => () => void;
    subAgentCreate: (body: { message: string; model?: string; parent_conversation_id?: string }) => Promise<DaemonResult>;
    subAgentStatus: (taskId: string) => Promise<DaemonResult>;
    doCommand: (input: string) => Promise<DaemonResult>;
    capabilities: () => Promise<DaemonResult>;
    memoryEntries: (filters?: Record<string, string>) => Promise<DaemonResult>;
    memoryEntry: (id: string) => Promise<DaemonResult>;
    memoryEntryUpdate: (id: string, body: unknown) => Promise<DaemonResult>;
    memoryEntryDelete: (id: string) => Promise<DaemonResult>;
    memoryStats: () => Promise<DaemonResult>;
    marketplace: (filters?: Record<string, string>) => Promise<DaemonResult>;
    extensionInstall: (id: string) => Promise<DaemonResult>;
    extensionUninstall: (id: string) => Promise<DaemonResult>;
    extensionEnable: (id: string) => Promise<DaemonResult>;
    extensionDisable: (id: string) => Promise<DaemonResult>;
    extensionConfig: (id: string) => Promise<DaemonResult>;
    extensionConfigUpdate: (id: string, body: unknown) => Promise<DaemonResult>;
    githubStatus: () => Promise<DaemonResult>;
    githubRepos: () => Promise<DaemonResult>;
    githubPulls: (filters?: Record<string, string>) => Promise<DaemonResult>;
    githubPull: (repo: string, number: number) => Promise<DaemonResult>;
    githubIssues: (filters?: Record<string, string>) => Promise<DaemonResult>;
    githubCommits: (filters?: Record<string, string>) => Promise<DaemonResult>;
    gaiaStatus: () => Promise<DaemonResult>;
    gaiaEvents: (filters?: { limit?: string }) => Promise<DaemonResult>;
    metering: (filters?: Record<string, string>) => Promise<DaemonResult>;
    meteringRollup: (filters?: Record<string, string>) => Promise<DaemonResult>;
    meteringByModel: (filters?: Record<string, string>) => Promise<DaemonResult>;
    meshStatus: () => Promise<DaemonResult>;
    meshPeers: () => Promise<DaemonResult>;
    absorbers: () => Promise<DaemonResult>;
    absorberResolve: (input: string) => Promise<DaemonResult>;
    absorberDispatch: (input: string, scope?: string) => Promise<DaemonResult>;
    absorberJob: (jobId: string) => Promise<DaemonResult>;
    health: () => Promise<DaemonResult>;
    ready: () => Promise<DaemonResult>;
    metrics: () => Promise<DaemonResult>;
    doctor: () => Promise<DaemonResult>;
  };
  memory: {
    clear: (options: { working?: boolean; observational?: boolean; semantic?: boolean; all?: boolean }) =>
      Promise<{ success?: boolean; cleared?: string[]; error?: string }>;
    testEmbedding: () =>
      Promise<{ ok?: boolean; model?: string; dimensions?: number; error?: string }>;
  };
  mcp: {
    testConnection: (server: { name: string; url?: string; command?: string; args?: string[]; env?: Record<string, string> }) =>
      Promise<{ status: string; toolCount: number; error?: string }>;
  };
  skills: {
    list: () => Promise<Array<{
      name: string;
      description: string;
      version?: string;
      type: string;
      enabled: boolean;
      dir: string;
    }>>;
    get: (name: string) => Promise<{
      manifest?: Record<string, unknown>;
      files?: Record<string, string>;
      dir?: string;
      error?: string;
    }>;
    delete: (name: string) => Promise<{ success?: boolean; error?: string }>;
    toggle: (name: string, enable: boolean) => Promise<{ success?: boolean; enabled?: boolean }>;
  };
  plugins: {
    getUIState: () => Promise<unknown>;
    list: () => Promise<Array<{
      name: string;
      displayName: string;
      version: string;
      description: string;
      state: string;
      required: boolean;
      error?: string;
    }>>;
    getConfig: (pluginName: string) => Promise<Record<string, unknown>>;
    setConfig: (pluginName: string, path: string, value: unknown) => Promise<{ success: boolean }>;
    modalAction: (pluginName: string, modalId: string, action: string, data?: unknown) => Promise<unknown>;
    bannerAction: (pluginName: string, bannerId: string, action: string, data?: unknown) => Promise<unknown>;
    action: (pluginName: string, targetId: string, action: string, data?: unknown) => Promise<unknown>;
    onUIStateChanged: (callback: (state: unknown) => void) => () => void;
    onModalCallback: (callback: (data: unknown) => void) => () => void;
  };
  modelCatalog: () => Promise<unknown>;
  realtime: {
    startSession: (conversationId: string) => Promise<{ ok?: boolean; error?: string }>;
    endSession: () => Promise<{ ok?: boolean }>;
    sendAudio: (pcmBase64: string) => void;
    getStatus: () => Promise<{ status: string }>;
    onEvent: (callback: (event: unknown) => void) => () => void;
  };
  profileCatalog: () => Promise<{
    profiles: Array<{ key: string; name: string; primaryModelKey: string; fallbackModelKeys: string[] }>;
    defaultKey: string | null;
  }>;
  dialog: {
    openFile: (options?: { filters?: Array<{ name: string; extensions: string[] }> }) => Promise<unknown>;
    openDirectoryFiles: () => Promise<{ canceled: boolean; filePaths: string[] }>;
  };
  image: {
    fetch: (url: string) => Promise<{ data?: string; mime?: string; error?: string }>;
    save: (url: string, suggestedName?: string) => Promise<{ canceled?: boolean; filePath?: string; error?: string }>;
  };
  platform: {
    homedir: () => Promise<string>;
  };
  computerUse: {
    startSession: (goal: string, options: unknown) => Promise<unknown>;
    pauseSession: (sessionId: string) => Promise<unknown>;
    resumeSession: (sessionId: string) => Promise<unknown>;
    stopSession: (sessionId: string) => Promise<unknown>;
    approveAction: (sessionId: string, actionId: string) => Promise<unknown>;
    rejectAction: (sessionId: string, actionId: string, reason?: string) => Promise<unknown>;
    listSessions: () => Promise<unknown[]>;
    getSession: (sessionId: string) => Promise<unknown>;
    setSurface: (sessionId: string, surface: ComputerUseSurface) => Promise<unknown>;
    sendGuidance: (sessionId: string, text: string) => Promise<unknown>;
    updateSessionSettings: (sessionId: string, settings: { modelKey?: string | null; profileKey?: string | null; fallbackEnabled?: boolean; reasoningEffort?: string }) => Promise<unknown>;
    continueSession: (sessionId: string, newGoal: string) => Promise<unknown>;
    markSessionsSeen: (conversationId: string) => Promise<unknown>;
    openSetupWindow: (conversationId?: string | null) => Promise<unknown>;
    getLocalMacosPermissions: () => Promise<ComputerUsePermissions>;
    requestLocalMacosPermissions: () => Promise<ComputerUsePermissionRequestResult>;
    requestSingleLocalMacosPermission: (section: ComputerUsePermissionSection) => Promise<ComputerUsePermissions>;
    openLocalMacosPrivacySettings: (section?: ComputerUsePermissionSection) => Promise<{ opened: ComputerUsePermissionSection | null }>;
    probeInputMonitoring: (timeoutMs?: number) => Promise<{ inputMonitoringGranted: boolean }>;
    checkFullScreenApps: () => Promise<{ apps: string[]; problematicApps: string[] }>;
    exitFullScreenApps: (appNames: string[]) => Promise<{ exited: string[]; failed: string[] }>;
    listRunningApps: () => Promise<{ apps: string[] }>;
    listDisplays: () => Promise<{ displays: Array<{ name: string; displayId: string; pixelWidth: number; pixelHeight: number; isPrimary: boolean }> }>;
    focusSession: (sessionId: string) => Promise<unknown>;
    overlayMouseEnter: () => void;
    overlayMouseLeave: () => void;
    onEvent: (callback: (event: ComputerUseEvent) => void) => () => void;
    onOverlayState: (callback: (state: unknown) => void) => () => void;
    onFocusThread: (callback: () => void) => () => void;
  };
  mic: {
    listDevices: () => Promise<Array<{ deviceId: string; label: string }>>;
    startRecording: (deviceId?: string) => Promise<{ ok?: boolean; silent?: boolean; error?: string }>;
    stopRecording: () => Promise<{
      wavBase64?: string;
      durationSec?: number;
      maxAmplitude?: number;
      error?: string;
    }>;
    cancelRecording: () => Promise<{ ok?: boolean }>;
    startMonitor: (deviceIds?: string[]) => Promise<Record<string, { ok?: boolean; error?: string }>>;
    getLevel: () => Promise<Record<string, number>>;
    stopMonitor: () => Promise<{ ok?: boolean }>;
    // Live streaming STT
    liveStart: (config: { subscriptionKey: string; region?: string; endpoint?: string; language: string; deviceId?: string }) => Promise<{ ok?: boolean; error?: string }>;
    liveMicStart: (deviceId?: string) => Promise<{ ok?: boolean; error?: string }>;
    liveMicDrain: () => Promise<string[]>;
    liveMicStop: () => Promise<{ ok?: boolean }>;
    liveAudio: (pcmBase64: string) => void;
    liveStop: () => Promise<{ ok?: boolean }>;
    onPartial: (callback: (text: string) => void) => () => void;
    onFinal: (callback: (text: string) => void) => () => void;
    onSttError: (callback: (error: string) => void) => () => void;
  };
  knowledge: {
    query: (query: string, scope?: string, synthesize?: boolean) => Promise<{ ok: boolean; data?: unknown; error?: string }>;
    retrieve: (query: string, scope?: string, limit?: number) => Promise<{ ok: boolean; data?: unknown; error?: string }>;
    browse: (filters?: { tag?: string; source?: string; page?: string; per_page?: string }) => Promise<{ ok: boolean; data?: unknown; error?: string }>;
    delete: (id: string) => Promise<{ ok: boolean; data?: unknown; error?: string }>;
    ingest: (content: string, metadata?: Record<string, unknown>) => Promise<{ ok: boolean; data?: unknown; error?: string }>;
    ingestFile: (filePath: string) => Promise<{ ok: boolean; data?: unknown; error?: string }>;
    monitorsList: () => Promise<{ ok: boolean; data?: unknown; error?: string }>;
    monitorAdd: (path: string) => Promise<{ ok: boolean; data?: unknown; error?: string }>;
    monitorRemove: (id: string) => Promise<{ ok: boolean; data?: unknown; error?: string }>;
    monitorScan: (id: string) => Promise<{ ok: boolean; data?: unknown; error?: string }>;
    health: () => Promise<{ ok: boolean; data?: unknown; error?: string }>;
    maintain: () => Promise<{ ok: boolean; data?: unknown; error?: string }>;
    status: () => Promise<{ ok: boolean; data?: unknown; error?: string }>;
  };
  onMenuOpenSettings: (callback: () => void) => () => void;
  onFind: (callback: () => void) => () => void;
  onModelSwitched: (callback: (modelKey: string) => void) => () => void;
};

declare global {
  interface Window {
    legion?: LegionAPI;
  }
}

function getLegion(): LegionAPI {
  if (!window.legion) {
    throw new Error('Legion Interlink IPC bridge not available. Ensure the app is running in Electron.');
  }
  return window.legion;
}

// Lazy proxy — only accesses window.legion when actually called
export const legion: LegionAPI = new Proxy({} as LegionAPI, {
  get(_target, prop: string) {
    const api = getLegion();
    return (api as Record<string, unknown>)[prop];
  },
});
