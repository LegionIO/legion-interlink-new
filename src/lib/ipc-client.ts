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
    stream: (conversationId: string, messages: unknown[], modelKey?: string, reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh') => Promise<unknown>;
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
  agentLattice: {
    authStatus: () => Promise<unknown>;
    initiateOAuth: (config: {
      agentUrl: string;
      callbackHost?: string;
      callbackPort: number;
      cookieDomain?: string;
      cookieName?: string;
    }) => Promise<unknown>;
    clearAuth: () => Promise<unknown>;
    ensureHosts: (opts?: { fix?: boolean }) => Promise<{ needed: boolean; applied: boolean; error?: string }>;
    onAuthChanged: (callback: (status: unknown) => void) => () => void;
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
  modelCatalog: () => Promise<unknown>;
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
    throw new Error('Legion Aithena IPC bridge not available. Ensure the app is running in Electron.');
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
