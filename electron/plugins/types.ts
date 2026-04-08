import type { ToolDefinition } from '../tools/types.js';
import type { AppConfig } from '../config/schema.js';

/* ── Manifest ── */

export type PluginPermission =
  | 'config:read'
  | 'config:write'
  | 'tools:register'
  | 'ui:banner'
  | 'ui:modal'
  | 'ui:settings'
  | 'messages:hook';

export type PluginApprovalRecord = {
  hash: string;
  approvedAt: string;
};

export type PluginManifest = {
  name: string;
  displayName: string;
  version: string;
  description: string;
  main: string;
  renderer?: string;
  permissions: PluginPermission[];
  priority: number;
  required: boolean;
  configSchema?: Record<string, unknown>;
};

/* ── Plugin State ── */

export type PluginState = 'loading' | 'active' | 'error' | 'disabled';

export type PluginInstance = {
  manifest: PluginManifest;
  dir: string;
  fileHash: string;
  state: PluginState;
  error?: string;
  module: PluginModule | null;
  registeredTools: ToolDefinition[];
  preSendHooks: PreSendHook[];
  postReceiveHooks: PostReceiveHook[];
  uiBanners: PluginBannerDescriptor[];
  uiModals: PluginModalDescriptor[];
  uiSettingsSections: PluginSettingsSectionDescriptor[];
  configChangeListeners: Array<(config: AppConfig) => void>;
};

/* ── Plugin Module (what main.js must export) ── */

export type PluginModule = {
  activate: (api: PluginAPI) => Promise<void> | void;
  deactivate?: () => Promise<void> | void;
  onConfigChanged?: (config: AppConfig) => void;
};

/* ── Message Hooks ── */

export type MessageContent =
  | { type: 'text'; text: string }
  | { type: 'tool-call'; toolCallId: string; toolName: string; args: Record<string, unknown> }
  | { type: 'tool-result'; toolCallId: string; result: unknown; isError?: boolean }
  | { type: 'image'; image: string; mimeType?: string }
  | Record<string, unknown>;

export type HookMessage = {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | MessageContent[];
};

export type PreSendHookArgs = {
  messages: HookMessage[];
  modelKey: string;
  config: AppConfig;
};

export type PreSendHookResult = {
  messages: HookMessage[];
  abort?: boolean;
  abortReason?: string;
};

export type PreSendHook = (args: PreSendHookArgs) => Promise<PreSendHookResult> | PreSendHookResult;

export type PostReceiveHookArgs = {
  response: HookMessage;
  messages: HookMessage[];
  config: AppConfig;
};

export type PostReceiveHookResult = {
  response: HookMessage;
};

export type PostReceiveHook = (args: PostReceiveHookArgs) => Promise<PostReceiveHookResult> | PostReceiveHookResult;

/* ── UI Descriptors (JSON-serializable across IPC) ── */

export type PluginBannerDescriptor = {
  id: string;
  pluginName: string;
  component?: string;
  text?: string;
  variant?: 'info' | 'warning' | 'error';
  dismissible?: boolean;
  visible: boolean;
  props?: Record<string, unknown>;
};

export type PluginModalDescriptor = {
  id: string;
  pluginName: string;
  component: string;
  title?: string;
  closeable: boolean;
  visible: boolean;
  props?: Record<string, unknown>;
};

export type PluginSettingsSectionDescriptor = {
  id: string;
  pluginName: string;
  label: string;
  component: string;
  priority?: number;
};

export type PluginRendererScript = {
  pluginName: string;
  scriptPath: string;
  /** The script source code, loaded by the plugin manager for safe delivery to the renderer */
  scriptContent?: string;
};

export type PluginUIState = {
  banners: PluginBannerDescriptor[];
  modals: PluginModalDescriptor[];
  settingsSections: PluginSettingsSectionDescriptor[];
  rendererScripts: PluginRendererScript[];
  requiredPluginsReady: boolean;
  brandRequiredPluginNames: string[];
};

/* ── PluginAPI (given to each plugin's activate()) ── */

export type PluginAPI = {
  pluginName: string;
  pluginDir: string;

  config: {
    get: () => AppConfig;
    set: (path: string, value: unknown) => void;
    getPluginData: () => Record<string, unknown>;
    setPluginData: (path: string, value: unknown) => void;
    onChanged: (callback: (config: AppConfig) => void) => () => void;
  };

  tools: {
    register: (tools: ToolDefinition[]) => void;
    unregister: (toolNames: string[]) => void;
  };

  messages: {
    registerPreSendHook: (hook: PreSendHook) => void;
    registerPostReceiveHook: (hook: PostReceiveHook) => void;
  };

  ui: {
    showBanner: (descriptor: Omit<PluginBannerDescriptor, 'pluginName'>) => void;
    hideBanner: (id: string) => void;
    showModal: (descriptor: Omit<PluginModalDescriptor, 'pluginName'>) => void;
    hideModal: (id: string) => void;
    updateModal: (id: string, updates: Partial<Omit<PluginModalDescriptor, 'id' | 'pluginName'>>) => void;
    registerSettingsSection: (descriptor: Omit<PluginSettingsSectionDescriptor, 'pluginName'>) => void;
  };

  log: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };

  shell: {
    openExternal: (url: string) => Promise<void>;
  };

  auth: {
    /**
     * Opens an in-app browser window for OAuth/authentication flows.
     * Navigates to `url`, intercepts redirects matching `callbackMatch` (substring match on URL),
     * extracts query parameters, shows a success/failure page, then resolves.
     *
     * @param options.url          The auth URL to navigate to
     * @param options.callbackMatch  Substring to match in redirect URLs (e.g., 'api_key=' or '/callback')
     * @param options.title        Window title (default: 'Sign In')
     * @param options.width        Window width (default: 620)
     * @param options.height       Window height (default: 720)
     * @param options.timeoutMs    Timeout in ms (default: 300000 = 5 min)
     * @param options.successMessage  HTML body shown on success
     * @param options.extractParams  List of query param names to extract (default: all)
     * @returns Resolved params or error
     */
    openAuthWindow: (options: PluginAuthWindowOptions) => Promise<PluginAuthResult>;
  };

  http: {
    listen: (port: number, handler: (req: PluginHttpRequest) => PluginHttpResponse | Promise<PluginHttpResponse>) => Promise<void>;
    close: () => Promise<void>;
  };

  /** Register a handler for actions sent from renderer UI (modal buttons, banner actions, etc.) */
  onAction: (targetId: string, handler: (action: string, data?: unknown) => void | Promise<void>) => void;

  fetch: typeof globalThis.fetch;
};

export type PluginHttpRequest = {
  method: string;
  url: string;
  headers: Record<string, string>;
  query: Record<string, string>;
  body?: string;
};

export type PluginHttpResponse = {
  status?: number;
  headers?: Record<string, string>;
  body?: string;
};

/* ── Modal/Banner Actions (renderer → main via IPC) ── */

export type PluginActionPayload = {
  pluginName: string;
  targetId: string;
  action: string;
  data?: unknown;
};

/* ── Auth Window Types ── */

export type PluginAuthWindowOptions = {
  url: string;
  callbackMatch: string;
  title?: string;
  width?: number;
  height?: number;
  timeoutMs?: number;
  successMessage?: string;
  extractParams?: string[];
};

export type PluginAuthResult = {
  success: boolean;
  params?: Record<string, string>;
  error?: string;
};
