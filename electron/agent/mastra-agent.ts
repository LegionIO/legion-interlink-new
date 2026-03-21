import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import type { LegionConfig } from '../config/schema.js';
import type { LLMModelConfig } from './model-catalog.js';
import { createLanguageModelFromConfig } from './language-model.js';
import { getSharedMemory, getResourceId } from './memory.js';
import type { ToolDefinition, ToolExecutionContext, ToolProgressEvent } from '../tools/types.js';

export type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh';

export type StreamEvent = {
  conversationId: string;
  type: 'text-delta' | 'observer-message' | 'tool-call' | 'tool-result' | 'tool-error' | 'tool-progress' | 'error' | 'done' | 'compaction' | 'context-usage';
  text?: string;
  toolCallId?: string;
  toolName?: string;
  args?: unknown;
  result?: unknown;
  error?: string;
  data?: unknown;
  startedAt?: string;
  finishedAt?: string;
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
      inputSchema: tool.inputSchema,
      execute: async (input, options) => {
        const toolCallId = typeof (options as any)?.toolCallId === 'string' ? (options as any).toolCallId : `tc-${Date.now()}`;
        const localAbortController = new AbortController();
        const cancel = (): void => {
          if (!localAbortController.signal.aborted) {
            localAbortController.abort();
          }
        };

        const mergedAbortSignal = mergeAbortSignals(options?.abortSignal, localAbortController.signal);
        hooks?.onToolExecutionStart?.({
          toolCallId,
          toolName: tool.name,
          args: input,
          cancel,
        });

        const ctx: ToolExecutionContext = {
          toolCallId,
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
  if (!reasoningEffort) return undefined;

  const supportsOpenAIReasoning =
    modelConfig.provider === 'openai-compatible';

  if (!supportsOpenAIReasoning) return undefined;

  return {
    openai: {
      reasoningEffort,
    },
  };
}

export async function* streamAgentResponse(
  conversationId: string,
  messages: unknown[],
  modelConfig: LLMModelConfig,
  config: LegionConfig,
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

  const model = await createLanguageModelFromConfig(modelConfig);
  const memory = getSharedMemory(config, dbPath);
  const mastraTools = toMastraTools(conversationId, tools, {
    emitEvent: options?.emitEvent,
    onToolExecutionStart: options?.onToolExecutionStart,
    onToolExecutionEnd: options?.onToolExecutionEnd,
    augmentToolResult: options?.augmentToolResult,
  });

  const agent = new Agent({
    id: `legion-${conversationId}`,
    name: 'legion',
    instructions: buildAgentInstructions(config.systemPrompt),
    model: model as any,
    tools: mastraTools,
    ...(memory ? { memory } : {}),
  });

  const modelSettings: Record<string, unknown> = {};
  if (typeof config.advanced.temperature === 'number') {
    modelSettings.temperature = config.advanced.temperature;
  }
  const providerOptions = buildProviderOptions(modelConfig, options?.reasoningEffort);

  const useGenerate = isReasoningGatewayModel(modelConfig);

  if (useGenerate) {
    yield* generateWithSyntheticEvents(agent, conversationId, messages, config, memory, modelSettings, providerOptions, options);
  } else {
    yield* streamWithRealEvents(agent, conversationId, messages, modelConfig, config, memory, modelSettings, providerOptions, options);
  }
}

/**
 * Non-streaming path for reasoning gateway models.
 * Uses agent.generate() with onStepFinish to synthesize streaming events.
 */
async function* generateWithSyntheticEvents(
  agent: Agent,
  conversationId: string,
  messages: unknown[],
  config: LegionConfig,
  memory: ReturnType<typeof getSharedMemory>,
  modelSettings: Record<string, unknown>,
  providerOptions: Record<string, unknown> | undefined,
  options?: {
    abortSignal?: AbortSignal;
    emitEvent?: (event: StreamEvent) => void;
  },
): AsyncGenerator<StreamEvent> {
  // Events are queued from the onStepFinish callback and drained after generate completes
  const eventQueue: StreamEvent[] = [];

  try {
    const msgArr = messages as Array<{ role?: string }>;
    console.info(`[Agent:generate] conv=${conversationId} messageCount=${msgArr.length} roles=[${msgArr.map((m) => m.role ?? '?').join(',')}] maxSteps=${config.advanced.maxSteps} temp=${config.advanced.temperature}`);

    const result = await agent.generate(messages as Parameters<typeof agent.generate>[0], {
      maxSteps: config.advanced.maxSteps,
      abortSignal: options?.abortSignal,
      ...(Object.keys(modelSettings).length > 0 ? { modelSettings } : {}),
      ...(providerOptions ? { providerOptions } : {}),
      ...(memory
        ? {
            threadId: conversationId,
            resourceId: getResourceId(),
          }
        : {}),
      onStepFinish: (step: unknown) => {
        const s = step as {
          text?: string;
          toolCalls?: Array<{ toolCallId: string; toolName: string; args: unknown }>;
          toolResults?: Array<{ toolCallId: string; toolName: string; result: unknown }>;
        };

        // Emit tool call/result events for each step
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
    } as any);

    // Drain queued step events first (tool calls/results from intermediate steps)
    for (const event of eventQueue) {
      yield event;
    }

    // Emit the final text as a single text-delta
    const fullResult = result as { text?: string };
    if (fullResult.text) {
      yield {
        conversationId,
        type: 'text-delta',
        text: fullResult.text,
      };
    }

    console.info(`[Agent] Generate completed for ${conversationId}`);
  } catch (error) {
    // Drain any events that were queued before the error
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
  }

  yield { conversationId, type: 'done' };
}

/**
 * Standard streaming path for models that support it.
 */
async function* streamWithRealEvents(
  agent: Agent,
  conversationId: string,
  messages: unknown[],
  modelConfig: LLMModelConfig,
  config: LegionConfig,
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

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      console.info(`[Agent] Starting stream for ${conversationId}${attempt > 0 ? ` (retry ${attempt})` : ''}`);

      const streamResult = await agent.stream(messages as Parameters<typeof agent.stream>[0], {
        maxSteps: config.advanced.maxSteps,
        abortSignal: options?.abortSignal,
        ...(Object.keys(modelSettings).length > 0 ? { modelSettings } : {}),
        ...(providerOptions ? { providerOptions } : {}),
        ...(memory
          ? {
              threadId: conversationId,
              resourceId: getResourceId(),
            }
          : {}),
      } as any);

      const fullStream = streamResult.fullStream;
      const iterator =
        Symbol.asyncIterator in (fullStream as object)
          ? (fullStream as AsyncIterable<unknown>)
          : asAsyncIterable(fullStream as ReadableStream<unknown>);

      for await (const chunk of iterator) {
        const c = chunk as { type?: string; payload?: Record<string, unknown> };
        const type = c?.type;
        const payload = (c?.payload ?? c) as Record<string, unknown> | undefined;

        if (type === 'text-delta') {
          emittedAnyOutput = true;
          yield {
            conversationId,
            type: 'text-delta',
            text: typeof payload?.text === 'string' ? payload.text : '',
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
          emittedTerminalError = true;
          yield {
            conversationId,
            type: 'error',
            error: String(payload?.error ?? 'Unknown stream error'),
          };
        } else if (type === 'finish') {
          const stepResult = payload?.stepResult as { reason?: string } | undefined;
          if (stepResult?.reason === 'error' && !emittedTerminalError && !options?.abortSignal?.aborted) {
            emittedTerminalError = true;
            yield {
              conversationId,
              type: 'error',
              error: 'The model ended the stream with an error.',
            };
          }
        } else if (type) {
          console.info(`[Agent] Unknown stream event type: ${type}`, payload);
        }
      }

      console.info(`[Agent] Stream completed for ${conversationId}`);
      break;
    } catch (error) {
      if (options?.abortSignal?.aborted) break;

      const shouldRetry = attempt === 0 && !emittedAnyOutput && isRetryableBedrock503(error, modelConfig);
      if (shouldRetry) {
        console.warn(`[Agent] Retrying transient Bedrock stream failure for ${conversationId}:`, error);
        await sleep(700);
        continue;
      }

      console.error(`[Agent] Stream error for ${conversationId}:`, error);
      emittedTerminalError = true;
      yield {
        conversationId,
        type: 'error',
        error: getErrorMessage(error),
      };
      break;
    }
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
