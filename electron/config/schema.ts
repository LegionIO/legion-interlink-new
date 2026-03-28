import { z } from 'zod';

const computerUseSupportSchema = z.enum([
  'openai-responses',
  'anthropic-client-tool',
  'gemini-computer-use',
  'custom',
  'none',
]);

const computerUseTargetSchema = z.enum(['isolated-browser', 'local-macos']);

const computerUseSurfaceSchema = z.enum(['docked', 'window']);

const computerUseApprovalModeSchema = z.enum(['step', 'goal', 'autonomous']);

const computerUseToolSurfaceSchema = z.enum(['both', 'only-calls', 'only-chat', 'none']);

const providerSchema = z.object({
  type: z.enum(['openai-compatible', 'anthropic', 'amazon-bedrock', 'google']),
  enabled: z.boolean().optional(),
  endpoint: z.string().optional(),
  apiKey: z.string().optional(),
  apiVersion: z.string().optional(),
  region: z.string().optional(),
  accessKeyId: z.string().optional(),
  secretAccessKey: z.string().optional(),
  sessionToken: z.string().optional(),
  awsProfile: z.string().optional(),
  roleArn: z.string().optional(),
  extraHeaders: z.record(z.string()).optional(),
});

const modelEntrySchema = z.object({
  key: z.string(),
  displayName: z.string(),
  provider: z.string(),
  modelName: z.string(),
  deploymentName: z.string().optional(),
  maxInputTokens: z.number().positive().optional(),
  useResponsesApi: z.boolean().optional(),
  computerUseSupport: computerUseSupportSchema.optional(),
  visionCapable: z.boolean().optional(),
  preferredTarget: computerUseTargetSchema.optional(),
});

const modelsConfigSchema = z.object({
  defaultModelKey: z.string(),
  providers: z.record(providerSchema),
  catalog: z.array(modelEntrySchema),
});

const embeddingProviderSchema = z.object({
  type: z.enum(['openai', 'azure', 'custom']),
  model: z.string().optional(),           // e.g. "text-embedding-3-small"
  openai: z.object({
    apiKey: z.string().optional(),
  }).optional(),
  azure: z.object({
    endpoint: z.string().optional(),      // e.g. "https://myresource.openai.azure.com"
    apiKey: z.string().optional(),
    deploymentName: z.string().optional(), // e.g. "text-embedding-3-small"
    apiVersion: z.string().optional(),     // e.g. "2024-02-01"
  }).optional(),
  custom: z.object({
    baseUrl: z.string().optional(),       // Any OpenAI-compatible embeddings endpoint
    apiKey: z.string().optional(),
  }).optional(),
});

const memoryConfigSchema = z.object({
  enabled: z.boolean(),
  workingMemory: z.object({
    enabled: z.boolean(),
    scope: z.enum(['thread', 'resource']),
    template: z.string().optional(),
  }),
  observationalMemory: z.object({
    enabled: z.boolean(),
    scope: z.enum(['thread', 'resource']),
    deploymentName: z.string().optional(),
  }),
  semanticRecall: z.object({
    enabled: z.boolean(),
    topK: z.number().positive(),
    scope: z.enum(['thread', 'resource']),
    embeddingDeploymentName: z.string().optional(), // legacy — kept for backward compat
    embeddingProvider: embeddingProviderSchema.optional(),
  }),
  lastMessages: z.number().positive(),
});

const toolCompactionSchema = z.object({
  enabled: z.boolean(),
  useAI: z.boolean(),
  triggerTokens: z.number().positive(),
  outputMaxTokens: z.number().positive(),
  truncateMinChars: z.number().positive(),
  truncateHeadRatio: z.number().min(0).max(1),
  truncateMinTailChars: z.number().positive(),
});

const conversationCompactionSchema = z.object({
  enabled: z.boolean(),
  mode: z.enum(['legacy-summary', 'mastra-observational-memory']),
  triggerPercent: z.number().min(0).max(1),
  ignoreRecentUserMessages: z.number().nonnegative(),
  ignoreRecentAssistantMessages: z.number().nonnegative(),
  outputMaxTokens: z.number().positive(),
  promptReserveTokens: z.number().positive(),
  contextWindowTokens: z.number().positive().optional(),
});

const shellGuardrailsSchema = z.object({
  enabled: z.boolean(),
  timeout: z.number().positive(),
  allowPatterns: z.array(z.string()),
  denyPatterns: z.array(z.string()),
  requireConfirmation: z.boolean().optional(),
});

const fileAccessSchema = z.object({
  enabled: z.boolean(),
  allowPaths: z.array(z.string()),
  denyPaths: z.array(z.string()),
});

const processStreamingSchema = z.object({
  enabled: z.boolean(),
  updateIntervalMs: z.number().positive(),
  modelFeedMode: z.enum(['incremental', 'final-only']),
  maxOutputBytes: z.number().positive(),
  truncationMode: z.enum(['head', 'tail', 'head-tail']),
  stopAfterMax: z.boolean(),
  headTailRatio: z.number().min(0).max(1),
  observer: z.object({
    enabled: z.boolean(),
    intervalMs: z.number().positive(),
    maxSnapshotChars: z.number().positive(),
    maxMessagesPerTool: z.number().positive(),
    maxTotalLaunchedTools: z.number().positive(),
  }),
});

const mcpServerSchema = z.object({
  name: z.string(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  url: z.string().optional(),
  env: z.record(z.string()).optional(),
  enabled: z.boolean().optional(),
});

const subAgentConfigSchema = z.object({
  enabled: z.boolean(),
  maxDepth: z.number().positive().max(10),
  maxConcurrent: z.number().positive().max(20),
  maxPerParent: z.number().positive().max(10),
  defaultModel: z.string().optional(),
});

const titleGenerationSchema = z.object({
  enabled: z.boolean(),
  retitleIntervalMessages: z.number().positive(),
  retitleEagerUntilMessage: z.number().nonnegative(),
});

const legionRuntimeSchema = z.object({
  rootPath: z.string(),
  configDir: z.string(),
  daemonUrl: z.string(),
  rubyPath: z.string(),
  daemonStreaming: z.boolean().optional(),
});

const runtimeConfigSchema = z.object({
  agentBackend: z.enum(['mastra', 'legion-daemon']),
  legion: legionRuntimeSchema,
});

const profileConfigSchema = z.object({
  key: z.string(),
  name: z.string(),
  primaryModelKey: z.string(),
  fallbackModelKeys: z.array(z.string()),
  systemPrompt: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxSteps: z.number().positive().optional(),
  maxRetries: z.number().nonnegative().optional(),
  useResponsesApi: z.boolean().optional(),
  reasoningEffort: z.enum(['low', 'medium', 'high', 'xhigh']).optional(),
});

const fallbackConfigSchema = z.object({
  enabled: z.boolean(),
  modelKeys: z.array(z.string()),
});

const computerUseConfigSchema = z.object({
  enabled: z.boolean(),
  showStepLog: z.boolean(),
  toolSurface: computerUseToolSurfaceSchema,
  defaultSurface: computerUseSurfaceSchema,
  defaultTarget: computerUseTargetSchema,
  approvalModeDefault: computerUseApprovalModeSchema,
  idleTimeoutSec: z.number().positive(),
  postActionDelayMs: z.number().min(0).max(5000),
  maxSessionDurationMin: z.number().positive(),
  models: z.object({
    plannerModelKey: z.string().optional(),
    driverModelKey: z.string().optional(),
    verifierModelKey: z.string().optional(),
    recoveryModelKey: z.string().optional(),
  }),
  capture: z.object({
    maxDimension: z.number().positive(),
    jpegQuality: z.number().min(0.1).max(1),
  }),
  safety: z.object({
    pauseOnTerminal: z.boolean(),
    manualTakeoverPauses: z.boolean(),
  }),
  localMacos: z.object({
    autoRequestPermissions: z.boolean(),
    autoOpenPrivacySettings: z.boolean(),
    allowedDisplays: z.array(z.string()),
    captureExcludedApps: z.array(z.string()),
  }),
  overlay: z.object({
    enabled: z.boolean(),
    position: z.enum(['top', 'bottom']),
    heightPx: z.number().min(60).max(300),
    opacity: z.number().min(0.3).max(0.95),
  }),
});

const azureAudioConfigSchema = z.object({
  endpoint: z.string().optional(),        // Custom TTS base URL (overrides region-based URL)
  region: z.string().optional(),          // e.g. "eastus" — used to construct standard Azure endpoints
  subscriptionKey: z.string().optional(), // Ocp-Apim-Subscription-Key
  ttsVoice: z.string().optional(),        // e.g. "en-US-JennyNeural"
  ttsOutputFormat: z.string().optional(), // e.g. "audio-24khz-48kbitrate-mono-mp3"
  ttsRate: z.number().min(0.5).max(3).optional(),
  sttLanguage: z.string().optional(),     // e.g. "en-US"
  sttEndpoint: z.string().optional(),     // Custom WebSocket endpoint for STT
});

const audioConfigSchema = z.object({
  provider: z.enum(['native', 'azure']).optional(), // default: 'native'
  azure: azureAudioConfigSchema.optional(),
  tts: z.object({
    enabled: z.boolean(),
    voice: z.string().optional(),
    rate: z.number().min(0.5).max(3),
  }),
  dictation: z.object({
    enabled: z.boolean(),
    language: z.string().optional(),
    continuous: z.boolean(),
    inputDeviceId: z.string().optional(),
  }),
});

const realtimeConfigSchema = z.object({
  enabled: z.boolean(),
  provider: z.enum(['openai', 'azure', 'custom']),
  openai: z.object({
    apiKey: z.string().optional(),
  }).optional(),
  azure: z.object({
    endpoint: z.string().optional(),       // e.g. "https://myresource.openai.azure.com"
    apiKey: z.string().optional(),
    deploymentName: z.string().optional(),  // e.g. "gpt-realtime-1.5"
    apiVersion: z.string().optional(),      // e.g. "2024-10-01-preview"
  }).optional(),
  custom: z.object({
    baseUrl: z.string().optional(),        // WebSocket base URL
    apiKey: z.string().optional(),
  }).optional(),
  model: z.string().optional(),            // default: "gpt-4o-realtime-preview"
  voice: z.string().optional(),            // default: "alloy"
  instructions: z.string().optional(),     // system instructions for realtime session
  turnDetection: z.object({
    type: z.enum(['server_vad', 'none']).optional(),
    threshold: z.number().min(0).max(1).optional(),
    silenceDurationMs: z.number().positive().optional(),
  }).optional(),
  inputAudioTranscription: z.boolean().optional(),
  inputDeviceId: z.string().optional(),
  outputDeviceId: z.string().optional(),
  autoEndCall: z.object({
    enabled: z.boolean().optional(),
    silenceTimeoutSec: z.number().positive().optional(),
  }).optional(),
  memoryContext: z.object({
    enabled: z.boolean(),
    maxTokens: z.number().positive(),
    conversationHistory: z.object({
      enabled: z.boolean(),
      maxMessages: z.number().nonnegative(),
    }),
    workingMemory: z.object({ enabled: z.boolean() }),
    semanticRecall: z.object({
      enabled: z.boolean(),
      topK: z.number().positive(),
    }),
    observationalMemory: z.object({ enabled: z.boolean() }),
  }).optional(),
  computerUseUpdates: z.object({
    enabled: z.boolean(),
    throttleMs: z.number().min(1000).max(30000),
    onStepCompleted: z.boolean(),
    onStepFailed: z.boolean(),
    onCheckpoint: z.boolean(),
    onApprovalNeeded: z.boolean(),
    onGuidanceReceived: z.boolean(),
    onSessionCompleted: z.boolean(),
    onSessionFailed: z.boolean(),
  }).optional(),
});

const pluginApprovalSchema = z.object({
  hash: z.string(),
  approvedAt: z.string(),
});

export const legionConfigSchema = z.object({
  models: modelsConfigSchema,
  runtime: runtimeConfigSchema,
  memory: memoryConfigSchema,
  compaction: z.object({
    tool: toolCompactionSchema,
    conversation: conversationCompactionSchema,
  }),
  tools: z.object({
    shell: shellGuardrailsSchema,
    fileAccess: fileAccessSchema,
    processStreaming: processStreamingSchema,
    subAgents: subAgentConfigSchema,
  }),
  mcpServers: z.array(mcpServerSchema),
  skills: z.object({
    directory: z.string(),
    enabled: z.array(z.string()),
  }),
  systemPrompt: z.string(),
  plugins: z.record(z.record(z.unknown())).optional(),
  pluginApprovals: z.record(pluginApprovalSchema),
  ui: z.object({
    theme: z.enum(['light', 'dark', 'system']),
    sidebarWidth: z.number().positive(),
  }),
  audio: audioConfigSchema,
  realtime: realtimeConfigSchema,
  computerUse: computerUseConfigSchema,
  advanced: z.object({
    temperature: z.number().min(0).max(2),
    maxSteps: z.number().positive(),
    maxRetries: z.number().nonnegative(),
    useResponsesApi: z.boolean(),
  }),
  titleGeneration: titleGenerationSchema,
  profiles: z.array(profileConfigSchema).optional(),
  defaultProfileKey: z.string().optional(),
  fallback: fallbackConfigSchema.optional(),
});

export type LegionConfig = z.infer<typeof legionConfigSchema>;
