import { Memory } from '@mastra/memory';
import { createOpenAI } from '@ai-sdk/openai';
import { LibSQLStore, LibSQLVector } from '@mastra/libsql';
import { mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';
import type { LegionConfig } from '../config/schema.js';

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

    // Semantic recall config
    let semanticRecallConfig: Record<string, unknown> = { semanticRecall: false };
    if (config.memory.semanticRecall.enabled && openAIProvider) {
      const embeddingModelId = config.memory.semanticRecall.embeddingDeploymentName || 'text-embedding-3-small';
      semanticRecallConfig = {
        semanticRecall: {
          topK: config.memory.semanticRecall.topK,
          messageRange: { before: 1, after: 1 },
          scope: config.memory.semanticRecall.scope,
        },
        vector: new LibSQLVector({ id: 'legion-vector', url: sqliteUrl }),
        embedder: openAIProvider.embedding(embeddingModelId),
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

    sharedMemory = new Memory(memoryConfig as any);
  } catch (error) {
    console.error('[Memory] Failed to initialize:', error);
    sharedMemory = null;
  }

  return sharedMemory;
}
