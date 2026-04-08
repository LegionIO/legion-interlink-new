import type { IpcMain } from 'electron';
import { readFileSync, writeFileSync, existsSync, watch, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { AppConfig } from '../config/schema.js';
import { detectAppRuntime } from '../agent/app-runtime.js';
import { broadcastToAllWindows } from '../utils/window-send.js';
import { binaryExists } from '../tools/cli-tools.js';

export type { AppConfig } from '../config/schema.js';

export const APP_LLM_CONFIG_PATH = join(homedir(), '.' + __BRAND_APP_SLUG, 'settings', 'llm.json');
const DESKTOP_SETTINGS_FILENAME = 'desktop.json';
const DEFAULT_SYSTEM_PROMPT = `You are ${__BRAND_ASSISTANT_NAME}, a powerful local AI assistant with access to the user's computer. You can execute shell commands, read/write files, search codebases, and connect to external services via MCP. Be proactive, thorough, and helpful. When executing tools, explain what you're doing and why.`;
const LEGACY_DEFAULT_SYSTEM_PROMPTS = new Set([
  'You are Aithena, a powerful local AI assistant with access to the user\'s computer. You can execute shell commands, read/write files, search codebases, and connect to external services via MCP. Be proactive, thorough, and helpful. When executing tools, explain what you\'re doing and why.',
  'You are Legion Aithena, a powerful local AI assistant with access to the user\'s computer. You can execute shell commands, read/write files, search codebases, and connect to external services via MCP. Be proactive, thorough, and helpful. When executing tools, explain what you\'re doing and why.',
  'You are Legion Interlink, a powerful local AI assistant with access to the user\'s computer. You can execute shell commands, read/write files, search codebases, and connect to external services via MCP. Be proactive, thorough, and helpful. When executing tools, explain what you\'re doing and why.',
  'You are Legion, a powerful local AI assistant with access to the user\'s computer. You can execute shell commands, read/write files, search codebases, and connect to external services via MCP. Be proactive, thorough, and helpful. When executing tools, explain what you\'re doing and why.',
]);

export function getDesktopSettingsPath(appHome: string): string {
  return join(appHome, 'settings', DESKTOP_SETTINGS_FILENAME);
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
      daemon: {
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
      directory: '~/.' + __BRAND_APP_SLUG + '/skills',
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
    imageGeneration: {
      enabled: false,
      provider: 'azure' as const,
      model: 'gpt-image-1.5',
    },
    videoGeneration: {
      enabled: false,
      provider: 'azure' as const,
      model: 'sora-2',
    },
    cliTools: [
      { name: 'github', binary: 'gh', extraBinaries: ['git'], description: 'Run GitHub CLI (gh) and git commands. Use for:\n- GitHub: gh pr list, gh issue create, gh repo clone, gh api, gh run list\n- Git: git status, git log, git diff, git commit, git push, git pull, git branch\n- Worktrees: git worktree add, git worktree list, git worktree remove\nPass the full command string including the binary name (gh or git).', prefix: 'gh pr list', enabled: true, builtIn: true },
      { name: 'brew', binary: 'brew', description: 'Run Homebrew package manager commands.\nExamples: brew install <pkg>, brew upgrade, brew list, brew search <query>, brew info <pkg>, brew services list.', enabled: true, builtIn: true },
      { name: 'wget', binary: 'wget', description: 'Download files from the web using wget.\nExamples: wget <url>, wget -O <file> <url>, wget -r <url>, wget --spider <url>.', enabled: true, builtIn: true },
      { name: 'jq', binary: 'jq', description: 'Process JSON data with jq. Pipe JSON into jq or read from files.\nExamples: echo \'{"a":1}\' | jq .a, cat file.json | jq \'.items[] | .name\', jq -r .version package.json.', enabled: true, builtIn: true },
      { name: 'tree', binary: 'tree', description: 'Display directory structure as a tree.\nExamples: tree, tree -L 2, tree -I node_modules, tree --dirsfirst -a, tree -P "*.ts".', enabled: true, builtIn: true },
      { name: 'python', binary: 'python3', extraBinaries: ['pip3'], description: 'Run Python 3 and pip commands.\nExamples: python3 script.py, python3 -c "print(1+1)", pip3 install <pkg>, pip3 list, pip3 freeze.\nPass the full command including the binary name (python3 or pip3).', prefix: 'python3 --version', enabled: true, builtIn: true },
      { name: 'ollama', binary: 'ollama', description: 'Manage and run local LLM models with Ollama.\nExamples: ollama list, ollama pull <model>, ollama run <model>, ollama show <model>, ollama ps, ollama rm <model>.', enabled: true, builtIn: true },
      { name: 'klist', binary: 'klist', description: 'Display Kerberos ticket cache contents.\nExamples: klist, klist -l, klist -e, klist -A.', enabled: true, builtIn: true },
      { name: 'jfrog', binary: 'jfrog', description: 'Run JFrog CLI commands for Artifactory, Xray, and other JFrog services.\nExamples: jfrog rt ping, jfrog rt search <pattern>, jfrog rt upload <file> <repo>, jfrog config show.', enabled: true, builtIn: true },
      { name: 'curl', binary: 'curl', description: 'Make HTTP requests with curl.\nExamples: curl -s <url>, curl -X POST -d \'{"key":"val"}\' -H "Content-Type: application/json" <url>, curl -o file <url>.', enabled: true, builtIn: true },
      { name: 'docker', binary: 'docker', extraBinaries: ['docker-compose'], description: 'Manage Docker containers and images.\nExamples: docker ps, docker images, docker run, docker build, docker-compose up, docker-compose down.', prefix: 'docker ps', enabled: true, builtIn: true },
      { name: 'kubectl', binary: 'kubectl', description: 'Manage Kubernetes clusters with kubectl.\nExamples: kubectl get pods, kubectl get services, kubectl describe pod <name>, kubectl logs <pod>.', enabled: true, builtIn: true },
      { name: 'node', binary: 'node', extraBinaries: ['npm', 'npx', 'pnpm'], description: 'Run Node.js, npm, npx, and pnpm commands.\nExamples: node -e "console.log(1)", npm list, npx create-react-app, pnpm install.\nPass the full command including the binary name (node, npm, npx, or pnpm).', prefix: 'node --version', enabled: true, builtIn: true },
      { name: 'aws', binary: 'aws', description: 'Run AWS CLI commands.\nExamples: aws s3 ls, aws ec2 describe-instances, aws sts get-caller-identity, aws iam list-users.', enabled: true, builtIn: true },
      { name: 'terraform', binary: 'terraform', description: 'Run Terraform infrastructure-as-code commands.\nExamples: terraform plan, terraform apply, terraform state list, terraform init, terraform output.', enabled: true, builtIn: true },
      { name: 'rsync', binary: 'rsync', description: 'Sync files and directories with rsync.\nExamples: rsync -av src/ dest/, rsync -avz --progress src/ remote:dest/.', enabled: true, builtIn: true },
      { name: 'make', binary: 'make', description: 'Run Makefile targets with make.\nExamples: make, make build, make test, make clean, make -j4.', enabled: true, builtIn: true },
      { name: 'ruby', binary: 'ruby', extraBinaries: ['gem', 'bundle'], description: 'Run Ruby, gem, and bundler commands.\nExamples: ruby -e "puts 1+1", gem list, bundle install, bundle exec rspec.\nPass the full command including the binary name (ruby, gem, or bundle).', prefix: 'ruby --version', enabled: true, builtIn: true },
      { name: 'go', binary: 'go', description: 'Run Go toolchain commands.\nExamples: go build, go test, go run main.go, go mod tidy, go vet.', enabled: true, builtIn: true },
      { name: 'cargo', binary: 'cargo', description: 'Run Rust Cargo commands.\nExamples: cargo build, cargo test, cargo run, cargo clippy, cargo fmt.', enabled: true, builtIn: true },
      { name: 'ssh', binary: 'ssh', extraBinaries: ['scp'], description: 'SSH and SCP for remote access and file transfer.\nExamples: ssh user@host, scp file user@host:/path, ssh -L 8080:localhost:80 user@host.', enabled: true, builtIn: true },
      { name: 'helm', binary: 'helm', description: 'Manage Kubernetes Helm charts.\nExamples: helm list, helm install <release> <chart>, helm upgrade, helm repo update.', enabled: true, builtIn: true },
    ] as Array<{ name: string; binary: string; extraBinaries?: string[]; description: string; prefix?: string; enabled: boolean; builtIn: boolean }>,
  };
}

function applyRuntimeDefaults(config: AppConfig, appHome: string): AppConfig {
  const detected = detectAppRuntime(config, appHome);
  const currentRuntime = config.runtime ?? {
    agentBackend: 'mastra',
    daemon: {
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
      daemon: {
        ...currentRuntime.daemon,
        rootPath: currentRuntime.daemon?.rootPath || '',
        configDir: currentRuntime.daemon?.configDir || detected.configDir,
        daemonUrl: currentRuntime.daemon?.daemonUrl || detected.daemonUrl,
        rubyPath: currentRuntime.daemon?.rubyPath || detected.rubyPath,
      },
    },
  };
}

type AppProviderType = 'anthropic' | 'openai' | 'gemini' | 'bedrock' | 'ollama';

type AppProviderConfig = {
  enabled?: boolean;
  api_key?: string | null;
  openai_api_key?: string | null;
  base_url?: string | null;
  use_responses_api?: boolean | null;
  region?: string | null;
  bearer_token?: string | null;
  default_model?: string | null;
  small_model?: string | null;
  medium_model?: string | null;
  large_model?: string | null;
};

type AppLlmFile = {
  llm?: {
    enabled?: boolean;
    default_provider?: AppProviderType | null;
    default_model?: string | null;
    providers?: Partial<Record<AppProviderType, AppProviderConfig>>;
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

function defaultAppConfig(): AppLlmFile {
  return {
    llm: {
      enabled: true,
      default_provider: 'bedrock',
      default_model: null,
      providers: {
        anthropic: { enabled: false, api_key: null },
        openai: { enabled: false, api_key: null, openai_api_key: null, use_responses_api: false },
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

function readAppLlmConfig(): AppLlmFile {
  if (!existsSync(APP_LLM_CONFIG_PATH)) {
    return defaultAppConfig();
  }

  try {
    return deepMerge(defaultAppConfig() as Record<string, unknown>, JSON.parse(readFileSync(APP_LLM_CONFIG_PATH, 'utf-8'))) as AppLlmFile;
  } catch (error) {
    console.error('[Config] Failed to parse LLM config, using defaults:', error);
    return defaultAppConfig();
  }
}

function writeAppLlmConfig(config: AppLlmFile): void {
  writeFileSync(APP_LLM_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

function toAppProvider(providerKey: AppProviderType, provider: AppProviderConfig | undefined): Record<string, unknown> {
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
      useResponsesApi: provider?.use_responses_api ?? false,
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

function collectProviderModelNames(provider: AppProviderConfig | undefined): string[] {
  return [
    provider?.default_model,
    provider?.small_model,
    provider?.medium_model,
    provider?.large_model,
  ].filter((value, index, array): value is string => Boolean(value?.trim()) && array.indexOf(value) === index);
}

function hasProviderCredentials(providerKey: AppProviderType, provider: AppProviderConfig | undefined): boolean {
  if (!provider?.enabled) return false;
  if (providerKey === 'bedrock') {
    return Boolean(provider.bearer_token?.trim() || provider.region?.trim());
  }
  return Boolean(provider.api_key?.trim() || provider.openai_api_key?.trim());
}

function resolveProviderModelNames(
  providerKey: AppProviderType,
  provider: AppProviderConfig | undefined,
): string[] {
  const explicit = collectProviderModelNames(provider);
  if (explicit.length > 0) return explicit;
  if (providerKey === 'openai' && hasProviderCredentials(providerKey, provider)) {
    return [...OPENAI_FALLBACK_MODELS];
  }
  return explicit;
}

function toCatalogEntries(providerKey: AppProviderType, provider: AppProviderConfig | undefined): Array<Record<string, unknown>> {
  return resolveProviderModelNames(providerKey, provider).map((modelName) => ({
    key: modelName,
    displayName: inferDisplayName(modelName),
    provider: providerKey,
    modelName,
  }));
}

function loadAppModelsConfig(defaults: AppConfig['models']): AppConfig['models'] {
  try {
    const raw = readAppLlmConfig();
    const llm = raw.llm;
    if (!llm?.enabled) {
      return defaults;
    }

    const appProviders = llm.providers ?? {};
    const providers: Record<string, Record<string, unknown>> = {};
    const catalog: Array<Record<string, unknown>> = [];
    const providerOrder: AppProviderType[] = ['anthropic', 'openai', 'gemini', 'bedrock', 'ollama'];

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
      const provider = appProviders[providerKey];
      providers[providerKey] = toAppProvider(providerKey, provider);
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
      providers: providers as AppConfig['models']['providers'],
      catalog: catalog as AppConfig['models']['catalog'],
    };
  } catch (error) {
    console.error('[Config] Failed to parse LLM config, using empty model catalog:', error);
    return defaults;
  }
}

function getModelNameByKey(catalog: AppConfig['models']['catalog'], key: string): string | null {
  const entry = catalog.find((model) => model.key === key);
  return entry?.modelName ?? null;
}

function updateAppProviderModelSlots(
  provider: AppProviderConfig,
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

export function persistAppModels(
  path: string,
  value: unknown,
  currentConfig: AppConfig,
): void {
  const appLlmConfig = readAppLlmConfig();
  const llm = appLlmConfig.llm ?? (appLlmConfig.llm = defaultAppConfig().llm!);
  const providers = llm.providers ?? (llm.providers = {});
  const providerOrder: AppProviderType[] = ['anthropic', 'openai', 'gemini', 'bedrock', 'ollama'];

  for (const providerKey of providerOrder) {
    providers[providerKey] ??= {};
  }

  if (path === 'models.defaultModelKey') {
    const modelKey = String(value);
    const entry = currentConfig.models.catalog.find((model) => model.key === modelKey);
    llm.default_model = entry?.modelName ?? getModelNameByKey(currentConfig.models.catalog, modelKey) ?? modelKey;
    if (entry && providerOrder.includes(entry.provider as AppProviderType)) {
      llm.default_provider = entry.provider as AppProviderType;
    }
    writeAppLlmConfig(appLlmConfig);
    return;
  }

  if (path.startsWith('models.providers.')) {
    const [, , providerKey, field] = path.split('.');
    if (!providerOrder.includes(providerKey as AppProviderType) || !field) return;

    const provider = providers[providerKey as AppProviderType] ?? {};
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
    } else if (field === 'useResponsesApi' && providerKey === 'openai') {
      provider.use_responses_api = Boolean(value);
    } else if (field === 'region' && providerKey === 'bedrock') {
      provider.region = stringValue || null;
    }

    providers[providerKey as AppProviderType] = provider;
    writeAppLlmConfig(appLlmConfig);
    return;
  }

  if (path === 'models.catalog') {
    const catalog = Array.isArray(value) ? value as AppConfig['models']['catalog'] : currentConfig.models.catalog;
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
      updateAppProviderModelSlots(provider, providerCatalog, preferredDefault);
      providers[providerKey] = provider;
    }

    if (defaultProvider && providerOrder.includes(defaultProvider as AppProviderType)) {
      llm.default_provider = defaultProvider as AppProviderType;
    }
    llm.default_model = defaultModelName;
    writeAppLlmConfig(appLlmConfig);
  }
}

function applyExternalModelConfig(config: AppConfig, appHome: string): AppConfig {
  return applyRuntimeDefaults({
    ...config,
    models: loadAppModelsConfig(config.models),
  }, appHome);
}

export function desktopConfigPayload(config: AppConfig): Record<string, unknown> {
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
    knowledge: config.knowledge,
    imageGeneration: config.imageGeneration,
    videoGeneration: config.videoGeneration,
    daemonLlm: config.daemonLlm,
    proactiveMessaging: config.proactiveMessaging,
    messageChains: config.messageChains,
    triggers: config.triggers,
    cliTools: config.cliTools,
  };
}

export function readEffectiveConfig(appHome: string): AppConfig {
  const configPath = getDesktopSettingsPath(appHome);
  const defaults = getDefaultConfig();

  if (existsSync(configPath)) {
    try {
      const raw = JSON.parse(readFileSync(configPath, 'utf-8'));
      return normalizeResponsesApiConfig(
        migrateLegacySystemPrompt(applyExternalModelConfig(deepMerge(defaults, raw) as AppConfig, appHome)),
      );
    } catch (error) {
      console.error('[Config] Failed to parse desktop.json, using defaults:', error);
      return normalizeResponsesApiConfig(migrateLegacySystemPrompt(applyExternalModelConfig(defaults as unknown as AppConfig, appHome)));
    }
  }

  return normalizeResponsesApiConfig(migrateLegacySystemPrompt(applyExternalModelConfig(defaults as unknown as AppConfig, appHome)));
}

function migrateLegacySystemPrompt(config: AppConfig): AppConfig {
  if (LEGACY_DEFAULT_SYSTEM_PROMPTS.has(config.systemPrompt)) {
    return { ...config, systemPrompt: DEFAULT_SYSTEM_PROMPT };
  }
  return config;
}

function normalizeResponsesApiConfig(config: AppConfig): AppConfig {
  let changed = false;
  const nextCatalog = config.models.catalog.map((entry) => {
    if (entry.useResponsesApi !== false) return entry;
    changed = true;
    const rest = { ...entry };
    delete rest.useResponsesApi;
    return rest;
  });

  if (!changed) return config;
  return {
    ...config,
    models: {
      ...config.models,
      catalog: nextCatalog,
    },
  };
}

export function writeDesktopConfig(appHome: string, config: AppConfig): void {
  const configPath = getDesktopSettingsPath(appHome);
  mkdirSync(join(appHome, 'settings'), { recursive: true });
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
  appHome: string,
  onChanged?: (config: AppConfig) => void,
): { setConfig: (path: string, value: unknown) => void } {
  let currentConfig = readEffectiveConfig(appHome);
  let lastBroadcastSnapshot = JSON.stringify(currentConfig);

  // Watch for external config changes
  const configPath = getDesktopSettingsPath(appHome);
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
        currentConfig = readEffectiveConfig(appHome);
        scheduleConfigBroadcast();
      } catch {
        // Ignore read errors during write
      }
    }, 200);
  };

  if (existsSync(configPath)) {
    watch(configPath, reloadConfig);
  }
  if (existsSync(APP_LLM_CONFIG_PATH)) {
    watch(APP_LLM_CONFIG_PATH, reloadConfig);
  }

  // Unified setConfig that handles models.* persistence correctly.
  // Used by both the IPC handler and the plugin system.
  const llmProviderKeys = new Set(['anthropic', 'openai', 'gemini', 'bedrock', 'ollama']);

  const setConfigImpl = (path: string, value: unknown): void => {
    if (path === 'models') {
      currentConfig = readEffectiveConfig(appHome);
      scheduleConfigBroadcast();
      return;
    }

    if (path.startsWith('models.')) {
      // Always persist to desktop.json (covers plugin-contributed providers/catalog)
      setNestedValue(currentConfig as unknown as Record<string, unknown>, path, value);
      writeDesktopConfig(appHome, currentConfig);

      // Also persist to llm.json for built-in provider paths
      if (path === 'models.defaultModelKey' || path === 'models.catalog') {
        persistAppModels(path, value, currentConfig);
      } else if (path.startsWith('models.providers.')) {
        const providerKey = path.split('.')[2];
        if (llmProviderKeys.has(providerKey)) {
          persistAppModels(path, value, currentConfig);
        }
      }

      currentConfig = readEffectiveConfig(appHome);
      scheduleConfigBroadcast();
      return;
    }

    setNestedValue(currentConfig as unknown as Record<string, unknown>, path, value);
    writeDesktopConfig(appHome, currentConfig);
    currentConfig = readEffectiveConfig(appHome);
    scheduleConfigBroadcast();
  };

  ipcMain.handle('config:get', () => {
    return currentConfig;
  });

  ipcMain.handle('config:auto-detect-runtime', () => {
    const detected = detectAppRuntime(currentConfig, appHome);
    return detected;
  });

  ipcMain.handle('config:set', (_event, path: string, value: unknown) => {
    setConfigImpl(path, value);
    return currentConfig;
  });

  ipcMain.handle('platform:homedir', () => appHome);

  ipcMain.handle('cli-tools:check-binaries', (_event, binaryNames: string[]) => {
    const results: Record<string, boolean> = {};
    for (const name of binaryNames) {
      results[name] = binaryExists(name);
    }
    return results;
  });

  return { setConfig: setConfigImpl };
}
