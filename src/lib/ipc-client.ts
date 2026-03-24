// Type-safe wrapper for the Electron IPC bridge exposed via preload
// window.legion is set by electron/preload.ts via contextBridge

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
  memory: {
    clear: (options: { working?: boolean; observational?: boolean; semantic?: boolean; all?: boolean }) =>
      Promise<{ success?: boolean; cleared?: string[]; error?: string }>;
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
  };
  image: {
    fetch: (url: string) => Promise<{ data?: string; mime?: string; error?: string }>;
    save: (url: string, suggestedName?: string) => Promise<{ canceled?: boolean; filePath?: string; error?: string }>;
  };
  platform: {
    homedir: () => Promise<string>;
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
