import type { AppConfig } from '../config/schema.js';
import type { ComputerUseSupport, ComputerUseTarget } from '../../shared/computer-use.js';

export type LLMProviderType = 'openai-compatible' | 'anthropic' | 'amazon-bedrock' | 'google';

export type LLMModelConfig = {
  provider: LLMProviderType;
  endpoint: string;
  apiKey: string;
  apiVersion?: string;
  deploymentName?: string;
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  awsProfile?: string;
  roleArn?: string;
  modelName: string;
  maxInputTokens?: number;
  useResponsesApi?: boolean;
  extraHeaders?: Record<string, string>;
  temperature: number;
  maxSteps?: number;
  maxRetries?: number;
};

export type ModelCatalogEntry = {
  key: string;
  displayName: string;
  modelConfig: LLMModelConfig;
  computerUseSupport?: ComputerUseSupport;
  visionCapable?: boolean;
  preferredTarget?: ComputerUseTarget;
};

export function resolveModelCatalog(config: AppConfig): {
  entries: ModelCatalogEntry[];
  defaultEntry: ModelCatalogEntry | null;
  byKey: Map<string, ModelCatalogEntry>;
} {
  const entries: ModelCatalogEntry[] = [];
  const byKey = new Map<string, ModelCatalogEntry>();

  for (const model of config.models.catalog) {
    const providerConfig = config.models.providers[model.provider];
    if (!providerConfig) continue;
    if (providerConfig.enabled === false) continue;

    const modelConfig: LLMModelConfig = {
      provider: providerConfig.type,
      endpoint: providerConfig.endpoint ?? '',
      apiKey: providerConfig.apiKey ?? '',
      useResponsesApi: model.useResponsesApi ?? providerConfig.useResponsesApi,
      apiVersion: providerConfig.apiVersion,
      region: providerConfig.region,
      accessKeyId: providerConfig.accessKeyId,
      secretAccessKey: providerConfig.secretAccessKey,
      sessionToken: providerConfig.sessionToken,
      awsProfile: providerConfig.awsProfile,
      roleArn: providerConfig.roleArn,
      extraHeaders: providerConfig.extraHeaders,
      deploymentName: model.deploymentName,
      modelName: model.modelName,
      maxInputTokens: model.maxInputTokens,
      temperature: config.advanced.temperature,
      maxSteps: config.advanced.maxSteps,
      maxRetries: config.advanced.maxRetries,
    };

    const entry: ModelCatalogEntry = {
      key: model.key,
      displayName: model.displayName,
      modelConfig,
      computerUseSupport: model.computerUseSupport,
      visionCapable: model.visionCapable,
      preferredTarget: model.preferredTarget,
    };

    entries.push(entry);
    byKey.set(model.key, entry);
  }

  const defaultEntry = byKey.get(config.models.defaultModelKey) ?? entries[0] ?? null;

  return { entries, defaultEntry, byKey };
}

export function resolveModelForThread(
  config: AppConfig,
  threadModelKey: string | null,
): ModelCatalogEntry | null {
  const catalog = resolveModelCatalog(config);
  if (threadModelKey && catalog.byKey.has(threadModelKey)) {
    return catalog.byKey.get(threadModelKey)!;
  }
  return catalog.defaultEntry;
}

export type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh';

export type ResolvedStreamConfig = {
  primaryModel: ModelCatalogEntry;
  fallbackModels: ModelCatalogEntry[];
  fallbackEnabled: boolean;
  systemPrompt: string;
  temperature: number;
  maxSteps: number;
  maxRetries: number;
  useResponsesApi: boolean;
  reasoningEffort?: ReasoningEffort;
  profileKey?: string;
};

export function resolveStreamConfig(
  config: AppConfig,
  opts: {
    threadModelKey: string | null;
    threadProfileKey: string | null;
    reasoningEffort?: ReasoningEffort;
    fallbackEnabled: boolean;
  },
): ResolvedStreamConfig | null {
  const catalog = resolveModelCatalog(config);

  // 1. Find active profile: conversation → global default → none
  const profileKey = opts.threadProfileKey ?? config.defaultProfileKey ?? null;
  const profile = profileKey
    ? (config.profiles ?? []).find((p) => p.key === profileKey)
    : undefined;

  // 2. Resolve primary model: manual override → profile → global default
  const primaryModelKey = opts.threadModelKey
    ?? profile?.primaryModelKey
    ?? config.models.defaultModelKey;
  const primaryModel = catalog.byKey.get(primaryModelKey) ?? catalog.defaultEntry;
  if (!primaryModel) return null;

  // 3. Resolve fallback chain (profile fallbacks → global fallback)
  const fallbackKeys = profile?.fallbackModelKeys
    ?? config.fallback?.modelKeys
    ?? [];
  const fallbackModels = fallbackKeys
    .filter((k) => k !== primaryModelKey)
    .map((k) => catalog.byKey.get(k))
    .filter((e): e is ModelCatalogEntry => e != null);

  // 4. Merge parameters: profile overrides → global
  const temperature = profile?.temperature ?? config.advanced.temperature;
  const maxSteps = profile?.maxSteps ?? config.advanced.maxSteps;
  const maxRetries = profile?.maxRetries ?? config.advanced.maxRetries;
  const profileUseResponsesApi = profile?.useResponsesApi;
  const useResponsesApi = profileUseResponsesApi ?? primaryModel.modelConfig.useResponsesApi ?? config.advanced.useResponsesApi;
  const systemPrompt = profile?.systemPrompt?.trim() || config.systemPrompt;
  const reasoningEffort = opts.reasoningEffort ?? profile?.reasoningEffort as ReasoningEffort | undefined;

  // 5. Apply merged parameters to model configs (cloned so we don't mutate catalog)
  // For useResponsesApi, precedence is: profile explicit > model/provider default > global default.
  const applyOverrides = (entry: ModelCatalogEntry): ModelCatalogEntry => ({
    key: entry.key,
    displayName: entry.displayName,
    modelConfig: {
      ...entry.modelConfig,
      temperature,
      maxSteps,
      maxRetries,
      useResponsesApi: profileUseResponsesApi ?? entry.modelConfig.useResponsesApi ?? config.advanced.useResponsesApi,
    },
  });

  return {
    primaryModel: applyOverrides(primaryModel),
    fallbackModels: fallbackModels.map(applyOverrides),
    fallbackEnabled: opts.fallbackEnabled && fallbackModels.length > 0,
    systemPrompt,
    temperature,
    maxSteps,
    maxRetries,
    useResponsesApi,
    reasoningEffort,
    profileKey: profile?.key,
  };
}
