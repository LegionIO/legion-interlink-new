import type { IpcMain } from 'electron';
import { readFileSync, writeFileSync, existsSync, watch, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { LegionConfig } from '../config/schema.js';
import { detectLegionRuntime } from '../agent/legion-runtime.js';
import { broadcastToAllWindows } from '../utils/window-send.js';

export type { LegionConfig } from '../config/schema.js';

export const LEGION_LLM_CONFIG_PATH = join(homedir(), '.legionio', 'settings', 'llm.json');
const DESKTOP_SETTINGS_FILENAME = 'desktop.json';
const DEFAULT_SYSTEM_PROMPT = 'You are Interlink, a powerful local AI assistant with access to the user\'s computer. You can execute shell commands, read/write files, search codebases, and connect to external services via MCP. Be proactive, thorough, and helpful. When executing tools, explain what you\'re doing and why.';
const LEGACY_DEFAULT_SYSTEM_PROMPTS = new Set([
  'You are Aithena, a powerful local AI assistant with access to the user\'s computer. You can execute shell commands, read/write files, search codebases, and connect to external services via MCP. Be proactive, thorough, and helpful. When executing tools, explain what you\'re doing and why.',
  'You are Legion Aithena, a powerful local AI assistant with access to the user\'s computer. You can execute shell commands, read/write files, search codebases, and connect to external services via MCP. Be proactive, thorough, and helpful. When executing tools, explain what you\'re doing and why.',
  'You are Legion Interlink, a powerful local AI assistant with access to the user\'s computer. You can execute shell commands, read/write files, search codebases, and connect to external services via MCP. Be proactive, thorough, and helpful. When executing tools, explain what you\'re doing and why.',
  'You are Legion, a powerful local AI assistant with access to the user\'s computer. You can execute shell commands, read/write files, search codebases, and connect to external services via MCP. Be proactive, thorough, and helpful. When executing tools, explain what you\'re doing and why.',
]);

export function getDesktopSettingsPath(legionHome: string): string {
  return join(legionHome, 'settings', DESKTOP_SETTINGS_FILENAME);
}

function getDefaultConfig() {
  return {
    models: {
      defaultModelKey: 'placeholder',
      providers: {},
      catalog: [],
    },
    runtime: {
      agentBackend: 'mastra' as const,
      legion: {
        rootPath: '',
        configDir: '',
        daemonUrl: 'http://127.0.0.1:4567',
        rubyPath: '',
      },
    },
    memory: {
      enabled: true,
      workingMemory: { enabled: true, scope: 'resource' as const },
      observationalMemory: { enabled: true, scope: 'resource' as const },
      semanticRecall: {
        enabled: true,
        topK: 4,
        scope: 'resource' as const,
        embeddingProvider: {
          type: 'azure' as const,
          model: 'text-embedding-3-small',
        },
      },
      lastMessages: 10,
    },
    compaction: {
      tool: {
        enabled: true,
        useAI: true,
        triggerTokens: 5000,
        outputMaxTokens: 5000,
        truncateMinChars: 1000,
        truncateHeadRatio: 0.7,
        truncateMinTailChars: 300,
      },
      conversation: {
        enabled: true,
        mode: 'mastra-observational-memory' as const,
        triggerPercent: 0.8,
        ignoreRecentUserMessages: 5,
        ignoreRecentAssistantMessages: 5,
        outputMaxTokens: 1200,
        promptReserveTokens: 1500,
      },
    },
    tools: {
      shell: {
        enabled: true,
        timeout: 30000,
        allowPatterns: ['*'],
        denyPatterns: ['rm -rf /', 'mkfs', 'dd if='],
      },
      fileAccess: {
        enabled: true,
        allowPaths: ['~'],
        denyPaths: [],
      },
      processStreaming: {
        enabled: true,
        updateIntervalMs: 250,
        modelFeedMode: 'incremental' as const,
        maxOutputBytes: 120000,
        truncationMode: 'head-tail' as const,
        stopAfterMax: true,
        headTailRatio: 0.7,
        observer: {
          enabled: true,
          intervalMs: 3000,
          maxSnapshotChars: 5000,
          maxMessagesPerTool: 100,
          maxTotalLaunchedTools: 10,
        },
      },
      subAgents: {
        enabled: true,
        maxDepth: 3,
        maxConcurrent: 4,
        maxPerParent: 2,
      },
    },
    mcpServers: [] as Array<{ name: string; command?: string; args?: string[]; url?: string; env?: Record<string, string> }>,
    skills: {
      directory: '~/.legionio/skills',
      enabled: [] as string[],
    },
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    plugins: {} as Record<string, Record<string, unknown>>,
    pluginApprovals: {} as Record<string, { hash: string; approvedAt: string }>,
    ui: {
      theme: 'system' as const,
      sidebarWidth: 280,
    },
    audio: {
      provider: 'native' as const,
      azure: {
        region: 'eastus',
        ttsVoice: 'en-US-JennyNeural',
        ttsOutputFormat: 'audio-24khz-48kbitrate-mono-mp3',
        ttsRate: 1,
        sttLanguage: 'en-US',
      },
      tts: { enabled: true, rate: 1 },
      dictation: { enabled: true, language: 'en-US', continuous: true },
    },
    realtime: {
      enabled: true,
      provider: 'azure' as const,
      model: 'gpt-4o-realtime-preview',
      voice: 'alloy',
      turnDetection: { type: 'server_vad' as const, threshold: 0.5, silenceDurationMs: 500 },
      inputAudioTranscription: true,
      autoEndCall: { enabled: true, silenceTimeoutSec: 60 },
      memoryContext: {
        enabled: true,
        maxTokens: 8000,
        conversationHistory: { enabled: true, maxMessages: 20 },
        workingMemory: { enabled: true },
        semanticRecall: { enabled: false, topK: 3 },
        observationalMemory: { enabled: true },
      },
      computerUseUpdates: {
        enabled: true,
        throttleMs: 3000,
        onStepCompleted: true,
        onStepFailed: true,
        onCheckpoint: true,
        onApprovalNeeded: true,
        onGuidanceReceived: true,
        onSessionCompleted: true,
        onSessionFailed: true,
      },
    },
    computerUse: {
      enabled: true,
      showStepLog: true,
      toolSurface: 'both' as const,
      defaultSurface: 'docked' as const,
      defaultTarget: 'isolated-browser' as const,
      approvalModeDefault: 'step' as const,
      idleTimeoutSec: 180,
      postActionDelayMs: 300,
      maxSessionDurationMin: 45,
      models: {},
      capture: {
        maxDimension: 1920,
        jpegQuality: 0.8,
      },
      safety: {
        pauseOnTerminal: true,
        manualTakeoverPauses: true,
      },
      localMacos: {
        autoRequestPermissions: true,
        autoOpenPrivacySettings: true,
        allowedDisplays: [],
        captureExcludedApps: ['Electron'],
      },
      overlay: {
        enabled: true,
        position: 'top' as const,
        heightPx: 120,
        opacity: 0.75,
      },
    },
    advanced: {
      temperature: 0.4,
      maxSteps: 10,
      maxRetries: 4,
      useResponsesApi: false,
    },
    titleGeneration: {
      enabled: true,
      retitleIntervalMessages: 5,
      retitleEagerUntilMessage: 5,
    },
    profiles: [] as Array<{
      key: string;
      name: string;
      primaryModelKey: string;
      fallbackModelKeys: string[];
      systemPrompt?: string;
      temperature?: number;
      maxSteps?: number;
      maxRetries?: number;
      useResponsesApi?: boolean;
      reasoningEffort?: string;
    }>,
    defaultProfileKey: undefined as string | undefined,
    fallback: {
      enabled: false,
      modelKeys: [] as string[],
    },
    knowledge: {
      ragEnabled: true,
      captureEnabled: false,
      scope: 'all' as const,
    },
  };
}

function applyRuntimeDefaults(config: LegionConfig, legionHome: string): LegionConfig {
  const detected = detectLegionRuntime(config, legionHome);
  const currentRuntime = config.runtime ?? {
    agentBackend: 'mastra',
    legion: {
      rootPath: '',
      configDir: '',
      daemonUrl: '',
      rubyPath: '',
    },
  };

  return {
    ...config,
    runtime: {
      ...currentRuntime,
      legion: {
        ...currentRuntime.legion,
        rootPath: currentRuntime.legion?.rootPath || '',
        configDir: currentRuntime.legion?.configDir || detected.configDir,
        daemonUrl: currentRuntime.legion?.daemonUrl || detected.daemonUrl,
        rubyPath: currentRuntime.legion?.rubyPath || detected.rubyPath,
      },
    },
  };
}

type LegionProviderType = 'anthropic' | 'openai' | 'gemini' | 'bedrock' | 'ollama';

type LegionProviderConfig = {
  enabled?: boolean;
  api_key?: string | null;
  openai_api_key?: string | null;
  base_url?: string | null;
  region?: string | null;
  bearer_token?: string | null;
  default_model?: string | null;
  small_model?: string | null;
  medium_model?: string | null;
  large_model?: string | null;
};

type LegionLlmFile = {
  llm?: {
    enabled?: boolean;
    default_provider?: LegionProviderType | null;
    default_model?: string | null;
    providers?: Partial<Record<LegionProviderType, LegionProviderConfig>>;
  };
};

const OPENAI_FALLBACK_MODELS = [
  'gpt-5.4',
  'gpt-5.4-pro',
  'gpt-4.1',
  'gpt-4.1-mini',
] as const;

function toTitleCase(value: string): string {
  return value
    .split(/[\s_:-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatModelDisplayName(value: string): string {
  const uppercaseTokens = new Set(['gpt', 'ai', 'aws', 'api', 'ui', 'ux']);
  const cleaned = value
    .replace(/\b(\d+)\s+(\d+)\b/g, '$1.$2')
    .replace(/[-_:/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return value;

  return cleaned
    .split(' ')
    .filter(Boolean)
    .map((part) => {
      const lower = part.toLowerCase();
      if (uppercaseTokens.has(lower)) return lower.toUpperCase();
      if (/^\d+(\.\d+)*$/.test(part)) return part;
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join('-');
}

function inferDisplayName(modelName: string): string {
  const normalized = modelName
    .replace(/^[a-z]{2}(?=[.:/_-])/i, '')
    .replace(/^[.:/_-]+/, '')
    .replace(/^(anthropic|openai|google|gemini|bedrock|amazon|aws)(?=[.:/_-])/i, '')
    .replace(/^[.:/_-]+/, '');

  const cleaned = normalized
    .replace(/[.:/_-]/g, ' ')
    .replace(/\b(v\d+)\b/gi, '')
    .replace(/\b\d{8}\b/g, '')
    .replace(/\b(\d+)\s+(\d+)\b/g, '$1.$2')
    .replace(/\s+/g, ' ')
    .trim();
  return formatModelDisplayName(toTitleCase(cleaned || normalized || modelName));
}

function defaultLegionConfig(): LegionLlmFile {
  return {
    llm: {
      enabled: true,
      default_provider: 'bedrock',
      default_model: null,
      providers: {
        anthropic: { enabled: false, api_key: null },
        openai: { enabled: false, api_key: null, openai_api_key: null },
        gemini: { enabled: false, api_key: null },
        bedrock: {
          enabled: false,
          region: 'us-east-1',
          bearer_token: null,
          default_model: null,
          small_model: null,
          medium_model: null,
          large_model: null,
        },
        ollama: { enabled: false, base_url: 'http://localhost:11434' },
      },
    },
  };
}

function readLegionLlmConfig(): LegionLlmFile {
  if (!existsSync(LEGION_LLM_CONFIG_PATH)) {
    return defaultLegionConfig();
  }

  try {
    return deepMerge(defaultLegionConfig() as Record<string, unknown>, JSON.parse(readFileSync(LEGION_LLM_CONFIG_PATH, 'utf-8'))) as LegionLlmFile;
  } catch (error) {
    console.error('[Config] Failed to parse Legion LLM config, using defaults:', error);
    return defaultLegionConfig();
  }
}

function writeLegionLlmConfig(config: LegionLlmFile): void {
  writeFileSync(LEGION_LLM_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

function toLegionProvider(providerKey: LegionProviderType, provider: LegionProviderConfig | undefined): Record<string, unknown> {
  const enabled = provider?.enabled ?? false;

  if (providerKey === 'bedrock') {
    return {
      type: 'amazon-bedrock',
      enabled,
      region: provider?.region ?? '',
      apiKey: provider?.bearer_token ?? '',
    };
  }

  if (providerKey === 'anthropic') {
    return {
      type: 'anthropic',
      enabled,
      apiKey: provider?.api_key ?? '',
    };
  }

  if (providerKey === 'openai') {
    return {
      type: 'openai-compatible',
      enabled,
      apiKey: provider?.api_key ?? provider?.openai_api_key ?? '',
      endpoint: provider?.base_url ?? '',
    };
  }

  if (providerKey === 'gemini') {
    return {
      type: 'google',
      enabled,
      apiKey: provider?.api_key ?? '',
    };
  }

  return {
    type: 'openai-compatible',
    enabled,
    endpoint: provider?.base_url ?? 'http://localhost:11434',
  };
}

function collectProviderModelNames(provider: LegionProviderConfig | undefined): string[] {
  return [
    provider?.default_model,
    provider?.small_model,
    provider?.medium_model,
    provider?.large_model,
  ].filter((value, index, array): value is string => Boolean(value?.trim()) && array.indexOf(value) === index);
}

function hasProviderCredentials(providerKey: LegionProviderType, provider: LegionProviderConfig | undefined): boolean {
  if (!provider?.enabled) return false;
  if (providerKey === 'bedrock') {
    return Boolean(provider.bearer_token?.trim() || provider.region?.trim());
  }
  return Boolean(provider.api_key?.trim() || provider.openai_api_key?.trim());
}

function resolveProviderModelNames(
  providerKey: LegionProviderType,
  provider: LegionProviderConfig | undefined,
): string[] {
  const explicit = collectProviderModelNames(provider);
  if (explicit.length > 0) return explicit;
  if (providerKey === 'openai' && hasProviderCredentials(providerKey, provider)) {
    return [...OPENAI_FALLBACK_MODELS];
  }
  return explicit;
}

function toCatalogEntries(providerKey: LegionProviderType, provider: LegionProviderConfig | undefined): Array<Record<string, unknown>> {
  return resolveProviderModelNames(providerKey, provider).map((modelName) => ({
    key: modelName,
    displayName: inferDisplayName(modelName),
    provider: providerKey,
    modelName,
  }));
}

function loadLegionModelsConfig(defaults: LegionConfig['models']): LegionConfig['models'] {
  try {
    const raw = readLegionLlmConfig();
    const llm = raw.llm;
    if (!llm?.enabled) {
      return defaults;
    }

    const legionProviders = llm.providers ?? {};
    const providers: Record<string, Record<string, unknown>> = {};
    const catalog: Array<Record<string, unknown>> = [];
    const providerOrder: LegionProviderType[] = ['anthropic', 'openai', 'gemini', 'bedrock', 'ollama'];

    // Start with any providers/catalog already in defaults (e.g. from desktop.json plugin data)
    // These are providers not managed by llm.json (like plugin-contributed providers)
    const llmProviderKeys = new Set<string>(providerOrder);

    for (const [key, value] of Object.entries(defaults.providers ?? {})) {
      if (!llmProviderKeys.has(key)) {
        providers[key] = value as Record<string, unknown>;
      }
    }
    for (const entry of defaults.catalog ?? []) {
      if (!llmProviderKeys.has(entry.provider)) {
        catalog.push(entry);
      }
    }

    // Layer llm.json providers/catalog on top
    for (const providerKey of providerOrder) {
      const provider = legionProviders[providerKey];
      providers[providerKey] = toLegionProvider(providerKey, provider);
      catalog.push(...toCatalogEntries(providerKey, provider));
    }

    const preferredDefaultModel = llm.default_model ?? undefined;
    const hasPreferredDefault = preferredDefaultModel
      ? catalog.some((entry) => entry.key === preferredDefaultModel)
      : false;
    const defaultModelKey = hasPreferredDefault
      ? preferredDefaultModel!
      : defaults.defaultModelKey !== 'placeholder'
        ? defaults.defaultModelKey
        : (catalog[0]?.key as string | undefined) ?? defaults.defaultModelKey;

    return {
      defaultModelKey,
      providers: providers as LegionConfig['models']['providers'],
      catalog: catalog as LegionConfig['models']['catalog'],
    };
  } catch (error) {
    console.error('[Config] Failed to parse Legion LLM config, using empty model catalog:', error);
    return defaults;
  }
}

function getModelNameByKey(catalog: LegionConfig['models']['catalog'], key: string): string | null {
  const entry = catalog.find((model) => model.key === key);
  return entry?.modelName ?? null;
}

function updateLegionProviderModelSlots(
  provider: LegionProviderConfig,
  modelNames: string[],
  preferredDefaultModelName?: string | null,
): void {
  const ordered = preferredDefaultModelName
    ? [preferredDefaultModelName, ...modelNames.filter((name) => name !== preferredDefaultModelName)]
    : [...modelNames];

  provider.default_model = ordered[0] ?? null;
  provider.small_model = ordered[1] ?? null;
  provider.medium_model = ordered[2] ?? null;
  provider.large_model = ordered[3] ?? null;
}

export function persistLegionModelsToLegion(
  path: string,
  value: unknown,
  currentConfig: LegionConfig,
): void {
  const legionConfig = readLegionLlmConfig();
  const llm = legionConfig.llm ?? (legionConfig.llm = defaultLegionConfig().llm!);
  const providers = llm.providers ?? (llm.providers = {});
  const providerOrder: LegionProviderType[] = ['anthropic', 'openai', 'gemini', 'bedrock', 'ollama'];

  for (const providerKey of providerOrder) {
    providers[providerKey] ??= {};
  }

  if (path === 'models.defaultModelKey') {
    const modelKey = String(value);
    const entry = currentConfig.models.catalog.find((model) => model.key === modelKey);
    llm.default_model = entry?.modelName ?? getModelNameByKey(currentConfig.models.catalog, modelKey) ?? modelKey;
    if (entry && providerOrder.includes(entry.provider as LegionProviderType)) {
      llm.default_provider = entry.provider as LegionProviderType;
    }
    writeLegionLlmConfig(legionConfig);
    return;
  }

  if (path.startsWith('models.providers.')) {
    const [, , providerKey, field] = path.split('.');
    if (!providerOrder.includes(providerKey as LegionProviderType) || !field) return;

    const provider = providers[providerKey as LegionProviderType] ?? {};
    const stringValue = typeof value === 'string' ? value : String(value ?? '');

    if (field === 'enabled') {
      provider.enabled = Boolean(value);
    } else if (field === 'apiKey') {
      if (providerKey === 'bedrock') provider.bearer_token = stringValue || null;
      else if (providerKey === 'openai') {
        provider.api_key = stringValue || null;
        provider.openai_api_key = stringValue || null;
      } else {
        provider.api_key = stringValue || null;
      }
    } else if (field === 'endpoint') {
      provider.base_url = stringValue || null;
    } else if (field === 'region' && providerKey === 'bedrock') {
      provider.region = stringValue || null;
    }

    providers[providerKey as LegionProviderType] = provider;
    writeLegionLlmConfig(legionConfig);
    return;
  }

  if (path === 'models.catalog') {
    const catalog = Array.isArray(value) ? value as LegionConfig['models']['catalog'] : currentConfig.models.catalog;
    const defaultModelName = getModelNameByKey(catalog, currentConfig.models.defaultModelKey)
      ?? llm.default_model
      ?? null;
    const defaultProvider = catalog.find((model) => model.key === currentConfig.models.defaultModelKey)?.provider
      ?? llm.default_provider
      ?? null;

    for (const providerKey of providerOrder) {
      const providerCatalog = catalog
        .filter((entry) => entry.provider === providerKey)
        .map((entry) => entry.modelName);
      const provider = providers[providerKey] ?? {};
      const preferredDefault = defaultProvider === providerKey ? defaultModelName : null;
      updateLegionProviderModelSlots(provider, providerCatalog, preferredDefault);
      providers[providerKey] = provider;
    }

    if (defaultProvider && providerOrder.includes(defaultProvider as LegionProviderType)) {
      llm.default_provider = defaultProvider as LegionProviderType;
    }
    llm.default_model = defaultModelName;
    writeLegionLlmConfig(legionConfig);
  }
}

function applyExternalModelConfig(config: LegionConfig, legionHome: string): LegionConfig {
  return applyRuntimeDefaults({
    ...config,
    models: loadLegionModelsConfig(config.models),
  }, legionHome);
}

export function desktopConfigPayload(config: LegionConfig): Record<string, unknown> {
  return {
    models: config.models,
    runtime: config.runtime,
    memory: config.memory,
    compaction: config.compaction,
    tools: config.tools,
    mcpServers: config.mcpServers,
    skills: config.skills,
    systemPrompt: config.systemPrompt,
    plugins: config.plugins,
    pluginApprovals: config.pluginApprovals,
    ui: config.ui,
    audio: config.audio,
    realtime: config.realtime,
    computerUse: config.computerUse,
    advanced: config.advanced,
    titleGeneration: config.titleGeneration,
    profiles: config.profiles,
    defaultProfileKey: config.defaultProfileKey,
    fallback: config.fallback,
  };
}

export function readEffectiveConfig(legionHome: string): LegionConfig {
  const configPath = getDesktopSettingsPath(legionHome);
  const defaults = getDefaultConfig();

  if (existsSync(configPath)) {
    try {
      const raw = JSON.parse(readFileSync(configPath, 'utf-8'));
      return migrateLegacySystemPrompt(applyExternalModelConfig(deepMerge(defaults, raw) as LegionConfig, legionHome));
    } catch (error) {
      console.error('[Config] Failed to parse desktop.json, using defaults:', error);
      return migrateLegacySystemPrompt(applyExternalModelConfig(defaults as unknown as LegionConfig, legionHome));
    }
  }

  return migrateLegacySystemPrompt(applyExternalModelConfig(defaults as unknown as LegionConfig, legionHome));
}

function migrateLegacySystemPrompt(config: LegionConfig): LegionConfig {
  if (LEGACY_DEFAULT_SYSTEM_PROMPTS.has(config.systemPrompt)) {
    return { ...config, systemPrompt: DEFAULT_SYSTEM_PROMPT };
  }
  return config;
}

export function writeDesktopConfig(legionHome: string, config: LegionConfig): void {
  const configPath = getDesktopSettingsPath(legionHome);
  mkdirSync(join(legionHome, 'settings'), { recursive: true });
  writeFileSync(configPath, JSON.stringify(desktopConfigPayload(config), null, 2), 'utf-8');
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      target[key] &&
      typeof target[key] === 'object' &&
      !Array.isArray(target[key])
    ) {
      result[key] = deepMerge(target[key] as Record<string, unknown>, source[key] as Record<string, unknown>);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

export function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!current[key] || typeof current[key] !== 'object') {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  current[keys[keys.length - 1]] = value;
}

export function registerConfigHandlers(
  ipcMain: IpcMain,
  legionHome: string,
  onChanged?: (config: LegionConfig) => void,
): { setConfig: (path: string, value: unknown) => void } {
  let currentConfig = readEffectiveConfig(legionHome);
  let lastBroadcastSnapshot = JSON.stringify(currentConfig);

  // Watch for external config changes
  const configPath = getDesktopSettingsPath(legionHome);
  let reloadDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let broadcastTimer: ReturnType<typeof setTimeout> | null = null;

  const flushConfigBroadcast = () => {
    broadcastTimer = null;
    const snapshot = JSON.stringify(currentConfig);
    if (snapshot === lastBroadcastSnapshot) return;

    lastBroadcastSnapshot = snapshot;
    broadcastToAllWindows('config:changed', currentConfig);
    onChanged?.(currentConfig);
  };

  const scheduleConfigBroadcast = () => {
    if (broadcastTimer) return;
    broadcastTimer = setTimeout(flushConfigBroadcast, 25);
  };

  const reloadConfig = () => {
    if (reloadDebounceTimer) clearTimeout(reloadDebounceTimer);
    reloadDebounceTimer = setTimeout(() => {
      try {
        currentConfig = readEffectiveConfig(legionHome);
        scheduleConfigBroadcast();
      } catch {
        // Ignore read errors during write
      }
    }, 200);
  };

  if (existsSync(configPath)) {
    watch(configPath, reloadConfig);
  }
  if (existsSync(LEGION_LLM_CONFIG_PATH)) {
    watch(LEGION_LLM_CONFIG_PATH, reloadConfig);
  }

  // Unified setConfig that handles models.* persistence correctly.
  // Used by both the IPC handler and the plugin system.
  const llmProviderKeys = new Set(['anthropic', 'openai', 'gemini', 'bedrock', 'ollama']);

  const setConfigImpl = (path: string, value: unknown): void => {
    if (path === 'models') {
      currentConfig = readEffectiveConfig(legionHome);
      scheduleConfigBroadcast();
      return;
    }

    if (path.startsWith('models.')) {
      // Always persist to desktop.json (covers plugin-contributed providers/catalog)
      setNestedValue(currentConfig as unknown as Record<string, unknown>, path, value);
      writeDesktopConfig(legionHome, currentConfig);

      // Also persist to llm.json for built-in provider paths
      if (path === 'models.defaultModelKey' || path === 'models.catalog') {
        persistLegionModelsToLegion(path, value, currentConfig);
      } else if (path.startsWith('models.providers.')) {
        const providerKey = path.split('.')[2];
        if (llmProviderKeys.has(providerKey)) {
          persistLegionModelsToLegion(path, value, currentConfig);
        }
      }

      currentConfig = readEffectiveConfig(legionHome);
      scheduleConfigBroadcast();
      return;
    }

    setNestedValue(currentConfig as unknown as Record<string, unknown>, path, value);
    writeDesktopConfig(legionHome, currentConfig);
    currentConfig = readEffectiveConfig(legionHome);
    scheduleConfigBroadcast();
  };

  ipcMain.handle('config:get', () => {
    return currentConfig;
  });

  ipcMain.handle('config:auto-detect-runtime', () => {
    const detected = detectLegionRuntime(currentConfig, legionHome);
    return detected;
  });

  ipcMain.handle('config:set', (_event, path: string, value: unknown) => {
    setConfigImpl(path, value);
    return currentConfig;
  });

  ipcMain.handle('platform:homedir', () => legionHome);

  return { setConfig: setConfigImpl };
}
