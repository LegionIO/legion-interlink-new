import { contextBridge, ipcRenderer } from 'electron';

export type LegionAPI = typeof legionAPI;

const legionAPI = {
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
    legionStatus: () =>
      ipcRenderer.invoke('agent:legion-status'),
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

  // Memory management
  memory: {
    clear: (options: { working?: boolean; observational?: boolean; semantic?: boolean; all?: boolean }) =>
      ipcRenderer.invoke('memory:clear', options) as Promise<{ success?: boolean; cleared?: string[]; error?: string }>,
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

  // Profile catalog
  profileCatalog: () => ipcRenderer.invoke('agent:profiles'),

  // File dialog
  dialog: {
    openFile: (options?: { filters?: Array<{ name: string; extensions: string[] }> }) =>
      ipcRenderer.invoke('dialog:open-file', options),
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
    startMonitor: (deviceId?: string) => ipcRenderer.invoke('stt:start-monitor', deviceId) as Promise<{ ok?: boolean; error?: string }>,
    getLevel: () => ipcRenderer.invoke('stt:get-level') as Promise<number>,
    stopMonitor: () => ipcRenderer.invoke('stt:stop-monitor') as Promise<{ ok?: boolean }>,
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

contextBridge.exposeInMainWorld('legion', legionAPI);
