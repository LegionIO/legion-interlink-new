import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { toStandardSchema as toJsonStandardSchema } from '@mastra/schema-compat/adapters/json-schema';
import zodToJsonSchema from 'zod-to-json-schema';
import type { AppConfig } from '../config/schema.js';
import type { LLMModelConfig, ResolvedStreamConfig, ModelCatalogEntry, ReasoningEffort } from './model-catalog.js';
import { createLanguageModelFromConfig } from './language-model.js';
import { getSharedMemory, getResourceId } from './memory.js';
import type { ToolDefinition, ToolExecutionContext, ToolProgressEvent } from '../tools/types.js';

export type { ReasoningEffort } from './model-catalog.js';

export type StreamEvent = {
  conversationId: string;
  type: 'text-delta' | 'observer-message' | 'tool-call' | 'tool-result' | 'tool-error' | 'tool-progress' | 'tool-compaction' | 'error' | 'done' | 'compaction' | 'context-usage' | 'model-fallback' | 'enrichment';
  text?: string;
  toolCallId?: string;
  toolName?: string;
  args?: unknown;
  result?: unknown;
  error?: string;
  data?: unknown;
  startedAt?: string;
  finishedAt?: string;
  observerInitiated?: boolean;
  compaction?: {
    originalContent: string;
    wasCompacted: boolean;
    extractionDurationMs: number;
  };
};

type AgentConfig = ConstructorParameters<typeof Agent>[0];
type JsonStandardSchemaInput = Parameters<typeof toJsonStandardSchema>[0];
type MastraToolExecutionOptions = {
  toolCallId?: string;
  abortSignal?: AbortSignal;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const maybe = error as { data?: { message?: string }; responseBody?: string; message?: string };
    if (typeof maybe.data?.message === 'string') return maybe.data.message;
    if (typeof maybe.message === 'string') return maybe.message;
    if (typeof maybe.responseBody === 'string' && maybe.responseBody.length > 0) return maybe.responseBody;
  }
  return String(error);
}

function isRetryableBedrock503(error: unknown, modelConfig: LLMModelConfig): boolean {
  if (modelConfig.provider !== 'amazon-bedrock') return false;
  if (!error || typeof error !== 'object') return false;

  const candidate = error as {
    statusCode?: number;
    isRetryable?: boolean;
    responseHeaders?: Record<string, string | undefined>;
  };

  const errType = candidate.responseHeaders?.['x-amzn-errortype'] ?? candidate.responseHeaders?.['X-Amzn-Errortype'];
  return candidate.statusCode === 503
    && candidate.isRetryable === true
    && typeof errType === 'string'
    && errType.includes('ServiceUnavailableException');
}

function shouldRetryWithoutTemperature(
  error: unknown,
  modelSettings: Record<string, unknown>,
  emittedAnyOutput: boolean,
): boolean {
  if (emittedAnyOutput) return false;
  if (typeof modelSettings.temperature !== 'number') return false;

  const messageParts: string[] = [];
  if (error instanceof Error && error.message) {
    messageParts.push(error.message);
  }
  if (typeof error === 'string') {
    messageParts.push(error);
  } else if (error && typeof error === 'object') {
    const maybe = error as { data?: { message?: string }; responseBody?: string; message?: string };
    if (typeof maybe.data?.message === 'string') messageParts.push(maybe.data.message);
    if (typeof maybe.responseBody === 'string') messageParts.push(maybe.responseBody);
    if (typeof maybe.message === 'string') messageParts.push(maybe.message);
  }

  const message = messageParts.join('\n').toLowerCase();
  if (!message.includes('temperature')) return false;

  return /unsupported parameter:\s*'temperature'/.test(message)
    || message.includes('temperature is not supported')
    || /only (?:the )?default \(1\) value is supported/.test(message);
}

function omitTemperature(modelSettings: Record<string, unknown>): Record<string, unknown> {
  const next = { ...modelSettings };
  delete next.temperature;
  return next;
}

function withTemperatureOmissionHeader(modelConfig: LLMModelConfig): LLMModelConfig {
  return {
    ...modelConfig,
    extraHeaders: {
      ...(modelConfig.extraHeaders ?? {}),
      'x-skynet-omit-temperature': '1',
    },
  };
}

function toMastraInputSchema(inputSchema: ToolDefinition['inputSchema']) {
  const jsonSchema = zodToJsonSchema(inputSchema, {
    $refStrategy: 'none',
    target: 'jsonSchema7',
  });

  return toJsonStandardSchema(jsonSchema as JsonStandardSchemaInput);
}

function toMastraTools(
  conversationId: string,
  tools: ToolDefinition[],
  hooks?: {
    emitEvent?: (event: StreamEvent) => void;
    onToolExecutionStart?: (state: { toolCallId: string; toolName: string; args: unknown; cancel: () => void }) => void;
    onToolExecutionEnd?: (state: { toolCallId: string; toolName: string }) => void;
    augmentToolResult?: (state: {
      toolCallId: string;
      toolName: string;
      args: unknown;
      result: unknown;
    }) => Promise<unknown> | unknown;
  },
): Record<string, ReturnType<typeof createTool>> {
  const result: Record<string, ReturnType<typeof createTool>> = {};
  for (const tool of tools) {
    result[tool.name] = createTool({
      id: tool.name,
      description: tool.description,
      inputSchema: toMastraInputSchema(tool.inputSchema),
      execute: async (input, options) => {
        const mastraOptions = options as MastraToolExecutionOptions | undefined;
        const toolCallId = typeof mastraOptions?.toolCallId === 'string'
          ? mastraOptions.toolCallId
          : `tc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const localAbortController = new AbortController();
        const cancel = (): void => {
          if (!localAbortController.signal.aborted) {
            localAbortController.abort();
          }
        };

        const mergedAbortSignal = mergeAbortSignals(mastraOptions?.abortSignal, localAbortController.signal);
        hooks?.onToolExecutionStart?.({
          toolCallId,
          toolName: tool.name,
          args: input,
          cancel,
        });

        const ctx: ToolExecutionContext = {
          toolCallId,
          conversationId,
          abortSignal: mergedAbortSignal,
          onProgress: (progress: ToolProgressEvent) => {
            hooks?.emitEvent?.({
              conversationId,
              type: 'tool-progress',
              toolCallId,
              toolName: tool.name,
              data: progress,
            });
          },
        };
        try {
          const result = await tool.execute(input, ctx);
          if (hooks?.augmentToolResult) {
            return await hooks.augmentToolResult({
              toolCallId,
              toolName: tool.name,
              args: input,
              result,
            });
          }
          return result;
        } finally {
          hooks?.onToolExecutionEnd?.({ toolCallId, toolName: tool.name });
        }
      },
    });
  }
  return result;
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

/** Detect reasoning gateway Bedrock models that don't support streaming. */
function isReasoningGatewayModel(modelConfig: LLMModelConfig): boolean {
  if (modelConfig.provider !== 'amazon-bedrock') return false;
  const endpoint = modelConfig.endpoint?.toLowerCase() ?? '';
  return endpoint.includes('/ai-gateway-reasoning/');
}

function buildProviderOptions(
  modelConfig: LLMModelConfig,
  reasoningEffort?: ReasoningEffort,
): Record<string, unknown> | undefined {
  if (modelConfig.provider !== 'openai-compatible') return undefined;

  const openaiOptions: Record<string, unknown> = {};
  if (reasoningEffort) {
    openaiOptions.reasoningEffort = reasoningEffort;
  }
  if (modelConfig.useResponsesApi === true) {
    // Prevent SDK-side item_reference replay during tool-follow-up turns.
    openaiOptions.store = false;
  }

  return Object.keys(openaiOptions).length > 0
    ? { openai: openaiOptions }
    : undefined;
}

function buildMastraMemoryOptions(
  conversationId: string,
  memory: ReturnType<typeof getSharedMemory>,
): Record<string, unknown> | undefined {
  if (!memory) return undefined;

  return {
    memory: {
      thread: { id: conversationId },
      resource: getResourceId(),
    },
  };
}

type RawStreamChunk = {
  type?: string;
  payload?: Record<string, unknown>;
} & Record<string, unknown>;

function extractStreamText(payload?: Record<string, unknown>): string {
  if (!payload) return '';
  if (typeof payload.text === 'string') return payload.text;
  if (typeof payload.textDelta === 'string') return payload.textDelta;
  if (typeof payload.delta === 'string') return payload.delta;
  return '';
}

function extractStreamFinishReason(payload?: Record<string, unknown>): string | undefined {
  const stepResult = payload?.stepResult as { reason?: string } | undefined;
  if (typeof stepResult?.reason === 'string') return stepResult.reason;
  if (typeof payload?.finishReason === 'string') return payload.finishReason;
  return undefined;
}

function isExpectedMastraStructuralEvent(type: string): boolean {
  return type === 'start'
    || type === 'abort'
    || type === 'text-start'
    || type === 'text-end'
    || type === 'step-start'
    || type === 'stream-start'
    || type === 'response-metadata'
    || type === 'reasoning'
    || type === 'reasoning-start'
    || type === 'reasoning-delta'
    || type === 'reasoning-end'
    || type === 'reasoning-signature'
    || type === 'redacted-reasoning'
    || type === 'source'
    || type === 'file'
    || type === 'tool-call-streaming-start'
    || type === 'tool-call-input-streaming-start'
    || type === 'tool-call-input-streaming-end'
    || type === 'tool-call-delta'
    || type === 'tool-input-start'
    || type === 'tool-input-delta'
    || type === 'tool-input-end'
    || type === 'raw';
}

export async function* streamAgentResponse(
  conversationId: string,
  messages: unknown[],
  modelConfig: LLMModelConfig,
  config: AppConfig,
  tools: ToolDefinition[],
  dbPath: string,
  options?: {
    reasoningEffort?: ReasoningEffort;
    abortSignal?: AbortSignal;
    emitEvent?: (event: StreamEvent) => void;
    onToolExecutionStart?: (state: { toolCallId: string; toolName: string; args: unknown; cancel: () => void }) => void;
    onToolExecutionEnd?: (state: { toolCallId: string; toolName: string }) => void;
    augmentToolResult?: (state: { toolCallId: string; toolName: string; args: unknown; result: unknown }) => Promise<unknown> | unknown;
  },
): AsyncGenerator<StreamEvent> {
  const msgArray = messages as Array<{ role?: string; content?: unknown }>;
  console.info(`[Agent:upstream] conv=${conversationId} model=${modelConfig.modelName} provider=${modelConfig.provider} endpoint=${modelConfig.endpoint ?? 'default'}`);
  console.info(`[Agent:upstream] messageCount=${msgArray.length} roles=[${msgArray.map((m) => m.role ?? '?').join(',')}]`);

  const memory = getSharedMemory(config, dbPath);
  const mastraTools = toMastraTools(conversationId, tools, {
    emitEvent: options?.emitEvent,
    onToolExecutionStart: options?.onToolExecutionStart,
    onToolExecutionEnd: options?.onToolExecutionEnd,
    augmentToolResult: options?.augmentToolResult,
  });

  const buildAgent = async (activeModelConfig: LLMModelConfig): Promise<Agent> => {
    const model = await createLanguageModelFromConfig(activeModelConfig);
    return new Agent({
      id: `${__BRAND_APP_SLUG}-${conversationId}`,
      name: __BRAND_APP_SLUG,
      instructions: buildAgentInstructions(config.systemPrompt),
      model: model as AgentConfig['model'],
      tools: mastraTools,
      ...(memory ? { memory } : {}),
    });
  };

  const modelSettings: Record<string, unknown> = {};
  if (typeof config.advanced.temperature === 'number') {
    modelSettings.temperature = config.advanced.temperature;
  }
  const providerOptions = buildProviderOptions(modelConfig, options?.reasoningEffort);

  const useGenerate = isReasoningGatewayModel(modelConfig);

  if (useGenerate) {
    yield* generateWithSyntheticEvents(buildAgent, conversationId, messages, modelConfig, config, memory, modelSettings, providerOptions, options);
  } else {
    yield* streamWithRealEvents(buildAgent, conversationId, messages, modelConfig, config, memory, modelSettings, providerOptions, options);
  }
}

/**
 * Non-streaming path for reasoning gateway models.
 * Uses agent.generate() with onStepFinish to synthesize streaming events.
 */
async function* generateWithSyntheticEvents(
  buildAgent: (modelConfig: LLMModelConfig) => Promise<Agent>,
  conversationId: string,
  messages: unknown[],
  modelConfig: LLMModelConfig,
  config: AppConfig,
  memory: ReturnType<typeof getSharedMemory>,
  modelSettings: Record<string, unknown>,
  providerOptions: Record<string, unknown> | undefined,
  options?: {
    abortSignal?: AbortSignal;
    emitEvent?: (event: StreamEvent) => void;
  },
): AsyncGenerator<StreamEvent> {
  let terminalFinishReason: string | undefined;
  let activeModelSettings = { ...modelSettings };
  let activeModelConfig = { ...modelConfig };
  let compatibilityRetried = false;

  while (true) {
    const eventQueue: StreamEvent[] = [];

    try {
      const agent = await buildAgent(activeModelConfig);
      const msgArr = messages as Array<{ role?: string }>;
      console.info(
        `[Agent:generate] conv=${conversationId} messageCount=${msgArr.length} roles=[${msgArr.map((m) => m.role ?? '?').join(',')}] maxSteps=${config.advanced.maxSteps} temp=${typeof activeModelSettings.temperature === 'number' ? activeModelSettings.temperature : 'default'}`,
      );
      const memoryOptions = buildMastraMemoryOptions(conversationId, memory);

      const generateOptions = {
        maxSteps: config.advanced.maxSteps,
        abortSignal: options?.abortSignal,
        ...(Object.keys(activeModelSettings).length > 0 ? { modelSettings: activeModelSettings } : {}),
        ...(providerOptions ? { providerOptions } : {}),
        ...(memoryOptions ?? {}),
        onStepFinish: (step: unknown) => {
          const s = step as {
            text?: string;
            toolCalls?: Array<{ toolCallId: string; toolName: string; args: unknown }>;
            toolResults?: Array<{ toolCallId: string; toolName: string; result: unknown }>;
          };

          if (s.toolCalls) {
            for (const tc of s.toolCalls) {
              const startedAt = new Date().toISOString();
              eventQueue.push({
                conversationId,
                type: 'tool-call',
                toolCallId: tc.toolCallId,
                toolName: tc.toolName,
                args: tc.args,
                startedAt,
              });
            }
          }
          if (s.toolResults) {
            for (const tr of s.toolResults) {
              const finishedAt = new Date().toISOString();
              eventQueue.push({
                conversationId,
                type: 'tool-result',
                toolCallId: tr.toolCallId,
                toolName: tr.toolName,
                result: tr.result,
                finishedAt,
              });
            }
          }
        },
      };
      const generate = agent.generate.bind(agent) as unknown as (
        messageInput: Parameters<typeof agent.generate>[0],
        options: Record<string, unknown>,
      ) => ReturnType<typeof agent.generate>;
      const result = await generate(messages as Parameters<typeof agent.generate>[0], generateOptions);

      for (const event of eventQueue) {
        yield event;
      }

      const fullResult = result as { text?: string; finishReason?: string | { unified?: string } };
      if (fullResult.text) {
        yield {
          conversationId,
          type: 'text-delta',
          text: fullResult.text,
        };
      }
      terminalFinishReason = typeof fullResult.finishReason === 'string'
        ? fullResult.finishReason
        : fullResult.finishReason?.unified;

      console.info(`[Agent] Generate completed for ${conversationId}`);
      break;
    } catch (error) {
      const emittedAnyOutput = eventQueue.length > 0;
      if (!compatibilityRetried && shouldRetryWithoutTemperature(error, activeModelSettings, emittedAnyOutput)) {
        compatibilityRetried = true;
        activeModelSettings = omitTemperature(activeModelSettings);
        activeModelConfig = withTemperatureOmissionHeader(activeModelConfig);
        console.warn(`[Agent] Retrying ${conversationId} without temperature after compatibility error:`, getErrorMessage(error));
        continue;
      }

      for (const event of eventQueue) {
        yield event;
      }

      if (!options?.abortSignal?.aborted) {
        console.error(`[Agent] Generate error for ${conversationId}:`, error);
        yield {
          conversationId,
          type: 'error',
          error: error instanceof Error ? error.message : String(error),
        };
      }
      break;
    }
  }

  yield {
    conversationId,
    type: 'done',
    ...(terminalFinishReason ? { data: { finishReason: terminalFinishReason } } : {}),
  };
}

/**
 * Standard streaming path for models that support it.
 */
async function* streamWithRealEvents(
  buildAgent: (modelConfig: LLMModelConfig) => Promise<Agent>,
  conversationId: string,
  messages: unknown[],
  modelConfig: LLMModelConfig,
  config: AppConfig,
  memory: ReturnType<typeof getSharedMemory>,
  modelSettings: Record<string, unknown>,
  providerOptions: Record<string, unknown> | undefined,
  options?: {
    abortSignal?: AbortSignal;
  },
): AsyncGenerator<StreamEvent> {
  const toolStartByCallId = new Map<string, { startedAt: string; toolName: string }>();
  let emittedAnyOutput = false;
  let emittedTerminalError = false;
  let terminalFinishReason: string | undefined;
  let activeModelSettings = { ...modelSettings };
  let activeModelConfig = { ...modelConfig };
  let compatibilityRetried = false;
  // Accumulated token usage across all steps
  let accInputTokens = 0;
  let accOutputTokens = 0;
  let accCacheReadTokens = 0;
  let accCacheWriteTokens = 0;

  compatibilityLoop:
  while (true) {
    let requestCompleted = false;
    let compatibilityRetryRequested = false;
    const agent = await buildAgent(activeModelConfig);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        console.info(
          `[Agent] Starting stream for ${conversationId}${attempt > 0 ? ` (retry ${attempt})` : ''}${compatibilityRetried ? ' [temp-omitted]' : ''}`,
        );
        const memoryOptions = buildMastraMemoryOptions(conversationId, memory);

        const streamOptions = {
          maxSteps: config.advanced.maxSteps,
          abortSignal: options?.abortSignal,
          ...(Object.keys(activeModelSettings).length > 0 ? { modelSettings: activeModelSettings } : {}),
          ...(providerOptions ? { providerOptions } : {}),
          ...(memoryOptions ?? {}),
        };
        const stream = agent.stream.bind(agent) as unknown as (
          messageInput: Parameters<typeof agent.stream>[0],
          options: Record<string, unknown>,
        ) => ReturnType<typeof agent.stream>;
        const streamResult = await stream(messages as Parameters<typeof agent.stream>[0], streamOptions);

        const fullStream = streamResult.fullStream;
        const iterator =
          Symbol.asyncIterator in (fullStream as object)
            ? (fullStream as AsyncIterable<unknown>)
            : asAsyncIterable(fullStream as ReadableStream<unknown>);

        for await (const chunk of iterator) {
          const c = chunk as RawStreamChunk;
          const type = c?.type;
          const payload = (c?.payload ?? c) as Record<string, unknown> | undefined;

          if (type === 'text-delta') {
            const text = extractStreamText(payload);
            if (!text) continue;
            emittedAnyOutput = true;
            yield {
              conversationId,
              type: 'text-delta',
              text,
            };
          } else if (type === 'tool-call') {
            emittedAnyOutput = true;
            const toolCallId = (payload?.toolCallId as string) ?? `tc-${Date.now()}`;
            const toolName = (payload?.toolName as string) ?? 'unknown';
            const startedAt = new Date().toISOString();
            toolStartByCallId.set(toolCallId, { startedAt, toolName });
            yield {
              conversationId,
              type: 'tool-call',
              toolCallId,
              toolName,
              args: payload?.args ?? {},
              startedAt,
            };
          } else if (type === 'tool-result') {
            emittedAnyOutput = true;
            const toolCallId = (payload?.toolCallId as string) ?? '';
            const finishedAt = new Date().toISOString();
            const started = toolStartByCallId.get(toolCallId);
            toolStartByCallId.delete(toolCallId);
            yield {
              conversationId,
              type: 'tool-result',
              toolCallId,
              toolName: (payload?.toolName as string) ?? started?.toolName ?? '',
              result: payload?.result,
              startedAt: started?.startedAt ?? finishedAt,
              finishedAt,
            };
          } else if (type === 'tool-error') {
            emittedAnyOutput = true;
            const toolCallId = (payload?.toolCallId as string) ?? '';
            const finishedAt = new Date().toISOString();
            const started = toolStartByCallId.get(toolCallId);
            toolStartByCallId.delete(toolCallId);
            yield {
              conversationId,
              type: 'tool-result',
              toolCallId,
              toolName: (payload?.toolName as string) ?? started?.toolName ?? '',
              result: { isError: true, error: payload?.error },
              startedAt: started?.startedAt ?? finishedAt,
              finishedAt,
            };
          } else if (type === 'error') {
            const rawError = payload?.error ?? payload ?? 'Unknown stream error';
            const errorMessage = getErrorMessage(rawError);
            if (!compatibilityRetried && shouldRetryWithoutTemperature(rawError, activeModelSettings, emittedAnyOutput)) {
              compatibilityRetried = true;
              activeModelSettings = omitTemperature(activeModelSettings);
              activeModelConfig = withTemperatureOmissionHeader(activeModelConfig);
              compatibilityRetryRequested = true;
              console.warn(`[Agent] Retrying ${conversationId} without temperature after compatibility stream error:`, errorMessage);
              break;
            }

            emittedTerminalError = true;
            yield {
              conversationId,
              type: 'error',
              error: errorMessage,
            };
          } else if (type === 'finish') {
            const finishReason = extractStreamFinishReason(payload);
            if (finishReason) {
              terminalFinishReason = finishReason;
            }
            if (finishReason === 'error' && !emittedTerminalError && !options?.abortSignal?.aborted) {
              emittedTerminalError = true;
              yield {
                conversationId,
                type: 'error',
                error: 'The model ended the stream with an error.',
              };
            }
          } else if (type === 'step-finish') {
            const finishReason = extractStreamFinishReason(payload);
            if (finishReason === 'content-filter') {
              terminalFinishReason = finishReason;
              console.info(`[Agent] Ending stream early for ${conversationId} after content-filter step finish`);
              break;
            }
            // Accumulate token usage from each step
            const stepUsage = payload?.usage as { promptTokens?: number; completionTokens?: number } | undefined;
            if (stepUsage) {
              accInputTokens += stepUsage.promptTokens ?? 0;
              accOutputTokens += stepUsage.completionTokens ?? 0;
            }
            // Extract Anthropic cache token info from providerMetadata
            const stepMeta = payload?.providerMetadata as Record<string, unknown> | undefined;
            const anthropicMeta = stepMeta?.anthropic as Record<string, unknown> | undefined;
            if (anthropicMeta) {
              accCacheReadTokens += (anthropicMeta.cacheReadInputTokens as number | undefined) ?? 0;
              accCacheWriteTokens += (anthropicMeta.cacheCreationInputTokens as number | undefined) ?? 0;
            }
          } else if (type && isExpectedMastraStructuralEvent(type)) {
            continue;
          } else if (type) {
            console.info(`[Agent] Unknown stream event type: ${type}`, payload);
          }
        }

        if (compatibilityRetryRequested) {
          continue compatibilityLoop;
        }

        console.info(`[Agent] Stream completed for ${conversationId}`);
        requestCompleted = true;
        break;
      } catch (error) {
        if (options?.abortSignal?.aborted) break compatibilityLoop;

        const shouldRetry = attempt === 0 && !emittedAnyOutput && isRetryableBedrock503(error, modelConfig);
        if (shouldRetry) {
          console.warn(`[Agent] Retrying transient Bedrock stream failure for ${conversationId}:`, error);
          await sleep(700);
          continue;
        }

        if (!compatibilityRetried && shouldRetryWithoutTemperature(error, activeModelSettings, emittedAnyOutput)) {
          compatibilityRetried = true;
          activeModelSettings = omitTemperature(activeModelSettings);
          activeModelConfig = withTemperatureOmissionHeader(activeModelConfig);
          console.warn(`[Agent] Retrying ${conversationId} without temperature after compatibility error:`, getErrorMessage(error));
          continue compatibilityLoop;
        }

        console.error(`[Agent] Stream error for ${conversationId}:`, error);
        emittedTerminalError = true;
        yield {
          conversationId,
          type: 'error',
          error: getErrorMessage(error),
        };
        break compatibilityLoop;
      }
    }

    if (requestCompleted || options?.abortSignal?.aborted) {
      break;
    }

    break;
  }

  if (options?.abortSignal?.aborted) {
    const finishedAt = new Date().toISOString();
    for (const [toolCallId, toolState] of toolStartByCallId.entries()) {
      yield {
        conversationId,
        type: 'tool-result',
        toolCallId,
        toolName: toolState.toolName,
        result: { isError: true, error: 'Tool execution cancelled.' },
        startedAt: toolState.startedAt,
        finishedAt,
      };
    }
  }

  // Emit accumulated token usage before done
  if (accInputTokens > 0 || accOutputTokens > 0) {
    yield {
      conversationId,
      type: 'context-usage',
      data: {
        inputTokens: accInputTokens,
        outputTokens: accOutputTokens,
        cacheReadTokens: accCacheReadTokens,
        cacheWriteTokens: accCacheWriteTokens,
        totalTokens: accInputTokens + accOutputTokens,
      },
    };
  }

  yield {
    conversationId,
    type: 'done',
    ...(terminalFinishReason ? { data: { finishReason: terminalFinishReason } } : {}),
  };
}

/**
 * Fallback-aware streaming wrapper.
 * Tries the primary model first, then each fallback in order.
 * Fallback triggers on pre-content errors, and also on terminal content filters.
 */
export async function* streamWithFallback(
  conversationId: string,
  messages: unknown[],
  streamConfig: ResolvedStreamConfig,
  config: AppConfig,
  tools: ToolDefinition[],
  dbPath: string,
  options?: {
    reasoningEffort?: ReasoningEffort;
    abortSignal?: AbortSignal;
    emitEvent?: (event: StreamEvent) => void;
    onToolExecutionStart?: (state: { toolCallId: string; toolName: string; args: unknown; cancel: () => void }) => void;
    onToolExecutionEnd?: (state: { toolCallId: string; toolName: string }) => void;
    augmentToolResult?: (state: { toolCallId: string; toolName: string; args: unknown; result: unknown }) => Promise<unknown> | unknown;
  },
): AsyncGenerator<StreamEvent> {
  const modelChain: ModelCatalogEntry[] = [
    streamConfig.primaryModel,
    ...(streamConfig.fallbackEnabled ? streamConfig.fallbackModels : []),
  ];

  for (let attempt = 0; attempt < modelChain.length; attempt++) {
    if (options?.abortSignal?.aborted) {
      yield { conversationId, type: 'done' };
      return;
    }

    const entry = modelChain[attempt];
    const configOverride: AppConfig = {
      ...config,
      systemPrompt: streamConfig.systemPrompt,
      advanced: {
        ...config.advanced,
        temperature: streamConfig.temperature,
        maxSteps: streamConfig.maxSteps,
        maxRetries: streamConfig.maxRetries,
      },
    };

    let emittedContent = false;
    let lastError: string | null = null;
    let terminalFinishReason: string | null = null;
    let fallbackReason: 'content-filter' | null = null;
    let discardPartialAssistant = false;

    try {
      console.info(`[Fallback] Attempt ${attempt + 1}/${modelChain.length}: model=${entry.modelConfig.modelName} key=${entry.key}`);

      const innerStream = streamAgentResponse(
        conversationId,
        messages,
        entry.modelConfig,
        configOverride,
        tools,
        dbPath,
        options,
      );

      for await (const event of innerStream) {
        // Track whether real content has been emitted
        if (event.type === 'text-delta' || event.type === 'tool-call') {
          emittedContent = true;
        }

        // If we see an error BEFORE any content and have more fallbacks, capture it
        if (event.type === 'error' && !emittedContent && attempt < modelChain.length - 1) {
          lastError = event.error ?? 'Unknown error';
          continue; // don't yield the error to the UI
        }

        if (event.type === 'done') {
          const doneData = event.data as { finishReason?: string } | undefined;
          terminalFinishReason = doneData?.finishReason ?? null;

          if (terminalFinishReason === 'content-filter' && attempt < modelChain.length - 1) {
            fallbackReason = 'content-filter';
            discardPartialAssistant = emittedContent;
            break;
          }
        }

        // Skip inner 'done' if we're about to fallback
        if (event.type === 'done' && lastError && !emittedContent && attempt < modelChain.length - 1) {
          break;
        }

        yield event;
      }

      if (fallbackReason === 'content-filter') {
        const nextEntry = modelChain[attempt + 1];
        yield {
          conversationId,
          type: 'model-fallback',
          data: {
            fromModel: entry.displayName,
            fromModelKey: entry.key,
            toModel: nextEntry.displayName,
            toModelKey: nextEntry.key,
            error: 'content filter',
            reason: fallbackReason,
            discardPartialAssistant,
            attempt: attempt + 1,
          },
        };
        continue;
      }

      // If content was emitted successfully or no error occurred, we're done
      if (emittedContent || !lastError) {
        return;
      }

      // Error before content — emit fallback event and try next model
      const nextEntry = modelChain[attempt + 1];
      yield {
        conversationId,
        type: 'model-fallback',
        data: {
          fromModel: entry.displayName,
          fromModelKey: entry.key,
          toModel: nextEntry.displayName,
          toModelKey: nextEntry.key,
          error: lastError,
          attempt: attempt + 1,
        },
      };
      continue;
    } catch (outerError) {
      if (options?.abortSignal?.aborted) {
        yield { conversationId, type: 'done' };
        return;
      }

      if (!emittedContent && attempt < modelChain.length - 1) {
        const nextEntry = modelChain[attempt + 1];
        yield {
          conversationId,
          type: 'model-fallback',
          data: {
            fromModel: entry.displayName,
            fromModelKey: entry.key,
            toModel: nextEntry.displayName,
            toModelKey: nextEntry.key,
            error: getErrorMessage(outerError),
            attempt: attempt + 1,
          },
        };
        continue;
      }

      // Last model also failed
      yield {
        conversationId,
        type: 'error',
        error: getErrorMessage(outerError),
      };
      yield { conversationId, type: 'done' };
      return;
    }
  }

  // Should not reach here, but safety net
  yield { conversationId, type: 'done' };
}

function buildAgentInstructions(basePrompt: string): string {
  return [
    basePrompt,
    '',
    'Runtime capabilities:',
    '- Long-running tool output can be streamed while a tool is running.',
    '- The runtime may emit mid-tool progress updates to the user.',
    '- A tool run may be cancelled if output indicates failure, risk, or mismatch with intent.',
    '- Do not claim that mid-tool progress updates are impossible in this environment.',
  ].join('\n');
}

async function* asAsyncIterable<T>(stream: ReadableStream<T>): AsyncGenerator<T> {
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}
