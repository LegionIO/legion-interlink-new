import type { IpcMain } from 'electron';
import { BrowserWindow } from 'electron';
import { join } from 'path';
import { resolveModelForThread, resolveModelCatalog, resolveStreamConfig, type ModelCatalogEntry, type LLMModelConfig } from '../agent/model-catalog.js';
import { streamAgentResponse, streamWithFallback } from '../agent/mastra-agent.js';
import type { StreamEvent, ReasoningEffort } from '../agent/mastra-agent.js';
import { getAppStatus, resolveAgentBackend, streamAppAgent } from '../agent/app-runtime.js';
import { createLanguageModelFromConfig } from '../agent/language-model.js';
import type { AppConfig } from '../config/schema.js';
import { readEffectiveConfig } from './config.js';
import { shouldCompact, compactConversationPrefix, compactToolResult, estimateToolTokens } from '../agent/compaction.js';
import type { ToolCompactionConfig } from '../agent/compaction.js';
import type { ToolDefinition, ToolExecutionContext } from '../tools/types.js';
import { ensureSafeToolDefinitions, findToolByName } from '../tools/naming.js';
import {
  ToolObserverManager,
  resolveToolObserverConfig,
  summarizeLatestUserRequest,
  summarizeThreadContext,
  type LaunchToolCallResult,
} from '../agent/tool-observer.js';
import { sendSubAgentFollowUp, sendSubAgentFollowUpByToolCall, stopSubAgent, getActiveSubAgentIds } from '../tools/sub-agent.js';

const activeStreams = new Map<string, { abort: () => void }>();
const activeObserverSessions = new Map<string, string>();

function broadcastStreamEvent(event: StreamEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('agent:stream-event', event);
  }
}

function mergeAbortSignals(primary?: AbortSignal, secondary?: AbortSignal): AbortSignal | undefined {
  if (!primary && !secondary) return undefined;
  if (!primary) return secondary;
  if (!secondary) return primary;

  const controller = new AbortController();
  if (primary.aborted || secondary.aborted) {
    controller.abort();
    return controller.signal;
  }

  const abort = (): void => controller.abort();
  primary.addEventListener('abort', abort, { once: true });
  secondary.addEventListener('abort', abort, { once: true });
  return controller.signal;
}

function withObserverAugmentation(result: unknown, augmentation: Record<string, unknown> | undefined): unknown {
  if (!augmentation) return result;
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return { value: result, ...augmentation };
  }

  const base = result as Record<string, unknown>;
  const observerPayload = augmentation.observer as Record<string, unknown> | undefined;
  const existingObserver = (base.observer && typeof base.observer === 'object')
    ? base.observer as Record<string, unknown>
    : undefined;

  if (!observerPayload) return { ...base, ...augmentation };
  return {
    ...base,
    observer: existingObserver
      ? { ...existingObserver, ...observerPayload }
      : observerPayload,
  };
}

/**
 * Stringify a tool result into a flat text representation suitable for
 * token counting and compaction.
 */
function stringifyToolResult(result: unknown): string {
  if (typeof result === 'string') return result;
  if (result == null) return '';
  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}

/**
 * Extract the latest user query text from the message list.
 * Used to give the AI compactor context about what the user asked.
 */
function extractLatestUserQuery(messages: unknown[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as { role?: string; content?: unknown } | undefined;
    if (msg?.role !== 'user') continue;
    const text = extractMessageText(msg.content);
    if (text) return text;
  }
  return '';
}

function extractMessageText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (!part || typeof part !== 'object') return '';
      const typedPart = part as { type?: string; text?: string; filename?: string };
      if (typedPart.type === 'text') return typedPart.text ?? '';
      if (typedPart.type === 'file') return typedPart.filename ? `[File: ${typedPart.filename}]` : '[File]';
      if (typedPart.type === 'image') return '[Image]';
      return '';
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildTitleGenerationInput(messages: unknown[]): string {
  const normalized = messages
    .map((message) => {
      if (!message || typeof message !== 'object') return null;
      const typedMessage = message as { role?: string; content?: unknown };
      const role = typedMessage.role === 'assistant' ? 'assistant' : typedMessage.role === 'user' ? 'user' : null;
      if (!role) return null;
      const text = extractMessageText(typedMessage.content);
      if (!text) return null;
      return `${role}: ${text}`;
    })
    .filter((line): line is string => Boolean(line))
    .slice(-8);

  return normalized.join('\n');
}

function nowIso(): string {
  return new Date().toISOString();
}

function logToolCompactionDebug(stage: string, details: Record<string, unknown>): void {
  console.info(`[ToolCompactionDebug] ${stage} ${JSON.stringify(details)}`);
}

function normalizeGeneratedTitle(rawTitle: string | null): string | null {
  if (!rawTitle) return null;

  const cleaned = rawTitle
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/^(title|summary)\s*:\s*/i, '')
    .replace(/\s+/g, ' ');

  if (!cleaned) return null;

  return cleaned
    .split(/\s+/)
    .slice(0, 4)
    .join(' ')
    .slice(0, 80);
}

function resolveTitleModel(
  config: AppConfig,
  threadModelKey: string | null,
): ModelCatalogEntry | null {
  const catalog = resolveModelCatalog(config);
  const threadEntry = resolveModelForThread(config, threadModelKey);

  const matchingHaiku = catalog.entries.find((entry) => {
    const modelName = entry.modelConfig.modelName.toLowerCase();
    return modelName.includes('haiku');
  });

  if (matchingHaiku) return matchingHaiku;
  return threadEntry;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableTitleGenerationError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const maybeError = error as { statusCode?: number; isRetryable?: boolean; data?: { message?: string } };
  return maybeError.statusCode === 503 || maybeError.isRetryable === true || maybeError.data?.message === 'Bedrock is unable to process your request.';
}

// Tool registry - will be populated by Phase 4
let registeredTools: ToolDefinition[] = [];

export function registerTools(tools: ToolDefinition[]): void {
  registeredTools = ensureSafeToolDefinitions(tools);
}

export function getRegisteredTools(): ToolDefinition[] {
  return registeredTools;
}

/** Hot-swap MCP tools without touching built-in, skill, or plugin tools */
export function updateMcpTools(mcpTools: ToolDefinition[]): void {
  const nonMcp = registeredTools.filter((t) => t.source !== 'mcp');
  registeredTools = [...nonMcp, ...ensureSafeToolDefinitions(mcpTools)];
}

/** Hot-swap skill tools without touching built-in or MCP tools */
export function updateSkillTools(skillTools: ToolDefinition[]): void {
  const nonSkill = registeredTools.filter((t) => t.source !== 'skill');
  registeredTools = [...nonSkill, ...ensureSafeToolDefinitions(skillTools)];
}

/** Hot-swap plugin tools without touching built-in, MCP, or skill tools */
export function updatePluginTools(pluginTools: ToolDefinition[]): void {
  const nonPlugin = registeredTools.filter((t) => t.source !== 'plugin');
  registeredTools = [...nonPlugin, ...ensureSafeToolDefinitions(pluginTools)];
}

export function registerAgentHandlers(ipcMain: IpcMain, appHome: string): void {
  const dbPath = join(appHome, 'data', 'memory.db');

  ipcMain.handle(
    'agent:stream',
    async (
      _event,
      conversationId: string,
      messages: unknown[],
      modelKey?: string,
      reasoningEffort?: ReasoningEffort,
      profileKey?: string,
      fallbackEnabled?: boolean,
    ) => {
    // Cancel any existing stream for this conversation
    const existing = activeStreams.get(conversationId);
    if (existing) existing.abort();

    const controller = new AbortController();
    activeStreams.set(conversationId, { abort: () => controller.abort() });
    const observerSessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    activeObserverSessions.set(conversationId, observerSessionId);

    let config: AppConfig;
    try {
      config = readEffectiveConfig(appHome);
    } catch (error) {
      broadcastStreamEvent({
        conversationId,
        type: 'error',
        error: 'Failed to load config: ' + (error instanceof Error ? error.message : String(error)),
      });
      broadcastStreamEvent({ conversationId, type: 'done' });
      return { conversationId };
    }

    let streamConfig = resolveStreamConfig(config, {
      threadModelKey: modelKey ?? null,
      threadProfileKey: profileKey ?? null,
      reasoningEffort,
      fallbackEnabled: fallbackEnabled ?? false,
    });
    let modelEntry = streamConfig?.primaryModel ?? null;
    const backend = await resolveAgentBackend(config);
    const messageList = messages as Array<{ role?: string; content?: unknown }>;
    console.info(`[Agent:stream] conv=${conversationId} backend=${backend} model=${modelKey ?? config.models.defaultModelKey} profile=${profileKey ?? 'none'} fallback=${fallbackEnabled ? 'on' : 'off'} fallbackModels=${streamConfig?.fallbackModels.length ?? 0} messageCount=${messageList.length}`);
    for (const [index, message] of messageList.entries()) {
      const contentPreview = typeof message.content === 'string'
        ? message.content.slice(0, 200)
        : Array.isArray(message.content)
          ? JSON.stringify(message.content).slice(0, 200)
          : String(message.content ?? '').slice(0, 200);
      console.info(`[Agent:stream]   msg[${index}] role=${message.role ?? '?'} contentLen=${JSON.stringify(message.content ?? '').length} preview=${contentPreview}`);
    }

    if (!modelEntry || !streamConfig) {
      if (backend === 'legion-daemon') {
        // Daemon manages its own models — create a passthrough config so the request proceeds
        const fallbackModelConfig: LLMModelConfig = {
          provider: 'openai-compatible',
          endpoint: '',
          apiKey: '',
          modelName: '',
          temperature: config.advanced.temperature,
          maxSteps: config.advanced.maxSteps,
          maxRetries: config.advanced.maxRetries,
        };
        const fallbackEntry: ModelCatalogEntry = {
          key: '__daemon_default__',
          displayName: 'Daemon Default',
          modelConfig: fallbackModelConfig,
        };
        modelEntry = fallbackEntry;
        streamConfig = {
          primaryModel: fallbackEntry,
          fallbackModels: [],
          fallbackEnabled: false,
          systemPrompt: config.systemPrompt,
          temperature: config.advanced.temperature,
          maxSteps: config.advanced.maxSteps,
          maxRetries: config.advanced.maxRetries,
          useResponsesApi: false,
        };
      } else {
        broadcastStreamEvent({
          conversationId,
          type: 'text-delta',
          text: 'No model configured. Please add a model provider in Settings and ensure your API key is set.',
        });
        broadcastStreamEvent({ conversationId, type: 'done' });
        return { conversationId };
      }
    }

    // Run streaming in background
    (async () => {
      if (backend !== 'mastra') {
        try {
          let daemonMessages = messages;

          if (backend === 'legion-daemon' && config.compaction?.conversation?.enabled) {
            const chatMessages = messages as Array<{ role: string; content: unknown; id?: string }>;
            const check = shouldCompact(
              chatMessages as Parameters<typeof shouldCompact>[0],
              modelEntry.modelConfig.modelName,
              config.compaction.conversation.triggerPercent,
              modelEntry.modelConfig.maxInputTokens,
            );

            if (check.shouldCompact) {
              broadcastStreamEvent({
                conversationId,
                type: 'context-usage',
                data: {
                  usedTokens: check.usedTokens,
                  contextWindowTokens: check.contextWindowTokens,
                  phase: 'pre-compaction',
                },
              });

              const compactionResult = await compactConversationPrefix(
                chatMessages as Parameters<typeof compactConversationPrefix>[0],
                modelEntry.modelConfig,
                config.compaction.conversation,
              );

              if (!controller.signal.aborted && compactionResult.compactedMessages) {
                broadcastStreamEvent({
                  conversationId,
                  type: 'compaction',
                  data: {
                    compactionId: compactionResult.compactionId,
                    summaryText: compactionResult.summaryText,
                    compactedMessageIds: compactionResult.compactedMessageIds,
                  },
                });
                daemonMessages = compactionResult.compactedMessages;
              }
            }
          }

          if (controller.signal.aborted) {
            broadcastStreamEvent({ conversationId, type: 'done' });
            return;
          }

          // Serialize registered tools to JSON Schema for daemon inference
          const toolSchemas = registeredTools
            .filter((t) => typeof t.inputSchema?.safeParse === 'function')
            .map((t) => {
              try {
                // Use Zod's built-in JSON Schema output if available, otherwise
                // build a minimal schema from the Zod shape
                const shape = (t.inputSchema as { shape?: Record<string, unknown> }).shape;
                const properties: Record<string, unknown> = {};
                const required: string[] = [];
                if (shape && typeof shape === 'object') {
                  for (const [key, val] of Object.entries(shape)) {
                    const zodField = val as { _def?: { typeName?: string; description?: string }; isOptional?: () => boolean; description?: string };
                    properties[key] = { type: 'string', description: zodField.description ?? zodField._def?.description ?? '' };
                    if (typeof zodField.isOptional !== 'function' || !zodField.isOptional()) {
                      required.push(key);
                    }
                  }
                }
                return {
                  name: t.name,
                  description: t.description,
                  input_schema: { type: 'object' as const, properties, ...(required.length ? { required } : {}) },
                };
              } catch {
                return null;
              }
            })
            .filter(Boolean) as Array<{ name: string; description: string; input_schema: Record<string, unknown> }>;

          console.info(`[Agent] Forwarding ${toolSchemas.length} tools to daemon:`, toolSchemas.map((t) => t.name));

          const stream = streamAppAgent({
            conversationId,
            messages: daemonMessages,
            modelConfig: modelEntry.modelConfig,
            config,
            appHome,
            abortSignal: controller.signal,
            reasoningEffort,
            tools: toolSchemas,
          });

          for await (const event of stream) {
            if (activeObserverSessions.get(conversationId) !== observerSessionId) continue;
            if (controller.signal.aborted && event.type !== 'done') continue;
            broadcastStreamEvent(event);
          }
        } catch (error) {
          if (!controller.signal.aborted) {
            broadcastStreamEvent({
              conversationId,
              type: 'error',
              error: error instanceof Error ? error.message : String(error),
            });
            broadcastStreamEvent({ conversationId, type: 'done' });
          }
        } finally {
          activeStreams.delete(conversationId);
          if (activeObserverSessions.get(conversationId) === observerSessionId) {
            activeObserverSessions.delete(conversationId);
          }
        }
        return;
      }

      const toolCancels = new Map<string, () => void>();
      const pendingObserverToolExecutions = new Set<Promise<void>>();
      let observerLaunchesEnabled = true;
      let observer: ToolObserverManager | null = null;
      // Compaction metadata keyed by execute-side toolCallId.
      // Populated in augmentToolResult, consumed when the matching
      // tool-result stream event is broadcast.
      const compactionByExecuteId = new Map<string, {
        originalContent: string;
        wasCompacted: boolean;
        extractionDurationMs: number;
      }>();
      type PendingToolCompactionEvent = {
        toolName: string;
        data: {
          phase: 'start' | 'complete';
          originalContent?: string;
          extractionDurationMs?: number;
          timestamp: string;
        };
      };
      const pendingExecIdsByToolName = new Map<string, string[]>();
      const pendingStreamIdsByToolName = new Map<string, string[]>();
      const streamToolCallIdByExecId = new Map<string, string>();
      const execToolCallIdByStreamId = new Map<string, string>();
      const pendingToolCompactionByExecId = new Map<string, PendingToolCompactionEvent[]>();

      const enqueueByToolName = (map: Map<string, string[]>, toolName: string, id: string): void => {
        const queue = map.get(toolName) ?? [];
        queue.push(id);
        map.set(toolName, queue);
      };

      const shiftByToolName = (map: Map<string, string[]>, toolName: string): string | null => {
        const queue = map.get(toolName);
        if (!queue || queue.length === 0) return null;
        const value = queue.shift() ?? null;
        if (queue.length === 0) {
          map.delete(toolName);
        }
        return value;
      };

      const queueOrBroadcastToolCompaction = (
        executeToolCallId: string,
        toolName: string,
        data: PendingToolCompactionEvent['data'],
        mode: 'defer-until-stream-id' | 'direct',
      ): void => {
        if (mode === 'direct') {
          logToolCompactionDebug('broadcast-tool-compaction', {
            conversationId,
            toolCallId: executeToolCallId,
            toolName,
            phase: data.phase,
            mode,
            hasOriginalContent: typeof data.originalContent === 'string' && data.originalContent.length > 0,
            extractionDurationMs: data.extractionDurationMs ?? null,
          });
          broadcastStreamEvent({
            conversationId,
            type: 'tool-compaction',
            toolCallId: executeToolCallId,
            toolName,
            data,
          });
          return;
        }

        const streamToolCallId = streamToolCallIdByExecId.get(executeToolCallId);
        if (streamToolCallId) {
          logToolCompactionDebug('broadcast-tool-compaction-after-pair', {
            conversationId,
            toolCallId: executeToolCallId,
            streamToolCallId,
            toolName,
            phase: data.phase,
            mode,
            hasOriginalContent: typeof data.originalContent === 'string' && data.originalContent.length > 0,
            extractionDurationMs: data.extractionDurationMs ?? null,
          });
          broadcastStreamEvent({
            conversationId,
            type: 'tool-compaction',
            toolCallId: streamToolCallId,
            toolName,
            data,
          });
          return;
        }

        const pending = pendingToolCompactionByExecId.get(executeToolCallId) ?? [];
        pending.push({ toolName, data });
        pendingToolCompactionByExecId.set(executeToolCallId, pending);
        logToolCompactionDebug('queue-tool-compaction', {
          conversationId,
          toolCallId: executeToolCallId,
          toolName,
          phase: data.phase,
          mode,
          queueLength: pending.length,
          hasOriginalContent: typeof data.originalContent === 'string' && data.originalContent.length > 0,
          extractionDurationMs: data.extractionDurationMs ?? null,
        });
      };

      const flushPendingToolCompaction = (executeToolCallId: string): void => {
        const streamToolCallId = streamToolCallIdByExecId.get(executeToolCallId);
        const pending = pendingToolCompactionByExecId.get(executeToolCallId);
        if (!streamToolCallId || !pending || pending.length === 0) return;

        pendingToolCompactionByExecId.delete(executeToolCallId);
        for (const event of pending) {
          logToolCompactionDebug('flush-tool-compaction', {
            conversationId,
            toolCallId: executeToolCallId,
            streamToolCallId,
            toolName: event.toolName,
            phase: event.data.phase,
            queueLength: pending.length,
            hasOriginalContent: typeof event.data.originalContent === 'string' && event.data.originalContent.length > 0,
            extractionDurationMs: event.data.extractionDurationMs ?? null,
          });
          broadcastStreamEvent({
            conversationId,
            type: 'tool-compaction',
            toolCallId: streamToolCallId,
            toolName: event.toolName,
            data: event.data,
          });
        }
      };

      const pairExecuteAndStreamToolCallIds = (toolName: string): string | null => {
        const executeToolCallId = shiftByToolName(pendingExecIdsByToolName, toolName);
        const streamToolCallId = shiftByToolName(pendingStreamIdsByToolName, toolName);
        if (!executeToolCallId || !streamToolCallId) {
          if (executeToolCallId) enqueueByToolName(pendingExecIdsByToolName, toolName, executeToolCallId);
          if (streamToolCallId) enqueueByToolName(pendingStreamIdsByToolName, toolName, streamToolCallId);
          return null;
        }

        streamToolCallIdByExecId.set(executeToolCallId, streamToolCallId);
        execToolCallIdByStreamId.set(streamToolCallId, executeToolCallId);
        logToolCompactionDebug('pair-tool-call-ids', {
          conversationId,
          toolName,
          executeToolCallId,
          streamToolCallId,
        });
        flushPendingToolCompaction(executeToolCallId);
        return executeToolCallId;
      };

      const maybeCompactToolOutput = async (
        toolCallId: string,
        toolName: string,
        result: unknown,
        lifecycleMode: 'defer-until-stream-id' | 'direct',
      ): Promise<{
        result: unknown;
        compaction?: {
          originalContent: string;
          wasCompacted: boolean;
          extractionDurationMs: number;
        };
      }> => {
        const toolCompaction = config.compaction?.tool as ToolCompactionConfig | undefined;
        if (!toolCompaction?.enabled || controller.signal.aborted) {
          return { result };
        }

        const originalText = stringifyToolResult(result);
        const userQuery = extractLatestUserQuery(messages);
        const shouldAttemptCompaction = originalText.length > 0
          && estimateToolTokens(originalText, modelEntry?.modelConfig.modelName) > toolCompaction.triggerTokens;

        logToolCompactionDebug('evaluate-tool-output', {
          conversationId,
          toolCallId,
          toolName,
          lifecycleMode,
          originalLength: originalText.length,
          triggerTokens: toolCompaction.triggerTokens,
          modelName: modelEntry?.modelConfig.modelName ?? null,
          shouldAttemptCompaction,
        });

        if (!shouldAttemptCompaction) {
          return { result };
        }

        queueOrBroadcastToolCompaction(toolCallId, toolName, {
          phase: 'start',
          originalContent: originalText,
          timestamp: nowIso(),
        }, lifecycleMode);

        try {
          const compactionResult = await compactToolResult(
            originalText,
            toolName,
            userQuery,
            toolCompaction,
            modelEntry?.modelConfig,
            modelEntry?.modelConfig.modelName,
          );

          if (compactionResult.wasCompacted && !controller.signal.aborted) {
            queueOrBroadcastToolCompaction(toolCallId, toolName, {
              phase: 'complete',
              extractionDurationMs: compactionResult.extractionDurationMs ?? 0,
              timestamp: nowIso(),
            }, lifecycleMode);

            logToolCompactionDebug('compaction-complete', {
              conversationId,
              toolCallId,
              toolName,
              lifecycleMode,
              compactedLength: typeof compactionResult.content === 'string' ? compactionResult.content.length : null,
              extractionDurationMs: compactionResult.extractionDurationMs ?? 0,
            });

            return {
              result: compactionResult.content,
              compaction: {
                originalContent: originalText,
                wasCompacted: true,
                extractionDurationMs: compactionResult.extractionDurationMs ?? 0,
              },
            };
          }
        } catch (compactionError) {
          logToolCompactionDebug('compaction-error', {
            conversationId,
            toolCallId,
            toolName,
            lifecycleMode,
            error: compactionError instanceof Error ? compactionError.message : String(compactionError),
          });
          console.warn('[Agent] Tool compaction failed for', toolName, ':', compactionError);
        }

        return { result };
      };

      const waitForObserverToolExecutions = async (): Promise<void> => {
        while (pendingObserverToolExecutions.size > 0) {
          const pending = Array.from(pendingObserverToolExecutions);
          await Promise.allSettled(pending);
        }
      };

      const launchObserverToolCall = async (toolName: string, args: unknown): Promise<LaunchToolCallResult> => {
        if (!observer) {
          return { ok: false, details: 'Observer runtime not initialized.' };
        }
        if (!observerLaunchesEnabled) {
          return { ok: false, details: 'Observer launches are disabled for this run phase.' };
        }
        if (activeObserverSessions.get(conversationId) !== observerSessionId) {
          return { ok: false, details: 'Observer session is not active for this thread.' };
        }
        if (controller.signal.aborted) {
          return { ok: false, details: 'Thread run is already cancelled.' };
        }

        const tool = findToolByName(registeredTools, toolName);
        if (!tool) {
          return { ok: false, details: `Tool "${toolName}" is not registered.` };
        }

        const toolCallId = `tc-obs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const startedAt = new Date().toISOString();
        const localAbortController = new AbortController();
        const cancel = (): void => {
          if (!localAbortController.signal.aborted) {
            localAbortController.abort();
          }
        };
        const mergedAbortSignal = mergeAbortSignals(controller.signal, localAbortController.signal);
        toolCancels.set(toolCallId, cancel);

        observer.onToolExecutionStart({
          toolCallId,
          toolName,
          args,
          observerInitiated: true,
        });

        broadcastStreamEvent({
          conversationId,
          type: 'tool-call',
          toolCallId,
          toolName,
          args,
          startedAt,
          observerInitiated: true,
        });

        const runObserverToolExecution = async (): Promise<void> => {
          try {
            const context: ToolExecutionContext = {
              toolCallId,
              conversationId,
              abortSignal: mergedAbortSignal,
              onProgress: (progress) => {
                if (activeObserverSessions.get(conversationId) !== observerSessionId) return;
                observer?.onToolProgress({
                  toolCallId,
                  toolName,
                  data: progress,
                });
                if (!controller.signal.aborted) {
                  broadcastStreamEvent({
                    conversationId,
                    type: 'tool-progress',
                    toolCallId,
                    toolName,
                    data: progress,
                  });
                }
              },
            };

            const rawResult = await tool.execute(args, context);
            observer?.onToolExecutionResult(toolCallId, toolName, rawResult);
            const observerAugmented = withObserverAugmentation(rawResult, observer?.getToolAugmentation(toolCallId));
            const compacted = await maybeCompactToolOutput(
              toolCallId,
              toolName,
              observerAugmented,
              'direct',
            );
            const finishedAt = new Date().toISOString();

            if (activeObserverSessions.get(conversationId) === observerSessionId && !controller.signal.aborted) {
              broadcastStreamEvent({
                conversationId,
                type: 'tool-result',
                toolCallId,
                toolName,
                result: compacted.result,
                startedAt,
                finishedAt,
                observerInitiated: true,
                ...(compacted.compaction ? { compaction: compacted.compaction } : {}),
              });
            }
          } catch (error) {
            const errorResult = {
              isError: true,
              error: error instanceof Error ? error.message : String(error),
            };
            observer?.onToolExecutionResult(toolCallId, toolName, errorResult);
            const observerAugmented = withObserverAugmentation(errorResult, observer?.getToolAugmentation(toolCallId));
            const compacted = await maybeCompactToolOutput(
              toolCallId,
              toolName,
              observerAugmented,
              'direct',
            );
            const finishedAt = new Date().toISOString();

            if (activeObserverSessions.get(conversationId) === observerSessionId && !controller.signal.aborted) {
              broadcastStreamEvent({
                conversationId,
                type: 'tool-result',
                toolCallId,
                toolName,
                result: compacted.result,
                startedAt,
                finishedAt,
                observerInitiated: true,
                ...(compacted.compaction ? { compaction: compacted.compaction } : {}),
              });
            }
          } finally {
            toolCancels.delete(toolCallId);
            observer?.onToolExecutionEnd(toolCallId);
          }
        };

        // Defer execution to the next tick so observer-side parent linkage is established
        // before very fast tools emit their first result.
        let launchPromise: Promise<void> | null = null;
        launchPromise = new Promise<void>((resolve) => {
          setTimeout(() => {
            void runObserverToolExecution().finally(() => resolve());
          }, 0);
        }).finally(() => {
          if (launchPromise) pendingObserverToolExecutions.delete(launchPromise);
        });
        pendingObserverToolExecutions.add(launchPromise);

        return { ok: true, launchedToolCallId: toolCallId, details: 'Observer-launched tool started.' };
      };

      try {
        if (controller.signal.aborted) {
          broadcastStreamEvent({ conversationId, type: 'done' });
          return;
        }
        // Check if compaction is needed
        if (config.compaction.conversation.enabled) {
          const chatMessages = messages as Array<{ role: string; content: unknown; id?: string }>;
          const check = shouldCompact(
            chatMessages as Parameters<typeof shouldCompact>[0],
            modelEntry.modelConfig.modelName,
            config.compaction.conversation.triggerPercent,
            modelEntry.modelConfig.maxInputTokens,
          );

          if (check.shouldCompact) {
            broadcastStreamEvent({
              conversationId,
              type: 'context-usage',
              data: {
                usedTokens: check.usedTokens,
                contextWindowTokens: check.contextWindowTokens,
                phase: 'pre-compaction',
              },
            });

            const compactionResult = await compactConversationPrefix(
              chatMessages as Parameters<typeof compactConversationPrefix>[0],
              modelEntry.modelConfig,
              config.compaction.conversation,
            );
            if (controller.signal.aborted) {
              broadcastStreamEvent({ conversationId, type: 'done' });
              return;
            }

            if (compactionResult.compactedMessages) {
              broadcastStreamEvent({
                conversationId,
                type: 'compaction',
                data: {
                  compactionId: compactionResult.compactionId,
                  summaryText: compactionResult.summaryText,
                  compactedMessageIds: compactionResult.compactedMessageIds,
                },
              });
              messages = compactionResult.compactedMessages;
            }
          }
        }

        observer = new ToolObserverManager({
          conversationId,
          modelConfig: modelEntry.modelConfig,
          config: resolveToolObserverConfig(config),
          userRequestSummary: summarizeLatestUserRequest(messages),
          baseThreadContext: summarizeThreadContext(messages),
          emitMidToolMessage: (text) => {
            if (activeObserverSessions.get(conversationId) !== observerSessionId) return;
            if (!controller.signal.aborted) {
              broadcastStreamEvent({
                conversationId,
                type: 'observer-message',
                text,
              });
            }
          },
          cancelToolCall: (toolCallId) => {
            if (activeObserverSessions.get(conversationId) !== observerSessionId) return false;
            const cancel = toolCancels.get(toolCallId);
            if (!cancel) return false;
            cancel();
            return true;
          },
          launchToolCall: launchObserverToolCall,
          messageSubAgent: (toolCallId, message) => {
            return sendSubAgentFollowUpByToolCall(toolCallId, message);
          },
        });

        const streamOptions = {
            reasoningEffort,
            abortSignal: controller.signal,
            emitEvent: (event: StreamEvent) => {
              if (event.type === 'tool-progress') {
                if (activeObserverSessions.get(conversationId) !== observerSessionId) return;
                observer?.onToolProgress({
                  toolCallId: event.toolCallId,
                  toolName: event.toolName,
                  data: event.data as {
                    stream?: 'stdout' | 'stderr';
                    output?: string;
                    delta?: string;
                    bytesSeen?: number;
                    truncated?: boolean;
                    stopped?: boolean;
                  } | undefined,
                });
              }
              // Side-channel events (tool progress) should stop immediately on abort.
              if (!controller.signal.aborted) {
                broadcastStreamEvent(event);
              }
            },
            onToolExecutionStart: (state: { toolCallId: string; toolName: string; args: unknown; cancel: () => void }) => {
              toolCancels.set(state.toolCallId, state.cancel);
              enqueueByToolName(pendingExecIdsByToolName, state.toolName, state.toolCallId);
              pairExecuteAndStreamToolCallIds(state.toolName);
              observer?.onToolExecutionStart(state);
            },
            onToolExecutionEnd: ({ toolCallId }: { toolCallId: string; toolName: string }) => {
              toolCancels.delete(toolCallId);
              observer?.onToolExecutionEnd(toolCallId);
            },
            augmentToolResult: async ({ toolCallId, toolName, result }: { toolCallId: string; toolName: string; args: unknown; result: unknown }) => {
              await observer?.waitForLinkedLaunchedTools(toolCallId);
              observer?.onToolExecutionResult(toolCallId, toolName, result);
              const observerAugmented = withObserverAugmentation(result, observer?.getToolAugmentation(toolCallId));
              const compacted = await maybeCompactToolOutput(
                toolCallId,
                toolName,
                observerAugmented,
                'defer-until-stream-id',
              );
              if (compacted.compaction) {
                compactionByExecuteId.set(toolCallId, compacted.compaction);
              }
              return compacted.result;
            },
          };

        // Apply profile system prompt override to config
        const configForStream: AppConfig = {
          ...config,
          systemPrompt: streamConfig.systemPrompt,
          advanced: {
            ...config.advanced,
            temperature: streamConfig.temperature,
            maxSteps: streamConfig.maxSteps,
            maxRetries: streamConfig.maxRetries,
          },
        };

        const stream = streamConfig.fallbackEnabled
          ? streamWithFallback(
              conversationId,
              messages,
              streamConfig,
              config,
              registeredTools,
              dbPath,
              streamOptions,
            )
          : streamAgentResponse(
              conversationId,
              messages,
              modelEntry.modelConfig,
              configForStream,
              registeredTools,
              dbPath,
              streamOptions,
            );

        for await (const event of stream) {
          if (event.type === 'tool-call' || event.type === 'tool-result' || event.type === 'tool-compaction') {
            logToolCompactionDebug('stream-event', {
              conversationId,
              eventType: event.type,
              toolCallId: event.toolCallId ?? null,
              toolName: event.toolName ?? null,
              hasCompaction: 'compaction' in event && Boolean(event.compaction),
              compactionPhase: event.type === 'tool-compaction'
                ? ((event.data as { phase?: string } | undefined)?.phase ?? null)
                : null,
            });
          }
          if (event.type === 'tool-call' && event.toolCallId && event.toolName) {
            enqueueByToolName(pendingStreamIdsByToolName, event.toolName, event.toolCallId);
            pairExecuteAndStreamToolCallIds(event.toolName);
          }
          if (event.type === 'tool-result' && event.toolCallId) {
            observer?.onToolExecutionEnd(event.toolCallId);
            // Inject compaction metadata into the event's data field
            const execId = execToolCallIdByStreamId.get(event.toolCallId) ?? event.toolCallId;
            const compaction = execId ? compactionByExecuteId.get(execId) : undefined;
            if (compaction) {
              compactionByExecuteId.delete(execId!);
              // Attach as a data field the renderer will pick up
              (event as Record<string, unknown>).compaction = compaction;
              logToolCompactionDebug('attach-result-compaction', {
                conversationId,
                toolCallId: event.toolCallId,
                executeToolCallId: execId,
                toolName: event.toolName ?? null,
                extractionDurationMs: compaction.extractionDurationMs,
                originalLength: compaction.originalContent.length,
              });
            }
            if (execId) {
              streamToolCallIdByExecId.delete(execId);
            }
            execToolCallIdByStreamId.delete(event.toolCallId);
            pendingToolCompactionByExecId.delete(execId);
          }
          if (event.type === 'done' && !controller.signal.aborted) {
            observerLaunchesEnabled = false;
            await waitForObserverToolExecutions();
          }
          if (activeObserverSessions.get(conversationId) !== observerSessionId) {
            continue;
          }
          broadcastStreamEvent(event);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          broadcastStreamEvent({
            conversationId,
            type: 'error',
            error: error instanceof Error ? error.message : String(error),
          });
          broadcastStreamEvent({ conversationId, type: 'done' });
        }
      } finally {
        observerLaunchesEnabled = false;
        await waitForObserverToolExecutions();
        observer?.dispose();
        activeStreams.delete(conversationId);
        if (activeObserverSessions.get(conversationId) === observerSessionId) {
          activeObserverSessions.delete(conversationId);
        }
      }
    })();

      return { conversationId };
    },
  );

  ipcMain.handle('agent:cancel-stream', async (_event, conversationId: string) => {
    const controller = activeStreams.get(conversationId);
    if (controller) {
      controller.abort();
      activeStreams.delete(conversationId);
    }
    activeObserverSessions.delete(conversationId);
    return { ok: true };
  });

  ipcMain.handle('agent:app-status', async () => {
    try {
      const config = readEffectiveConfig(appHome);
      return await getAppStatus(config, appHome);
    } catch (error) {
      return {
        backend: 'mastra',
        daemon: {
          ok: false,
          status: 'request_failed',
          url: 'http://127.0.0.1:4567',
          error: error instanceof Error ? error.message : String(error),
        },
      };
    }
  });

  ipcMain.handle('agent:generate-title', async (_event, messages: unknown[], modelKey?: string) => {
    let config: AppConfig;
    try {
      config = readEffectiveConfig(appHome);
    } catch {
      return { title: null };
    }

    const modelEntry = resolveTitleModel(config, modelKey ?? null);
    if (!modelEntry) return { title: null };

    try {
      const { Agent } = await import('@mastra/core/agent');
      const model = await createLanguageModelFromConfig(modelEntry.modelConfig);
      type AgentConfig = ConstructorParameters<typeof Agent>[0];

      const agent = new Agent({
        id: `title-gen-${Date.now()}`,
        name: 'title-generator',
        instructions: [
          'Generate a concise conversation title using at most 4 words.',
          'Summarize the user\'s main topic or task, not the assistant\'s answer.',
          'Use a neutral noun phrase, not a sentence.',
          'Avoid apologies, disclaimers, or copied response text.',
          'Return only the title text with no quotes or formatting.',
        ].join(' '),
        model: model as AgentConfig['model'],
      });

      const titleInput = buildTitleGenerationInput(messages);
      if (!titleInput) return { title: null };

      let lastError: unknown;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const result = await agent.generate(titleInput, { maxSteps: 1 });
          const rawTitle = typeof result.text === 'string' ? result.text : null;
          const title = normalizeGeneratedTitle(rawTitle);
          return { title };
        } catch (error) {
          lastError = error;
          if (!isRetryableTitleGenerationError(error) || attempt === 2) {
            throw error;
          }
          await sleep(600 * (attempt + 1));
        }
      }

      throw lastError;
    } catch (error) {
      if (isRetryableTitleGenerationError(error)) {
        console.warn('[Agent] Title generation skipped after retryable provider error.');
      } else {
        console.error('[Agent] Title generation failed:', error);
      }
      return { title: null };
    }
  });

  // Sub-agent interaction handlers
  ipcMain.handle('agent:sub-agent-message', async (_event, subAgentConversationId: string, message: string) => {
    const ok = sendSubAgentFollowUp(subAgentConversationId, message);
    return { ok, subAgentConversationId };
  });

  ipcMain.handle('agent:sub-agent-stop', async (_event, subAgentConversationId: string) => {
    const ok = stopSubAgent(subAgentConversationId);
    return { ok, subAgentConversationId };
  });

  ipcMain.handle('agent:sub-agent-list', async () => {
    return { ids: getActiveSubAgentIds() };
  });

  // Model catalog endpoint
  ipcMain.handle('agent:model-catalog', () => {
    try {
      const config = readEffectiveConfig(appHome);
      const catalog = resolveModelCatalog(config);
      return {
        models: catalog.entries.map((e: { key: string; displayName: string; modelConfig: { maxInputTokens?: number }; computerUseSupport?: string; visionCapable?: boolean; preferredTarget?: string }) => ({
          key: e.key,
          displayName: e.displayName,
          maxInputTokens: e.modelConfig.maxInputTokens,
          computerUseSupport: e.computerUseSupport,
          visionCapable: e.visionCapable,
          preferredTarget: e.preferredTarget,
        })),
        defaultKey: catalog.defaultEntry?.key ?? null,
      };
    } catch {
      return { models: [], defaultKey: null };
    }
  });

  // Profile catalog endpoint
  ipcMain.handle('agent:profiles', () => {
    try {
      const config = readEffectiveConfig(appHome);
      return {
        profiles: (config.profiles ?? []).map((p) => ({
          key: p.key,
          name: p.name,
          primaryModelKey: p.primaryModelKey,
          fallbackModelKeys: p.fallbackModelKeys,
        })),
        defaultKey: config.defaultProfileKey ?? null,
      };
    } catch {
      return { profiles: [], defaultKey: null };
    }
  });
}
