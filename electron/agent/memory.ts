import { Memory } from '@mastra/memory';
import { createOpenAI } from '@ai-sdk/openai';
import { createAzure } from '@ai-sdk/azure';
import { embed } from 'ai';
import { LibSQLStore, LibSQLVector } from '@mastra/libsql';
import { mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';
import type { LegionConfig } from '../config/schema.js';

type MemoryConfig = ConstructorParameters<typeof Memory>[0];

const RESOURCE_ID = 'legion-local-user';

let sharedMemory: Memory | null | undefined;

function normalizeOpenAIBaseUrl(endpoint?: string): string | undefined {
  const base = endpoint?.trim()?.replace(/\/+$/, '') ?? '';
  if (!base) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(base);
  } catch {
    return undefined;
  }
  if (parsed.pathname.endsWith('/openai')) return parsed.toString().replace(/\/+$/, '');
  parsed.pathname = `${parsed.pathname.replace(/\/+$/, '')}/openai`;
  return parsed.toString().replace(/\/+$/, '');
}

function ensureDir(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function buildAzureOpenAIProvider(config: LegionConfig): ReturnType<typeof createOpenAI> | null {
  const azureProvider = config.models.providers['azure_primary'];
  const baseURL = normalizeOpenAIBaseUrl(azureProvider?.endpoint);
  if (!baseURL || !azureProvider?.apiKey) return null;

  return createOpenAI({
    baseURL,
    apiKey: azureProvider.apiKey,
    headers: {
      ...(azureProvider.apiVersion ? { 'api-version': azureProvider.apiVersion } : {}),
      ...(azureProvider.extraHeaders ?? {}),
    },
  });
}

/* ── Embedding Provider Builder ── */

type EmbeddingResult = {
  embeddingModel: Parameters<typeof embed>[0]['model'];
  modelId: string;
};

/**
 * Build the baseURL for createAzure from a user-provided Azure endpoint.
 *
 * createAzure constructs URLs as: `${baseURL}/v1/embeddings?api-version=X`
 * Azure expects:                   `https://{resource}.../openai/v1/embeddings?api-version=X`
 *
 * So baseURL must end with `/openai`. We normalise whatever the user pastes in:
 *   "https://foo.cognitiveservices.azure.com"          → "https://foo.cognitiveservices.azure.com/openai"
 *   "https://foo.cognitiveservices.azure.com/"         → "https://foo.cognitiveservices.azure.com/openai"
 *   "https://foo.cognitiveservices.azure.com/openai"   → "https://foo.cognitiveservices.azure.com/openai"
 *   "https://foo.openai.azure.com/openai"              → "https://foo.openai.azure.com/openai"
 */
function normalizeAzureBaseUrl(endpoint: string): string | undefined {
  const trimmed = endpoint.trim().replace(/\/+$/, '');
  if (!trimmed) return undefined;
  try {
    const parsed = new URL(trimmed);
    // Ensure the path ends with /openai
    const pathname = parsed.pathname.replace(/\/+$/, '');
    if (!pathname.endsWith('/openai')) {
      parsed.pathname = `${pathname}/openai`;
    }
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return undefined;
  }
}

/**
 * Build the embedding model from the semantic recall embedding config.
 * Falls back to the legacy Azure primary provider when no explicit embedding provider is configured.
 */
function buildEmbeddingProvider(config: LegionConfig): EmbeddingResult | null {
  const embCfg = config.memory.semanticRecall.embeddingProvider;
  const providerType = embCfg?.type ?? 'azure';

  if (providerType === 'openai') {
    const apiKey = embCfg?.openai?.apiKey;
    if (!apiKey) return null;
    const provider = createOpenAI({ apiKey });
    const modelId = embCfg?.model || config.memory.semanticRecall.embeddingDeploymentName || 'text-embedding-3-small';
    return { embeddingModel: provider.embedding(modelId), modelId };
  }

  if (providerType === 'custom') {
    const baseURL = embCfg?.custom?.baseUrl?.trim()?.replace(/\/+$/, '');
    if (!baseURL) return null;
    const provider = createOpenAI({
      baseURL,
      apiKey: embCfg?.custom?.apiKey || 'no-key',
    });
    const modelId = embCfg?.model || config.memory.semanticRecall.embeddingDeploymentName || 'text-embedding-3-small';
    return { embeddingModel: provider.embedding(modelId), modelId };
  }

  // Default: azure — use @ai-sdk/azure which handles the Azure-specific URL routing
  // (i.e. /openai/deployments/{deployment}/embeddings?api-version=X)

  // Try explicit embedding Azure config first
  if (embCfg?.azure?.endpoint && embCfg?.azure?.apiKey) {
    const baseURL = normalizeAzureBaseUrl(embCfg.azure.endpoint);
    if (!baseURL) return null;
    const provider = createAzure({
      baseURL,
      apiKey: embCfg.azure.apiKey,
      apiVersion: embCfg.azure.apiVersion || '2024-02-01',
      useDeploymentBasedUrls: true,
    });
    const modelId = embCfg.azure.deploymentName || embCfg?.model || config.memory.semanticRecall.embeddingDeploymentName || 'text-embedding-3-small';
    return { embeddingModel: provider.embedding(modelId), modelId };
  }

  // Fall back to the global azure_primary provider credentials
  const azurePrimary = config.models.providers['azure_primary'];
  if (azurePrimary?.endpoint && azurePrimary?.apiKey) {
    const baseURL = normalizeAzureBaseUrl(azurePrimary.endpoint);
    if (!baseURL) return null;
    const provider = createAzure({
      baseURL,
      apiKey: azurePrimary.apiKey,
      apiVersion: azurePrimary.apiVersion || '2024-02-01',
      useDeploymentBasedUrls: true,
    });
    const modelId = embCfg?.model || config.memory.semanticRecall.embeddingDeploymentName || 'text-embedding-3-small';
    return { embeddingModel: provider.embedding(modelId), modelId };
  }

  return null;
}

/**
 * Test the embedding connection by generating a test embedding vector.
 * Returns success info (model, dimensions) or an error message.
 */
export async function testEmbeddingConnection(config: LegionConfig): Promise<{
  ok?: boolean;
  model?: string;
  dimensions?: number;
  error?: string;
}> {
  try {
    const result = buildEmbeddingProvider(config);
    if (!result) {
      return { error: 'Embedding provider not configured. Check your API key and endpoint settings.' };
    }

    const { embeddingModel, modelId } = result;

    const response = await embed({
      model: embeddingModel,
      value: 'connection test',
    });

    return {
      ok: true,
      model: modelId,
      dimensions: response.embedding.length,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: `Embedding test failed: ${message}` };
  }
}

export function getResourceId(): string {
  return RESOURCE_ID;
}

export function resetMemory(): void {
  sharedMemory = undefined;
}

export function getSharedMemory(config: LegionConfig, dbPath: string): Memory | null {
  if (sharedMemory !== undefined) return sharedMemory;

  if (!config.memory.enabled) {
    sharedMemory = null;
    return null;
  }

  const sqliteUrl = `file:${dbPath}`;
  try {
    ensureDir(dbPath);

    const openAIProvider = buildAzureOpenAIProvider(config);
    const embeddingResult = buildEmbeddingProvider(config);
    const storage = new LibSQLStore({ id: 'legion-memory', url: sqliteUrl });

    // Working memory config
    const workingMemory = config.memory.workingMemory.enabled
      ? { enabled: true, scope: config.memory.workingMemory.scope }
      : { enabled: false };

    // Observational memory config
    let observationalMemory: Record<string, unknown> | false = false;
    if (config.memory.observationalMemory.enabled && openAIProvider) {
      const obsModelId = config.memory.observationalMemory.deploymentName
        || config.models.catalog[0]?.deploymentName
        || config.models.catalog[0]?.modelName
        || '';
      if (obsModelId) {
        observationalMemory = {
          model: openAIProvider(obsModelId),
          scope: config.memory.observationalMemory.scope,
        };
      }
    }

    // Semantic recall config — use the configurable embedding provider
    let semanticRecallConfig: Record<string, unknown> = { semanticRecall: false };
    if (config.memory.semanticRecall.enabled && embeddingResult) {
      semanticRecallConfig = {
        semanticRecall: {
          topK: config.memory.semanticRecall.topK,
          messageRange: { before: 1, after: 1 },
          scope: config.memory.semanticRecall.scope,
        },
        vector: new LibSQLVector({ id: 'legion-vector', url: sqliteUrl }),
        embedder: embeddingResult.embeddingModel,
      };
    }

    const memoryConfig: Record<string, unknown> = {
      storage,
      options: {
        lastMessages: config.memory.lastMessages,
        workingMemory,
        semanticRecall: semanticRecallConfig.semanticRecall ?? false,
        observationalMemory,
      },
    };
    if ('vector' in semanticRecallConfig) {
      memoryConfig.vector = semanticRecallConfig.vector;
      memoryConfig.embedder = semanticRecallConfig.embedder;
    }

    sharedMemory = new Memory(memoryConfig as MemoryConfig);
  } catch (error) {
    console.error('[Memory] Failed to initialize:', error);
    sharedMemory = null;
  }

  return sharedMemory;
}
