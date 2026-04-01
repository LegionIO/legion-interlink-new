import { contextBridge, ipcRenderer } from 'electron';
import type {
  ComputerUseEvent,
  ComputerUsePermissionSection,
  ComputerUseSurface,
} from '../shared/computer-use.js';

export type AppAPI = typeof appAPI;

const appAPI = {
  // Config
  config: {
    get: () => ipcRenderer.invoke('config:get'),
    set: (path: string, value: unknown) => ipcRenderer.invoke('config:set', path, value),
    autoDetectRuntime: () => ipcRenderer.invoke('config:auto-detect-runtime'),
    onChanged: (callback: (config: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, config: unknown) => callback(config);
      ipcRenderer.on('config:changed', handler);
      return () => ipcRenderer.removeListener('config:changed', handler);
    },
  },

  // Agent / Chat
  agent: {
    stream: (
      conversationId: string,
      messages: unknown[],
      modelKey?: string,
      reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh',
      profileKey?: string,
      fallbackEnabled?: boolean,
    ) => ipcRenderer.invoke('agent:stream', conversationId, messages, modelKey, reasoningEffort, profileKey, fallbackEnabled),
    cancelStream: (conversationId: string) =>
      ipcRenderer.invoke('agent:cancel-stream', conversationId),
    generateTitle: (messages: unknown[], modelKey?: string) =>
      ipcRenderer.invoke('agent:generate-title', messages, modelKey),
    appStatus: () =>
      ipcRenderer.invoke('agent:app-status'),
    onStreamEvent: (callback: (event: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
      ipcRenderer.on('agent:stream-event', handler);
      return () => ipcRenderer.removeListener('agent:stream-event', handler);
    },
    // Sub-agent interaction
    sendSubAgentMessage: (subAgentConversationId: string, message: string) =>
      ipcRenderer.invoke('agent:sub-agent-message', subAgentConversationId, message),
    stopSubAgent: (subAgentConversationId: string) =>
      ipcRenderer.invoke('agent:sub-agent-stop', subAgentConversationId),
    listSubAgents: () =>
      ipcRenderer.invoke('agent:sub-agent-list'),
  },

  // Conversations
  conversations: {
    list: () => ipcRenderer.invoke('conversations:list'),
    get: (id: string) => ipcRenderer.invoke('conversations:get', id),
    put: (conversation: unknown) => ipcRenderer.invoke('conversations:put', conversation),
    delete: (id: string) => ipcRenderer.invoke('conversations:delete', id),
    clear: () => ipcRenderer.invoke('conversations:clear'),
    getActiveId: () => ipcRenderer.invoke('conversations:get-active-id'),
    setActiveId: (id: string) => ipcRenderer.invoke('conversations:set-active-id', id),
    onChanged: (callback: (store: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, store: unknown) => callback(store);
      ipcRenderer.on('conversations:changed', handler);
      return () => ipcRenderer.removeListener('conversations:changed', handler);
    },
  },

  // Daemon
  daemon: {
    settings: () => ipcRenderer.invoke('daemon:settings'),
    settingsUpdate: (key: string, value: unknown) => ipcRenderer.invoke('daemon:settings-update', key, value),
    catalog: () => ipcRenderer.invoke('daemon:catalog'),
    extensions: () => ipcRenderer.invoke('daemon:extensions'),
    extension: (id: string) => ipcRenderer.invoke('daemon:extension', id),
    extensionRunners: (id: string) => ipcRenderer.invoke('daemon:extension-runners', id),
    tasks: (filters?: Record<string, string>) => ipcRenderer.invoke('daemon:tasks', filters),
    task: (id: string) => ipcRenderer.invoke('daemon:task', id),
    taskLogs: (id: string) => ipcRenderer.invoke('daemon:task-logs', id),
    taskCreate: (body: unknown) => ipcRenderer.invoke('daemon:task-create', body),
    taskDelete: (id: string) => ipcRenderer.invoke('daemon:task-delete', id),
    taskGraph: (filters?: Record<string, string>) => ipcRenderer.invoke('daemon:task-graph', filters),
    workers: (filters?: Record<string, string>) => ipcRenderer.invoke('daemon:workers', filters),
    worker: (id: string) => ipcRenderer.invoke('daemon:worker', id),
    workerHealth: (id: string) => ipcRenderer.invoke('daemon:worker-health', id),
    workerCosts: (id: string) => ipcRenderer.invoke('daemon:worker-costs', id),
    workerLifecycle: (id: string, body: unknown) => ipcRenderer.invoke('daemon:worker-lifecycle', id, body),
    schedules: () => ipcRenderer.invoke('daemon:schedules'),
    schedule: (id: string) => ipcRenderer.invoke('daemon:schedule', id),
    scheduleCreate: (body: unknown) => ipcRenderer.invoke('daemon:schedule-create', body),
    scheduleUpdate: (id: string, body: unknown) => ipcRenderer.invoke('daemon:schedule-update', id, body),
    scheduleDelete: (id: string) => ipcRenderer.invoke('daemon:schedule-delete', id),
    audit: (filters?: Record<string, string>) => ipcRenderer.invoke('daemon:audit', filters),
    auditVerify: () => ipcRenderer.invoke('daemon:audit-verify'),
    transport: () => ipcRenderer.invoke('daemon:transport'),
    transportExchanges: () => ipcRenderer.invoke('daemon:transport-exchanges'),
    transportQueues: () => ipcRenderer.invoke('daemon:transport-queues'),
    transportPublish: (body: unknown) => ipcRenderer.invoke('daemon:transport-publish', body),
    prompts: () => ipcRenderer.invoke('daemon:prompts'),
    prompt: (name: string) => ipcRenderer.invoke('daemon:prompt', name),
    promptRun: (name: string, body: unknown) => ipcRenderer.invoke('daemon:prompt-run', name, body),
    webhooks: () => ipcRenderer.invoke('daemon:webhooks'),
    webhookCreate: (body: unknown) => ipcRenderer.invoke('daemon:webhook-create', body),
    webhookDelete: (id: string) => ipcRenderer.invoke('daemon:webhook-delete', id),
    tenants: () => ipcRenderer.invoke('daemon:tenants'),
    tenant: (id: string) => ipcRenderer.invoke('daemon:tenant', id),
    capacity: () => ipcRenderer.invoke('daemon:capacity'),
    capacityForecast: (params?: Record<string, string>) => ipcRenderer.invoke('daemon:capacity-forecast', params),
    governanceApprovals: (filters?: Record<string, string>) => ipcRenderer.invoke('daemon:governance-approvals', filters),
    governanceApprove: (id: string, body: unknown) => ipcRenderer.invoke('daemon:governance-approve', id, body),
    governanceReject: (id: string, body: unknown) => ipcRenderer.invoke('daemon:governance-reject', id, body),
    rbacRoles: () => ipcRenderer.invoke('daemon:rbac-roles'),
    rbacAssignments: (filters?: Record<string, string>) => ipcRenderer.invoke('daemon:rbac-assignments', filters),
    rbacCheck: (body: unknown) => ipcRenderer.invoke('daemon:rbac-check', body),
    nodes: () => ipcRenderer.invoke('daemon:nodes'),
    eventsSubscribe: () => ipcRenderer.invoke('daemon:events-subscribe'),
    eventsUnsubscribe: () => ipcRenderer.invoke('daemon:events-unsubscribe'),
    eventsRecent: (count?: number) => ipcRenderer.invoke('daemon:events-recent', count),
    onEvent: (callback: (event: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
      ipcRenderer.on('daemon:event', handler);
      return () => ipcRenderer.removeListener('daemon:event', handler);
    },
    subAgentCreate: (body: { message: string; model?: string; parent_conversation_id?: string }) =>
      ipcRenderer.invoke('daemon:sub-agent-create', body),
    subAgentStatus: (taskId: string) => ipcRenderer.invoke('daemon:sub-agent-status', taskId),
    doCommand: (input: string) => ipcRenderer.invoke('daemon:do', input),
    capabilities: () => ipcRenderer.invoke('daemon:capabilities'),
    memoryEntries: (filters?: Record<string, string>) => ipcRenderer.invoke('daemon:memory-entries', filters),
    memoryEntry: (id: string) => ipcRenderer.invoke('daemon:memory-entry', id),
    memoryEntryUpdate: (id: string, body: unknown) => ipcRenderer.invoke('daemon:memory-entry-update', id, body),
    memoryEntryDelete: (id: string) => ipcRenderer.invoke('daemon:memory-entry-delete', id),
    memoryStats: () => ipcRenderer.invoke('daemon:memory-stats'),
    marketplace: (filters?: Record<string, string>) => ipcRenderer.invoke('daemon:marketplace', filters),
    extensionInstall: (id: string) => ipcRenderer.invoke('daemon:extension-install', id),
    extensionUninstall: (id: string) => ipcRenderer.invoke('daemon:extension-uninstall', id),
    extensionEnable: (id: string) => ipcRenderer.invoke('daemon:extension-enable', id),
    extensionDisable: (id: string) => ipcRenderer.invoke('daemon:extension-disable', id),
    extensionConfig: (id: string) => ipcRenderer.invoke('daemon:extension-config', id),
    extensionConfigUpdate: (id: string, body: unknown) => ipcRenderer.invoke('daemon:extension-config-update', id, body),
    githubStatus: () => ipcRenderer.invoke('daemon:github-status'),
    githubRepos: () => ipcRenderer.invoke('daemon:github-repos'),
    githubPulls: (filters?: Record<string, string>) => ipcRenderer.invoke('daemon:github-pulls', filters),
    githubPull: (repo: string, number: number) => ipcRenderer.invoke('daemon:github-pull', repo, number),
    githubIssues: (filters?: Record<string, string>) => ipcRenderer.invoke('daemon:github-issues', filters),
    githubCommits: (filters?: Record<string, string>) => ipcRenderer.invoke('daemon:github-commits', filters),
    gaiaStatus: () => ipcRenderer.invoke('daemon:gaia-status'),
    gaiaEvents: (filters?: { limit?: string }) => ipcRenderer.invoke('daemon:gaia-events', filters),
    metering: (filters?: Record<string, string>) => ipcRenderer.invoke('daemon:metering', filters),
    meteringRollup: (filters?: Record<string, string>) => ipcRenderer.invoke('daemon:metering-rollup', filters),
    meteringByModel: (filters?: Record<string, string>) => ipcRenderer.invoke('daemon:metering-by-model', filters),
    meshStatus: () => ipcRenderer.invoke('daemon:mesh-status'),
    meshPeers: () => ipcRenderer.invoke('daemon:mesh-peers'),
    absorbers: () => ipcRenderer.invoke('daemon:absorbers'),
    absorberResolve: (input: string) => ipcRenderer.invoke('daemon:absorber-resolve', input),
    absorberDispatch: (input: string, scope?: string) => ipcRenderer.invoke('daemon:absorber-dispatch', input, scope),
    absorberJob: (jobId: string) => ipcRenderer.invoke('daemon:absorber-job', jobId),
    health: () => ipcRenderer.invoke('daemon:health'),
    ready: () => ipcRenderer.invoke('daemon:ready'),
    metrics: () => ipcRenderer.invoke('daemon:metrics'),
    doctor: () => ipcRenderer.invoke('daemon:doctor'),
    structuralIndex: () => ipcRenderer.invoke('daemon:structural-index'),
    structuralIndexRefresh: () => ipcRenderer.invoke('daemon:structural-index-refresh'),
    toolAudit: (mode?: 'summary' | 'matrix' | 'issues') => ipcRenderer.invoke('daemon:tool-audit', mode),
    stateDiffSnapshot: () => ipcRenderer.invoke('daemon:state-diff-snapshot'),
    stateDiff: (snapshotId: string) => ipcRenderer.invoke('daemon:state-diff', snapshotId),
    sessionsSearch: (query: string) => ipcRenderer.invoke('daemon:sessions-search', query),
    triggers: () => ipcRenderer.invoke('daemon:triggers'),
    trigger: (id: string) => ipcRenderer.invoke('daemon:trigger', id),
    triggerCreate: (body: unknown) => ipcRenderer.invoke('daemon:trigger-create', body),
    triggerUpdate: (id: string, body: unknown) => ipcRenderer.invoke('daemon:trigger-update', id, body),
    triggerDelete: (id: string) => ipcRenderer.invoke('daemon:trigger-delete', id),
    llmTokenBudget: () => ipcRenderer.invoke('daemon:llm-token-budget'),
    llmTokenBudgetReset: () => ipcRenderer.invoke('daemon:llm-token-budget-reset'),
    llmProviders: () => ipcRenderer.invoke('daemon:llm-providers'),
    llmProviderLayer: () => ipcRenderer.invoke('daemon:llm-provider-layer'),
    llmContextCurationStatus: () => ipcRenderer.invoke('daemon:llm-context-curation-status'),
  },

  // Memory management
  memory: {
    clear: (options: { working?: boolean; observational?: boolean; semantic?: boolean; all?: boolean }) =>
      ipcRenderer.invoke('memory:clear', options) as Promise<{ success?: boolean; cleared?: string[]; error?: string }>,
    testEmbedding: () =>
      ipcRenderer.invoke('memory:test-embedding') as Promise<{ ok?: boolean; model?: string; dimensions?: number; error?: string }>,
  },

  // MCP servers
  mcp: {
    testConnection: (server: { name: string; url?: string; command?: string; args?: string[]; env?: Record<string, string> }) =>
      ipcRenderer.invoke('mcp:test-connection', server) as Promise<{ status: string; toolCount: number; error?: string }>,
  },

  // Skills
  skills: {
    list: () => ipcRenderer.invoke('skills:list') as Promise<Array<{
      name: string;
      description: string;
      version?: string;
      type: string;
      enabled: boolean;
      dir: string;
    }>>,
    get: (name: string) => ipcRenderer.invoke('skills:get', name) as Promise<{
      manifest?: Record<string, unknown>;
      files?: Record<string, string>;
      dir?: string;
      error?: string;
    }>,
    delete: (name: string) => ipcRenderer.invoke('skills:delete', name) as Promise<{ success?: boolean; error?: string }>,
    toggle: (name: string, enable: boolean) => ipcRenderer.invoke('skills:toggle', name, enable) as Promise<{ success?: boolean; enabled?: boolean }>,
  },

  // Plugins
  plugins: {
    getUIState: () => ipcRenderer.invoke('plugin:get-ui-state'),
    list: () => ipcRenderer.invoke('plugin:list') as Promise<Array<{
      name: string;
      displayName: string;
      version: string;
      description: string;
      state: string;
      required: boolean;
      error?: string;
    }>>,
    getConfig: (pluginName: string) => ipcRenderer.invoke('plugin:get-config', pluginName) as Promise<Record<string, unknown>>,
    setConfig: (pluginName: string, path: string, value: unknown) =>
      ipcRenderer.invoke('plugin:set-config', pluginName, path, value) as Promise<{ success: boolean }>,
    modalAction: (pluginName: string, modalId: string, action: string, data?: unknown) =>
      ipcRenderer.invoke('plugin:modal-action', pluginName, modalId, action, data),
    bannerAction: (pluginName: string, bannerId: string, action: string, data?: unknown) =>
      ipcRenderer.invoke('plugin:banner-action', pluginName, bannerId, action, data),
    action: (pluginName: string, targetId: string, action: string, data?: unknown) =>
      ipcRenderer.invoke('plugin:action', pluginName, targetId, action, data),
    onUIStateChanged: (callback: (state: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, state: unknown) => callback(state);
      ipcRenderer.on('plugin:ui-state-changed', handler);
      return () => ipcRenderer.removeListener('plugin:ui-state-changed', handler);
    },
    onModalCallback: (callback: (data: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
      ipcRenderer.on('plugin:modal-callback', handler);
      return () => ipcRenderer.removeListener('plugin:modal-callback', handler);
    },
  },

  // Model catalog
  modelCatalog: () => ipcRenderer.invoke('agent:model-catalog'),

  // Realtime audio sessions
  realtime: {
    startSession: (conversationId: string) =>
      ipcRenderer.invoke('realtime:start-session', conversationId) as Promise<{ ok?: boolean; error?: string }>,
    endSession: () =>
      ipcRenderer.invoke('realtime:end-session') as Promise<{ ok?: boolean }>,
    sendAudio: (pcmBase64: string) =>
      ipcRenderer.send('realtime:send-audio', pcmBase64),
    getStatus: () =>
      ipcRenderer.invoke('realtime:get-status') as Promise<{ status: string }>,
    onEvent: (callback: (event: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
      ipcRenderer.on('realtime:event', handler);
      return () => ipcRenderer.removeListener('realtime:event', handler);
    },
  },

  // Profile catalog
  profileCatalog: () => ipcRenderer.invoke('agent:profiles'),

  // File dialog
  dialog: {
    openFile: (options?: { filters?: Array<{ name: string; extensions: string[] }> }) =>
      ipcRenderer.invoke('dialog:open-file', options),
    openDirectoryFiles: () => ipcRenderer.invoke('dialog:open-directory-files'),
  },

  clipboard: {
    writeText: (text: string) =>
      ipcRenderer.invoke('clipboard:write-text', text) as Promise<{ ok: boolean; error?: string }>,
  },

  // Image utilities (fetched via main process to bypass CORS)
  image: {
    fetch: (url: string) => ipcRenderer.invoke('image:fetch', url) as Promise<{ data?: string; mime?: string; error?: string }>,
    save: (url: string, suggestedName?: string) => ipcRenderer.invoke('image:save', url, suggestedName) as Promise<{ canceled?: boolean; filePath?: string; error?: string }>,
  },

  // Platform info
  platform: {
    homedir: () => ipcRenderer.invoke('platform:homedir'),
  },

  computerUse: {
    startSession: (goal: string, options: unknown) => ipcRenderer.invoke('computer-use:start-session', goal, options),
    pauseSession: (sessionId: string) => ipcRenderer.invoke('computer-use:pause-session', sessionId),
    resumeSession: (sessionId: string) => ipcRenderer.invoke('computer-use:resume-session', sessionId),
    stopSession: (sessionId: string) => ipcRenderer.invoke('computer-use:stop-session', sessionId),
    approveAction: (sessionId: string, actionId: string) => ipcRenderer.invoke('computer-use:approve-action', sessionId, actionId),
    rejectAction: (sessionId: string, actionId: string, reason?: string) => ipcRenderer.invoke('computer-use:reject-action', sessionId, actionId, reason),
    listSessions: () => ipcRenderer.invoke('computer-use:list-sessions'),
    getSession: (sessionId: string) => ipcRenderer.invoke('computer-use:get-session', sessionId),
    setSurface: (sessionId: string, surface: ComputerUseSurface) => ipcRenderer.invoke('computer-use:set-surface', sessionId, surface),
    sendGuidance: (sessionId: string, text: string) => ipcRenderer.invoke('computer-use:send-guidance', sessionId, text),
    updateSessionSettings: (sessionId: string, settings: { modelKey?: string | null; profileKey?: string | null; fallbackEnabled?: boolean; reasoningEffort?: string }) => ipcRenderer.invoke('computer-use:update-session-settings', sessionId, settings),
    continueSession: (sessionId: string, newGoal: string) => ipcRenderer.invoke('computer-use:continue-session', sessionId, newGoal),
    markSessionsSeen: (conversationId: string) => ipcRenderer.invoke('computer-use:mark-sessions-seen', conversationId),
    openSetupWindow: (conversationId?: string | null) => ipcRenderer.invoke('computer-use:open-setup-window', conversationId),
    getLocalMacosPermissions: () => ipcRenderer.invoke('computer-use:get-local-macos-permissions'),
    requestLocalMacosPermissions: () => ipcRenderer.invoke('computer-use:request-local-macos-permissions'),
    requestSingleLocalMacosPermission: (section: ComputerUsePermissionSection) => ipcRenderer.invoke('computer-use:request-single-local-macos-permission', section),
    openLocalMacosPrivacySettings: (section?: ComputerUsePermissionSection) => ipcRenderer.invoke('computer-use:open-local-macos-privacy-settings', section),
    probeInputMonitoring: (timeoutMs?: number) => ipcRenderer.invoke('computer-use:probe-input-monitoring', timeoutMs) as Promise<{ inputMonitoringGranted: boolean }>,
    checkFullScreenApps: () => ipcRenderer.invoke('computer-use:check-fullscreen-apps') as Promise<{ apps: string[]; problematicApps: string[] }>,
    exitFullScreenApps: (appNames: string[]) => ipcRenderer.invoke('computer-use:exit-fullscreen-apps', appNames) as Promise<{ exited: string[]; failed: string[] }>,
    listRunningApps: () => ipcRenderer.invoke('computer-use:list-running-apps') as Promise<{ apps: string[] }>,
    listDisplays: () => ipcRenderer.invoke('computer-use:list-displays') as Promise<{ displays: Array<{ name: string; displayId: string; pixelWidth: number; pixelHeight: number; isPrimary: boolean }> }>,
    focusSession: (sessionId: string) => ipcRenderer.invoke('computer-use:focus-session', sessionId),
    overlayMouseEnter: () => ipcRenderer.send('computer-use:overlay-set-ignore-mouse', false),
    overlayMouseLeave: () => ipcRenderer.send('computer-use:overlay-set-ignore-mouse', true),
    onEvent: (callback: (event: ComputerUseEvent) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: ComputerUseEvent) => callback(data);
      ipcRenderer.on('computer-use:event', handler);
      return () => ipcRenderer.removeListener('computer-use:event', handler);
    },
    onOverlayState: (callback: (state: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
      ipcRenderer.on('computer-use:overlay-state', handler);
      return () => ipcRenderer.removeListener('computer-use:overlay-state', handler);
    },
    onFocusThread: (callback: () => void) => {
      const handler = () => callback();
      ipcRenderer.on('computer-use:focus-thread', handler);
      return () => ipcRenderer.removeListener('computer-use:focus-thread', handler);
    },
  },

  // Microphone recording (via main process for macOS permission compatibility)
  mic: {
    listDevices: () => ipcRenderer.invoke('stt:list-devices') as Promise<Array<{ deviceId: string; label: string }>>,
    startRecording: (deviceId?: string) => ipcRenderer.invoke('stt:start-recording', deviceId) as Promise<{ ok?: boolean; silent?: boolean; error?: string }>,
    stopRecording: () => ipcRenderer.invoke('stt:stop-recording') as Promise<{
      wavBase64?: string;
      durationSec?: number;
      maxAmplitude?: number;
      error?: string;
    }>,
    cancelRecording: () => ipcRenderer.invoke('stt:cancel-recording') as Promise<{ ok?: boolean }>,
    startMonitor: (deviceIds?: string[]) => ipcRenderer.invoke('stt:start-monitor', deviceIds) as Promise<Record<string, { ok?: boolean; error?: string }>>,
    getLevel: () => ipcRenderer.invoke('stt:get-level') as Promise<Record<string, number>>,
    stopMonitor: () => ipcRenderer.invoke('stt:stop-monitor') as Promise<{ ok?: boolean }>,
    // Live streaming STT
    liveStart: (config: { subscriptionKey: string; region?: string; endpoint?: string; language: string; deviceId?: string }) =>
      ipcRenderer.invoke('stt:live-start', config) as Promise<{ ok?: boolean; error?: string }>,
    liveMicStart: (deviceId?: string) => ipcRenderer.invoke('stt:live-mic-start', deviceId) as Promise<{ ok?: boolean; error?: string }>,
    liveMicDrain: () => ipcRenderer.invoke('stt:live-mic-drain') as Promise<string[]>,
    liveMicStop: () => ipcRenderer.invoke('stt:live-mic-stop') as Promise<{ ok?: boolean }>,
    liveAudio: (pcmBase64: string) => ipcRenderer.send('stt:live-audio', pcmBase64),
    liveStop: () => ipcRenderer.invoke('stt:live-stop') as Promise<{ ok?: boolean }>,
    onPartial: (callback: (text: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, text: string) => callback(text);
      ipcRenderer.on('stt:partial', handler);
      return () => ipcRenderer.removeListener('stt:partial', handler);
    },
    onFinal: (callback: (text: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, text: string) => callback(text);
      ipcRenderer.on('stt:final', handler);
      return () => ipcRenderer.removeListener('stt:final', handler);
    },
    onSttError: (callback: (error: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, error: string) => callback(error);
      ipcRenderer.on('stt:error', handler);
      return () => ipcRenderer.removeListener('stt:error', handler);
    },
  },

  // Knowledge (Apollo)
  knowledge: {
    query: (query: string, scope?: string, synthesize?: boolean) =>
      ipcRenderer.invoke('knowledge:query', query, scope, synthesize),
    retrieve: (query: string, scope?: string, limit?: number) =>
      ipcRenderer.invoke('knowledge:retrieve', query, scope, limit),
    browse: (filters?: { tag?: string; source?: string; page?: string; per_page?: string }) =>
      ipcRenderer.invoke('knowledge:browse', filters),
    delete: (id: string) => ipcRenderer.invoke('knowledge:delete', id),
    ingest: (content: string, metadata?: Record<string, unknown>) =>
      ipcRenderer.invoke('knowledge:ingest', content, metadata),
    ingestFile: (filePath: string) => ipcRenderer.invoke('knowledge:ingest-file', filePath),
    monitorsList: () => ipcRenderer.invoke('knowledge:monitors-list'),
    monitorAdd: (path: string) => ipcRenderer.invoke('knowledge:monitor-add', path),
    monitorRemove: (id: string) => ipcRenderer.invoke('knowledge:monitor-remove', id),
    monitorScan: (id: string) => ipcRenderer.invoke('knowledge:monitor-scan', id),
    health: () => ipcRenderer.invoke('knowledge:health'),
    maintain: () => ipcRenderer.invoke('knowledge:maintain'),
    status: () => ipcRenderer.invoke('knowledge:status'),
  },

  // Menu events
  onMenuOpenSettings: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('menu:open-settings', handler);
    return () => ipcRenderer.removeListener('menu:open-settings', handler);
  },

  // Find in conversation
  onFind: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('menu:find', handler);
    return () => ipcRenderer.removeListener('menu:find', handler);
  },

  // Model switch events (from AI tool)
  onModelSwitched: (callback: (modelKey: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, modelKey: string) => callback(modelKey);
    ipcRenderer.on('agent:model-switched', handler);
    return () => ipcRenderer.removeListener('agent:model-switched', handler);
  },
};

contextBridge.exposeInMainWorld('app', appAPI);
