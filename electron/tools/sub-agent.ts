/**
 * Sub-Agent Tool
 *
 * Allows the parent agent to spawn a child agent that has access to the same tools
 * (including recursive sub-agents up to the configured depth limit).
 * Sub-agent conversations can be resumed after completion.
 */

import { z } from 'zod';
import { join } from 'path';
import { BrowserWindow } from 'electron';
import { runSubAgent, getActiveSubAgentCount } from '../agent/sub-agent-runner.js';
import type { SubAgentEvent } from '../agent/sub-agent-runner.js';
import { streamAgentResponse } from '../agent/mastra-agent.js';
import type { LLMModelConfig } from '../agent/model-catalog.js';
import { resolveModelForThread } from '../agent/model-catalog.js';
import type { AppConfig } from '../config/schema.js';
import type { ToolDefinition, ToolExecutionContext } from './types.js';

/** Follow-up message queues keyed by subAgentConversationId */
const followUpQueues = new Map<string, string[]>();
/** Active sub-agent abort controllers keyed by subAgentConversationId */
const activeSubAgentControllers = new Map<string, AbortController>();
/** Map parent toolCallId → subAgentConversationId for observer lookups */
const toolCallToSubAgent = new Map<string, string>();
/** Persisted sub-agent conversation state for resumption */
const subAgentState = new Map<string, {
  messages: Array<{ role: string; content: unknown }>;
  config: AppConfig;
  modelConfig: LLMModelConfig;
  tools: ToolDefinition[];
  dbPath: string;
  parentConversationId: string;
  parentToolCallId: string;
  depth: number;
  task: string;
}>();

function broadcastEvent(event: SubAgentEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('agent:stream-event', event);
  }
}

/** Send a follow-up to a sub-agent by its parent toolCallId (for observer use) */
export function sendSubAgentFollowUpByToolCall(toolCallId: string, message: string): boolean {
  const saId = toolCallToSubAgent.get(toolCallId);
  if (!saId) return false;
  return sendSubAgentFollowUp(saId, message);
}

/** Send a follow-up message to a sub-agent (running or completed) */
export function sendSubAgentFollowUp(subAgentConversationId: string, message: string): boolean {
  // If running, push to queue
  const queue = followUpQueues.get(subAgentConversationId);
  if (queue) {
    queue.push(message);
    return true;
  }

  // If completed but state exists, resume the conversation
  const state = subAgentState.get(subAgentConversationId);
  if (state) {
    resumeSubAgent(subAgentConversationId, message, state);
    return true;
  }

  return false;
}

/** Resume a completed sub-agent with a new message */
async function resumeSubAgent(
  subAgentConversationId: string,
  message: string,
  state: NonNullable<ReturnType<typeof subAgentState.get>>,
): Promise<void> {
  const { messages, config, modelConfig, tools, dbPath, parentConversationId, parentToolCallId } = state;

  // Add the user message
  messages.push({ role: 'user', content: message });

  // Emit user message event
  broadcastEvent({
    subAgentConversationId, parentConversationId, parentToolCallId,
    conversationId: subAgentConversationId,
    type: 'sub-agent-user-message', text: message, source: 'user',
  });

  // Emit running status
  broadcastEvent({
    subAgentConversationId, parentConversationId, parentToolCallId,
    type: 'sub-agent-status', status: 'running', summary: 'Resuming conversation',
  });

  const localController = new AbortController();
  activeSubAgentControllers.set(subAgentConversationId, localController);
  followUpQueues.set(subAgentConversationId, []);

  try {
    const stream = streamAgentResponse(
      subAgentConversationId, messages, modelConfig,
      { ...config, systemPrompt: config.systemPrompt },
      tools, dbPath,
      {
        abortSignal: localController.signal,
        emitEvent: (event) => {
          broadcastEvent({ ...event, subAgentConversationId, parentConversationId, parentToolCallId } as SubAgentEvent);
        },
      },
    );

    let turnText = '';
    for await (const event of stream) {
      if (event.type === 'text-delta' && event.text) turnText += event.text;
      if (event.type !== 'done') {
        broadcastEvent({ ...event, subAgentConversationId, parentConversationId, parentToolCallId } as SubAgentEvent);
      }
      if (event.type === 'done') break;
    }

    if (turnText) {
      messages.push({ role: 'assistant', content: turnText });
    }

    // Check for immediate follow-up
    const queue = followUpQueues.get(subAgentConversationId);
    if (queue && queue.length > 0) {
      const nextMsg = queue.shift()!;
      followUpQueues.delete(subAgentConversationId);
      activeSubAgentControllers.delete(subAgentConversationId);
      await resumeSubAgent(subAgentConversationId, nextMsg, state);
      return;
    }

    broadcastEvent({
      subAgentConversationId, parentConversationId, parentToolCallId,
      type: 'sub-agent-status', status: 'completed', summary: 'Response complete',
    });

    // Emit done so the UI finalizes
    broadcastEvent({
      subAgentConversationId, parentConversationId, parentToolCallId,
      conversationId: subAgentConversationId, type: 'done',
    });

  } catch (error) {
    broadcastEvent({
      subAgentConversationId, parentConversationId, parentToolCallId,
      conversationId: subAgentConversationId,
      type: 'error', error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    followUpQueues.delete(subAgentConversationId);
    activeSubAgentControllers.delete(subAgentConversationId);
  }
}

/** Stop a running sub-agent */
export function stopSubAgent(subAgentConversationId: string): boolean {
  const controller = activeSubAgentControllers.get(subAgentConversationId);
  if (!controller) return false;
  controller.abort();
  return true;
}

/** Get all active sub-agent conversation IDs */
export function getActiveSubAgentIds(): string[] {
  return Array.from(activeSubAgentControllers.keys());
}

export function createSubAgentTool(
  getConfig: () => AppConfig,
  appHome: string,
  currentDepth: number,
  parentTools?: ToolDefinition[],
): ToolDefinition {
  return {
    name: 'sub_agent',
    description: [
      'Spawn a sub-agent to handle a task autonomously. The sub-agent has access to all the same tools',
      '(shell, file operations, search, etc.) and can work independently on the assigned task.',
      'Use this when you want to delegate a self-contained task that can run in parallel or needs focused attention.',
      'The sub-agent will return its complete response when finished.',
      '',
      'You can send follow-up instructions to guide the sub-agent after it completes a turn.',
      `Current nesting depth: ${currentDepth}.`,
    ].join(' '),
    inputSchema: z.object({
      task: z.string().describe('The task/instruction for the sub-agent. Be specific and clear about what you want accomplished.'),
      model: z.string().optional().describe('Model key to use for the sub-agent (omit to inherit the current model).'),
      context: z.string().optional().describe('Additional context from the current conversation that the sub-agent needs.'),
    }),
    execute: async (input: unknown, ctx: ToolExecutionContext): Promise<unknown> => {
      const { task, model, context } = input as { task: string; model?: string; context?: string };
      const config = getConfig();
      const subAgentConfig = config.tools?.subAgents ?? { enabled: true, maxDepth: 3, maxConcurrent: 4, maxPerParent: 2 };

      const maxDepth = subAgentConfig.maxDepth ?? 3;
      if (currentDepth >= maxDepth) {
        return { isError: true, error: `Sub-agent depth limit reached (max: ${maxDepth}).` };
      }
      if (getActiveSubAgentCount() >= (subAgentConfig.maxConcurrent ?? 4)) {
        return { isError: true, error: `Maximum concurrent sub-agents (${subAgentConfig.maxConcurrent ?? 4}) reached.` };
      }

      const modelKey = model ?? subAgentConfig.defaultModel ?? null;
      const modelEntry = resolveModelForThread(config, modelKey);
      if (!modelEntry) {
        return { isError: true, error: 'No model available for sub-agent.' };
      }

      const subAgentConversationId = `sub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const dbPath = join(appHome, 'data', 'memory.db');

      followUpQueues.set(subAgentConversationId, []);
      const localController = new AbortController();
      activeSubAgentControllers.set(subAgentConversationId, localController);
      toolCallToSubAgent.set(ctx.toolCallId, subAgentConversationId);

      if (ctx.abortSignal?.aborted) {
        cleanupRuntime(subAgentConversationId);
        return { isError: true, error: 'Parent operation was cancelled.' };
      }

      const parentAbortHandler = (): void => { localController.abort(); };
      ctx.abortSignal?.addEventListener('abort', parentAbortHandler, { once: true });

      const baseTools = parentTools ?? [];
      const subAgentTools = baseTools
        .filter((t) => t.name !== 'sub_agent')
        .concat(
          currentDepth + 1 < maxDepth
            ? [createSubAgentTool(getConfig, appHome, currentDepth + 1, baseTools)]
            : [],
        );

      try {
        let fullResponse = '';
        let toolsUsed: string[] = [];

        ctx.onProgress?.({
          stream: 'stdout',
          delta: `[Sub-agent started] Task: ${task.slice(0, 200)}\n`,
          output: `[Sub-agent started] Task: ${task.slice(0, 200)}\n`,
          bytesSeen: 0, truncated: false, stopped: false,
          subAgentConversationId,
        });

        const stream = runSubAgent({
          subAgentConversationId,
          parentConversationId: ctx.toolCallId,
          parentToolCallId: ctx.toolCallId,
          task, context,
          depth: currentDepth + 1,
          config,
          modelConfig: modelEntry.modelConfig,
          tools: subAgentTools,
          dbPath,
          abortSignal: localController.signal,
          getFollowUp: async () => {
            const queue = followUpQueues.get(subAgentConversationId);
            if (!queue || queue.length === 0) return null;
            return queue.shift() ?? null;
          },
        });

        for await (const event of stream) {
          if (event.type === 'text-delta' && 'text' in event && event.text) {
            fullResponse += event.text;
            ctx.onProgress?.({
              stream: 'stdout', delta: event.text,
              output: fullResponse.slice(-4000),
              bytesSeen: fullResponse.length,
              truncated: fullResponse.length > 4000,
              stopped: false, subAgentConversationId,
            });
          } else if (event.type === 'tool-call' && 'toolName' in event) {
            const toolName = event.toolName ?? 'unknown';
            if (!toolsUsed.includes(toolName) && toolName !== 'sub_agent_control') toolsUsed.push(toolName);
            ctx.onProgress?.({
              stream: 'stdout',
              delta: `[Sub-agent using tool: ${toolName}]\n`,
              output: `[Sub-agent using tool: ${toolName}]\n`,
              bytesSeen: fullResponse.length, truncated: false, stopped: false,
              subAgentConversationId,
            });
          } else if (event.type === 'sub-agent-status') {
            ctx.onProgress?.({
              stream: 'stdout',
              delta: `[Status: ${event.status}] ${event.summary ?? ''}\n`,
              output: `[Status: ${event.status}] ${event.summary ?? ''}\n`,
              bytesSeen: fullResponse.length, truncated: false, stopped: false,
              subAgentConversationId,
            });
          }
        }

        // Persist state for resumption after completion
        // Collect messages from the runner (they were built up in runSubAgent)
        const persistedMessages: Array<{ role: string; content: unknown }> = [
          { role: 'user', content: task },
        ];
        if (fullResponse) persistedMessages.push({ role: 'assistant', content: fullResponse });

        subAgentState.set(subAgentConversationId, {
          messages: persistedMessages,
          config, modelConfig: modelEntry.modelConfig,
          tools: subAgentTools, dbPath,
          parentConversationId: ctx.toolCallId,
          parentToolCallId: ctx.toolCallId,
          depth: currentDepth + 1, task,
        });

        return {
          subAgentConversationId,
          response: fullResponse,
          toolsUsed,
          depth: currentDepth + 1,
          status: localController.signal.aborted ? 'stopped' : 'completed',
        };
      } catch (error) {
        return {
          isError: true, subAgentConversationId,
          error: error instanceof Error ? error.message : String(error),
          depth: currentDepth + 1, status: 'error',
        };
      } finally {
        ctx.abortSignal?.removeEventListener('abort', parentAbortHandler);
        cleanupRuntime(subAgentConversationId);
        // NOTE: Do NOT delete subAgentState — it's needed for resumption
      }
    },
  };
}

/** Clean up runtime state (queue + controller) but preserve conversation state */
function cleanupRuntime(subAgentConversationId: string): void {
  followUpQueues.delete(subAgentConversationId);
  activeSubAgentControllers.delete(subAgentConversationId);
}
