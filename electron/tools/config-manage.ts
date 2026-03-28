import { z } from 'zod';
import type { ToolDefinition } from './types.js';
import type { LegionConfig } from '../config/schema.js';
import { readEffectiveConfig, writeDesktopConfig } from '../ipc/config.js';

function readConfig(legionHome: string): LegionConfig {
  return readEffectiveConfig(legionHome);
}

function getNested(obj: Record<string, unknown>, path: string): unknown {
  const keys = path.split('.');
  let current: unknown = obj;
  for (const key of keys) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function setNested(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!(key in current) || typeof current[key] !== 'object' || current[key] === null) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  current[keys[keys.length - 1]] = value;
}

/** Build a diff response for a settings set operation */
function settingChanged(field: string, previous: unknown, value: unknown) {
  return { success: true, changed: { field, previous, new: value } };
}

/* ── Memory Settings ── */

export function createMemorySettingsTool(legionHome: string): ToolDefinition {
  return {
    name: 'memory_settings',
    description: [
      'View or update Legion Interlink memory settings. Controls working memory, observational memory, semantic recall, embedding provider, and context window.',
      'Use "get" to see current values, "set" to change one.',
      'Embedding provider fields: semanticRecall.embeddingProvider.type (openai|azure|custom), .model, .openai.apiKey, .azure.endpoint, .azure.apiKey, .azure.deploymentName, .azure.apiVersion, .custom.baseUrl, .custom.apiKey.',
    ].join(' '),
    inputSchema: z.object({
      action: z.enum(['get', 'set']).describe('Read or write memory settings'),
      field: z.enum([
        'enabled',
        'lastMessages',
        'workingMemory.enabled',
        'workingMemory.scope',
        'observationalMemory.enabled',
        'observationalMemory.scope',
        'semanticRecall.enabled',
        'semanticRecall.topK',
        'semanticRecall.scope',
        'semanticRecall.embeddingProvider.type',
        'semanticRecall.embeddingProvider.model',
        'semanticRecall.embeddingProvider.openai.apiKey',
        'semanticRecall.embeddingProvider.azure.endpoint',
        'semanticRecall.embeddingProvider.azure.apiKey',
        'semanticRecall.embeddingProvider.azure.deploymentName',
        'semanticRecall.embeddingProvider.azure.apiVersion',
        'semanticRecall.embeddingProvider.custom.baseUrl',
        'semanticRecall.embeddingProvider.custom.apiKey',
      ]).optional().describe('Field to set (required for "set")'),
      value: z.any().optional().describe('New value (required for "set")'),
    }),
    execute: async (input) => {
      const { action, field, value } = input as { action: string; field?: string; value?: unknown };
      const config = readConfig(legionHome);
      if (action === 'get') return { memory: config.memory };
      if (!field || value === undefined) return { error: 'Field and value required for "set".' };
      const previous = getNested(config.memory as unknown as Record<string, unknown>, field);
      setNested(config.memory as unknown as Record<string, unknown>, field, value);
      writeDesktopConfig(legionHome, config);
      return settingChanged(field, previous, value);
    },
  };
}

/* ── Compaction Settings ── */

export function createCompactionSettingsTool(legionHome: string): ToolDefinition {
  return {
    name: 'compaction_settings',
    description: [
      'View or update compaction settings. Controls tool result compaction and conversation compaction.',
      'Use "get" to see current values, "set" to change one.',
    ].join(' '),
    inputSchema: z.object({
      action: z.enum(['get', 'set']).describe('Read or write compaction settings'),
      field: z.enum([
        'tool.enabled',
        'tool.useAI',
        'tool.triggerTokens',
        'tool.outputMaxTokens',
        'tool.truncateMinChars',
        'tool.truncateHeadRatio',
        'tool.truncateMinTailChars',
        'conversation.enabled',
        'conversation.mode',
        'conversation.triggerPercent',
        'conversation.ignoreRecentUserMessages',
        'conversation.ignoreRecentAssistantMessages',
        'conversation.outputMaxTokens',
        'conversation.promptReserveTokens',
      ]).optional().describe('Field to set (required for "set")'),
      value: z.any().optional().describe('New value (required for "set")'),
    }),
    execute: async (input) => {
      const { action, field, value } = input as { action: string; field?: string; value?: unknown };
      const config = readConfig(legionHome);
      if (action === 'get') return { compaction: config.compaction };
      if (!field || value === undefined) return { error: 'Field and value required for "set".' };
      const previous = getNested(config.compaction as unknown as Record<string, unknown>, field);
      setNested(config.compaction as unknown as Record<string, unknown>, field, value);
      writeDesktopConfig(legionHome, config);
      return settingChanged(field, previous, value);
    },
  };
}

/* ── Tool Settings ── */

export function createToolSettingsTool(legionHome: string): ToolDefinition {
  return {
    name: 'tool_settings',
    description: [
      'View or update tool settings (shell, file access, process streaming, observer).',
      'Use "get" to see current values, "set" to change one.',
    ].join(' '),
    inputSchema: z.object({
      action: z.enum(['get', 'set']).describe('Read or write tool settings'),
      field: z.enum([
        'shell.enabled',
        'shell.timeout',
        'shell.allowPatterns',
        'shell.denyPatterns',
        'fileAccess.enabled',
        'fileAccess.allowPaths',
        'fileAccess.denyPaths',
        'processStreaming.enabled',
        'processStreaming.updateIntervalMs',
        'processStreaming.modelFeedMode',
        'processStreaming.maxOutputBytes',
        'processStreaming.truncationMode',
        'processStreaming.stopAfterMax',
        'processStreaming.headTailRatio',
        'processStreaming.observer.enabled',
        'processStreaming.observer.intervalMs',
        'processStreaming.observer.maxSnapshotChars',
        'processStreaming.observer.maxMessagesPerTool',
        'processStreaming.observer.maxTotalLaunchedTools',
      ]).optional().describe('Field to set (required for "set")'),
      value: z.any().optional().describe('New value (required for "set")'),
    }),
    execute: async (input) => {
      const { action, field, value } = input as { action: string; field?: string; value?: unknown };
      const config = readConfig(legionHome);
      if (action === 'get') return { tools: config.tools };
      if (!field || value === undefined) return { error: 'Field and value required for "set".' };
      const previous = getNested(config.tools as unknown as Record<string, unknown>, field);
      setNested(config.tools as unknown as Record<string, unknown>, field, value);
      writeDesktopConfig(legionHome, config);
      return settingChanged(field, previous, value);
    },
  };
}

/* ── Advanced / LLM Settings ── */

export function createAdvancedSettingsTool(legionHome: string): ToolDefinition {
  return {
    name: 'advanced_settings',
    description: [
      'View or update advanced LLM settings: temperature, max steps, max retries, responses API toggle.',
      'Also controls title generation and UI theme. Use "get" to see current values, "set" to change one.',
    ].join(' '),
    inputSchema: z.object({
      action: z.enum(['get', 'set']).describe('Read or write advanced settings'),
      field: z.enum([
        'temperature',
        'maxSteps',
        'maxRetries',
        'useResponsesApi',
        'titleGeneration.enabled',
        'titleGeneration.retitleIntervalMessages',
        'titleGeneration.retitleEagerUntilMessage',
        'ui.theme',
      ]).optional().describe('Field to set (required for "set")'),
      value: z.any().optional().describe('New value (required for "set")'),
    }),
    execute: async (input) => {
      const { action, field, value } = input as { action: string; field?: string; value?: unknown };
      const config = readConfig(legionHome);
      if (action === 'get') {
        return {
          advanced: config.advanced,
          titleGeneration: config.titleGeneration,
          ui: config.ui,
        };
      }
      if (!field || value === undefined) return { error: 'Field and value required for "set".' };

      let previous: unknown;
      if (field.startsWith('titleGeneration.')) {
        const subField = field.replace('titleGeneration.', '');
        previous = getNested(config.titleGeneration as unknown as Record<string, unknown>, subField);
        setNested(config.titleGeneration as unknown as Record<string, unknown>, subField, value);
      } else if (field.startsWith('ui.')) {
        const subField = field.replace('ui.', '');
        previous = getNested(config.ui as unknown as Record<string, unknown>, subField);
        setNested(config.ui as unknown as Record<string, unknown>, subField, value);
      } else {
        previous = getNested(config.advanced as unknown as Record<string, unknown>, field);
        setNested(config.advanced as unknown as Record<string, unknown>, field, value);
      }
      writeDesktopConfig(legionHome, config);
      return settingChanged(field, previous, value);
    },
  };
}

/* ── System Prompt ── */

export function createSystemPromptTool(legionHome: string): ToolDefinition {
  return {
    name: 'system_prompt',
    description: 'View or update the Legion Interlink system prompt. Use "get" to read, "set" to replace it.',
    inputSchema: z.object({
      action: z.enum(['get', 'set']).describe('Read or write the system prompt'),
      prompt: z.string().optional().describe('The new system prompt text (required for "set")'),
    }),
    execute: async (input) => {
      const { action, prompt } = input as { action: string; prompt?: string };
      const config = readConfig(legionHome);
      if (action === 'get') return { systemPrompt: config.systemPrompt };
      if (prompt === undefined) return { error: 'Prompt text required for "set".' };
      const previous = config.systemPrompt;
      config.systemPrompt = prompt;
      writeDesktopConfig(legionHome, config);
      return { success: true, changed: { previous, new: prompt } };
    },
  };
}

/* ── Audio Settings ── */

export function createAudioSettingsTool(legionHome: string): ToolDefinition {
  return {
    name: 'audio_settings',
    description: [
      'View or update audio settings. Controls speech provider (native/azure), text-to-speech, dictation, and Azure AI Speech configuration.',
      'Use "get" to see current values, "set" to change one.',
    ].join(' '),
    inputSchema: z.object({
      action: z.enum(['get', 'set']).describe('Read or write audio settings'),
      field: z.enum([
        'provider',
        'tts.enabled',
        'tts.voice',
        'tts.rate',
        'dictation.enabled',
        'dictation.language',
        'dictation.continuous',
        'azure.endpoint',
        'azure.region',
        'azure.subscriptionKey',
        'azure.ttsVoice',
        'azure.ttsOutputFormat',
        'azure.ttsRate',
        'azure.sttLanguage',
        'azure.sttEndpoint',
      ]).optional().describe('Field to set (required for "set")'),
      value: z.any().optional().describe('New value (required for "set")'),
    }),
    execute: async (input) => {
      const { action, field, value } = input as { action: string; field?: string; value?: unknown };
      const config = readConfig(legionHome);
      if (action === 'get') return { audio: config.audio };
      if (!field || value === undefined) return { error: 'Field and value required for "set".' };
      const previous = getNested(config.audio as unknown as Record<string, unknown>, field);
      setNested(config.audio as unknown as Record<string, unknown>, field, value);
      writeDesktopConfig(legionHome, config);
      return settingChanged(field, previous, value);
    },
  };
}

/* ── Realtime Audio Settings ── */

export function createRealtimeSettingsTool(legionHome: string): ToolDefinition {
  return {
    name: 'realtime_settings',
    description: [
      'View or update realtime audio call settings. Controls provider (openai/azure/custom), API keys, model, voice, turn detection, and auto-end call configuration.',
      'Use "get" to see current values, "set" to change one.',
    ].join(' '),
    inputSchema: z.object({
      action: z.enum(['get', 'set']).describe('Read or write realtime settings'),
      field: z.enum([
        'enabled',
        'provider',
        'model',
        'voice',
        'instructions',
        'openai.apiKey',
        'azure.endpoint',
        'azure.apiKey',
        'azure.deploymentName',
        'azure.apiVersion',
        'custom.baseUrl',
        'custom.apiKey',
        'turnDetection.type',
        'turnDetection.threshold',
        'turnDetection.silenceDurationMs',
        'inputAudioTranscription',
        'inputDeviceId',
        'outputDeviceId',
        'autoEndCall.enabled',
        'autoEndCall.silenceTimeoutSec',
      ]).optional().describe('Field to set (required for "set")'),
      value: z.any().optional().describe('New value (required for "set")'),
    }),
    execute: async (input) => {
      const { action, field, value } = input as { action: string; field?: string; value?: unknown };
      const config = readConfig(legionHome);
      if (action === 'get') return { realtime: config.realtime };
      if (!field || value === undefined) return { error: 'Field and value required for "set".' };
      const previous = getNested(config.realtime as unknown as Record<string, unknown>, field);
      setNested(config.realtime as unknown as Record<string, unknown>, field, value);
      writeDesktopConfig(legionHome, config);
      return settingChanged(field, previous, value);
    },
  };
}
