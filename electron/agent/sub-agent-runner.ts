/**
 * Sub-Agent Execution Engine
 *
 * Runs a child agent as an async generator, yielding stream events back to the caller.
 * The sub-agent has a control tool to signal completion, request input, etc.
 * Multi-turn: the runner loops until the sub-agent signals done or max turns.
 */

import { BrowserWindow } from 'electron';
import { z } from 'zod';
import { streamAgentResponse } from './mastra-agent.js';
import type { StreamEvent } from './mastra-agent.js';
import type { LLMModelConfig } from './model-catalog.js';
import type { AppConfig } from '../config/schema.js';
import type { ToolDefinition, ToolExecutionContext } from '../tools/types.js';
import {
  ToolObserverManager,
  resolveToolObserverConfig,
  summarizeLatestUserRequest,
  summarizeThreadContext,
} from './tool-observer.js';

export type SubAgentEvent =
  | (StreamEvent & { subAgentConversationId: string; parentConversationId: string; parentToolCallId: string })
  | {
    subAgentConversationId: string;
    parentConversationId: string;
    parentToolCallId: string;
    type: 'sub-agent-status';
    status: 'running' | 'awaiting-input' | 'completed' | 'stopped' | 'failed';
    summary?: string;
  }
  | {
    subAgentConversationId: string;
    parentConversationId: string;
    parentToolCallId: string;
    conversationId: string;
    type: 'sub-agent-user-message';
    text: string;
    source: 'task' | 'parent' | 'user';
  };

export type SubAgentRunOptions = {
  subAgentConversationId: string;
  parentConversationId: string;
  parentToolCallId: string;
  task: string;
  context?: string;
  depth: number;
  config: AppConfig;
  modelConfig: LLMModelConfig;
  tools: ToolDefinition[];
  dbPath: string;
  abortSignal?: AbortSignal;
  /** Called between agent turns to check for pending follow-up messages. */
  getFollowUp: () => Promise<string | null>;
};

/** Global counter for enforcing maxConcurrent limit */
let activeSubAgentCount = 0;

export function getActiveSubAgentCount(): number {
  return activeSubAgentCount;
}

function broadcastSubAgentEvent(event: SubAgentEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('agent:stream-event', event);
  }
}

/** Sub-agent control signal — set by the sub_agent_control tool */
type ControlSignal = {
  action: 'complete' | 'failed' | 'awaiting_response' | 'continue';
  message?: string;
};

/** Create the virtual control tool that the sub-agent uses to signal state */
function createControlTool(signalRef: { current: ControlSignal | null }): ToolDefinition {
  return {
    name: 'sub_agent_control',
    description: [
      'Signal your current state to the parent agent and user.',
      'You MUST call this tool when you have completed your task, encountered a failure,',
      'or need input from the user/parent before continuing.',
      '',
      'Actions:',
      '- "complete": Task is done. Include a summary of what you accomplished.',
      '- "failed": Task cannot be completed. Explain why.',
      '- "awaiting_response": You need input/clarification before continuing. Ask your question in the message.',
      '- "continue": You are not done yet and will keep working (use between multi-step operations).',
    ].join(' '),
    inputSchema: z.object({
      action: z.enum(['complete', 'failed', 'awaiting_response', 'continue']).describe('Your current state'),
      message: z.string().optional().describe('Summary, error explanation, or question for the user'),
    }),
    execute: async (input: unknown, _ctx: ToolExecutionContext): Promise<unknown> => {
      const { action, message } = input as { action: string; message?: string };
      signalRef.current = { action: action as ControlSignal['action'], message };
      return { acknowledged: true, action, message: message ?? '' };
    },
  };
}

function buildSubAgentSystemPrompt(baseSystemPrompt: string, task: string, context?: string, depth?: number): string {
  const parts = [
    baseSystemPrompt,
    '',
    '--- Sub-Agent Context ---',
    `You are a sub-agent (depth ${depth ?? 0}) spawned to handle a specific task.`,
    `Your assigned task: ${task}`,
  ];
  if (context) {
    parts.push('', 'Additional context from parent agent:', context);
  }
  parts.push(
    '',
    'Instructions:',
    '- Focus on the assigned task. Use tools as needed.',
    '- You MUST call sub_agent_control with action "complete" when done, or "failed" if you cannot finish.',
    '- If you need user input or clarification, call sub_agent_control with action "awaiting_response".',
    '- For multi-step work, call sub_agent_control with "continue" between major steps if needed.',
    '- The user or parent agent may send you follow-up messages between turns.',
    '- Do NOT just provide a text response without calling sub_agent_control — the system needs the signal.',
  );
  return parts.join('\n');
}

export async function* runSubAgent(opts: SubAgentRunOptions): AsyncGenerator<SubAgentEvent> {
  const {
    subAgentConversationId,
    parentConversationId,
    parentToolCallId,
    task,
    context,
    depth,
    config,
    modelConfig,
    tools,
    dbPath,
    abortSignal,
    getFollowUp,
  } = opts;

  const maxConcurrent = config.tools?.subAgents?.maxConcurrent ?? 4;
  if (activeSubAgentCount >= maxConcurrent) {
    yield {
      subAgentConversationId, parentConversationId, parentToolCallId,
      conversationId: subAgentConversationId,
      type: 'error',
      error: `Maximum concurrent sub-agents (${maxConcurrent}) reached.`,
    };
    yield { subAgentConversationId, parentConversationId, parentToolCallId, conversationId: subAgentConversationId, type: 'done' };
    return;
  }

  activeSubAgentCount++;

  try {
    const systemPrompt = buildSubAgentSystemPrompt(config.systemPrompt, task, context, depth);
    const messages: Array<{ role: string; content: unknown }> = [
      { role: 'user', content: task },
    ];

    const subAgentConfig: AppConfig = { ...config, systemPrompt };

    // Control signal shared with the control tool
    const controlSignal: { current: ControlSignal | null } = { current: null };
    const controlTool = createControlTool(controlSignal);

    // Inject the control tool into the sub-agent's toolset
    const allTools = [...tools.filter((t) => t.name !== 'sub_agent_control'), controlTool];

    let fullResponseText = '';
    let turnCount = 0;
    const maxTurns = Math.max(config.advanced.maxSteps, 20); // generous turn limit

    // Emit initial status
    const emitStatus = (_status: never, st: 'running' | 'awaiting-input' | 'completed' | 'stopped' | 'failed', summary?: string) => {
      const evt: SubAgentEvent = { subAgentConversationId, parentConversationId, parentToolCallId, type: 'sub-agent-status', status: st, summary };
      broadcastSubAgentEvent(evt);
      return evt;
    };

    yield emitStatus(undefined as never, 'running', `Starting task: ${task.slice(0, 100)}`);

    // Emit initial task as user message
    const taskMsgEvent: SubAgentEvent = {
      subAgentConversationId, parentConversationId, parentToolCallId,
      conversationId: subAgentConversationId,
      type: 'sub-agent-user-message', text: task, source: 'task',
    };
    yield taskMsgEvent;
    broadcastSubAgentEvent(taskMsgEvent);

    // Create observer for the sub-agent's tool executions
    const observerConfig = resolveToolObserverConfig(config);
    let subObserver: ToolObserverManager | null = null;
    const toolCancels = new Map<string, () => void>();

    // Helper: add a follow-up message and emit it as a UI event
    const addFollowUpMessage = (text: string, source: 'user' | 'parent' | 'task' = 'parent'): SubAgentEvent => {
      messages.push({ role: 'user', content: text });
      const evt: SubAgentEvent = {
        subAgentConversationId, parentConversationId, parentToolCallId,
        conversationId: subAgentConversationId,
        type: 'sub-agent-user-message', text, source,
      };
      broadcastSubAgentEvent(evt);
      return evt;
    };

    while (turnCount < maxTurns) {
      if (abortSignal?.aborted) break;
      turnCount++;
      controlSignal.current = null; // reset for this turn

      let turnText = '';

      // Create/re-create observer each turn with updated context
      subObserver?.dispose();
      if (observerConfig.enabled) {
        subObserver = new ToolObserverManager({
          conversationId: subAgentConversationId,
          modelConfig,
          config: observerConfig,
          userRequestSummary: summarizeLatestUserRequest(messages),
          baseThreadContext: summarizeThreadContext(messages),
          emitMidToolMessage: (text) => {
            if (!abortSignal?.aborted) {
              broadcastSubAgentEvent({
                subAgentConversationId, parentConversationId, parentToolCallId,
                conversationId: subAgentConversationId,
                type: 'observer-message', text,
              });
            }
          },
          cancelToolCall: (toolCallId) => {
            const cancel = toolCancels.get(toolCallId);
            if (!cancel) return false;
            cancel();
            return true;
          },
        });
      }

      const stream = streamAgentResponse(
        subAgentConversationId,
        messages,
        modelConfig,
        subAgentConfig,
        allTools,
        dbPath,
        {
          abortSignal,
          emitEvent: (event) => {
            if (event.type === 'tool-progress') {
              subObserver?.onToolProgress({
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
            broadcastSubAgentEvent({
              ...event, subAgentConversationId, parentConversationId, parentToolCallId,
            } as SubAgentEvent);
          },
          onToolExecutionStart: (state) => {
            toolCancels.set(state.toolCallId, state.cancel);
            subObserver?.onToolExecutionStart(state);
          },
          onToolExecutionEnd: ({ toolCallId }) => {
            toolCancels.delete(toolCallId);
            subObserver?.onToolExecutionEnd(toolCallId);
          },
          augmentToolResult: async ({ toolCallId, toolName, result }) => {
            await subObserver?.waitForLinkedLaunchedTools(toolCallId);
            subObserver?.onToolExecutionResult(toolCallId, toolName, result);
            const augmentation = subObserver?.getToolAugmentation(toolCallId);
            if (!augmentation) return result;
            if (!result || typeof result !== 'object' || Array.isArray(result)) {
              return { value: result, ...augmentation };
            }
            return { ...(result as Record<string, unknown>), ...augmentation };
          },
        },
      );

      for await (const event of stream) {
        if (event.type === 'text-delta' && event.text) {
          turnText += event.text;
        }
        const enriched = { ...event, subAgentConversationId, parentConversationId, parentToolCallId } as SubAgentEvent;
        if (event.type !== 'done') {
          broadcastSubAgentEvent(enriched);
        }
        yield enriched;
        if (event.type === 'done') break;
      }

      if (turnText) {
        fullResponseText += (fullResponseText ? '\n\n' : '') + turnText;
        messages.push({ role: 'assistant', content: turnText });
      }

      if (abortSignal?.aborted) break;

      // Check what the sub-agent signaled via the control tool
      const signal = controlSignal.current as ControlSignal | null;

      if (signal?.action === 'complete' || signal?.action === 'failed') {
        // Before finalizing, check if a message arrived during this turn
        const pendingFollowUp = await getFollowUp();
        if (pendingFollowUp) {
          yield addFollowUpMessage(pendingFollowUp);
          yield emitStatus(undefined as never, 'running', 'Processing follow-up');
          continue;
        }
        const finalSt = signal.action === 'complete' ? 'completed' as const : 'failed' as const;
        yield emitStatus(undefined as never, finalSt, signal.message ?? fullResponseText.slice(0, 500));
        break;
      }
      if (signal?.action === 'awaiting_response') {
        yield emitStatus(undefined as never, 'awaiting-input', signal.message ?? 'Waiting for input');

        const followUp = await waitForFollowUp(getFollowUp, abortSignal, 300000);
        if (!followUp || abortSignal?.aborted) break;

        yield addFollowUpMessage(followUp);
        yield emitStatus(undefined as never, 'running', 'Processing follow-up');
        continue;
      }

      // signal === 'continue' or no signal — check for opportunistic follow-ups
      const followUp = await getFollowUp();
      if (followUp) {
        yield addFollowUpMessage(followUp);
        yield emitStatus(undefined as never, 'running', `Processing follow-up (turn ${turnCount + 1})`);
        continue;
      }

      // No control signal and no follow-up — brief window then auto-complete
      if (!signal) {
        const lateFollowUp = await waitForFollowUp(getFollowUp, abortSignal, 5000);
        if (lateFollowUp) {
          yield addFollowUpMessage(lateFollowUp);
          yield emitStatus(undefined as never, 'running', `Processing follow-up (turn ${turnCount + 1})`);
          continue;
        }
        yield emitStatus(undefined as never, 'completed', fullResponseText.slice(0, 500));
        break;
      }

      // signal === 'continue' — keep going
      yield emitStatus(undefined as never, 'running', `Continuing (turn ${turnCount + 1})`);
    }

    const finalStatus = abortSignal?.aborted ? 'stopped' : (controlSignal.current?.action === 'failed' ? 'failed' : 'completed');
    if (finalStatus !== 'completed' && finalStatus !== 'failed') {
      yield emitStatus(undefined as never, finalStatus as 'stopped', fullResponseText.slice(0, 500));
    }

    // Dispose observer before exiting (inside try to avoid bundler scope issue with finally)
    subObserver?.dispose();
    subObserver = null;

  } finally {
    // subObserver already disposed above; only decrement counter here
    activeSubAgentCount--;
  }
}

/** Wait for a follow-up message with timeout */
async function waitForFollowUp(
  getFollowUp: () => Promise<string | null>,
  abortSignal?: AbortSignal,
  timeoutMs = 15000,
): Promise<string | null> {
  // Check immediately
  const immediate = await getFollowUp();
  if (immediate) return immediate;

  // Poll with timeout
  return new Promise<string | null>((resolve) => {
    let resolved = false;
    const finish = (val: string | null) => { if (!resolved) { resolved = true; resolve(val); } };

    const interval = setInterval(async () => {
      if (abortSignal?.aborted) { clearInterval(interval); finish(null); return; }
      const msg = await getFollowUp();
      if (msg) { clearInterval(interval); finish(msg); }
    }, 300);

    setTimeout(() => { clearInterval(interval); finish(null); }, timeoutMs);

    if (abortSignal) {
      abortSignal.addEventListener('abort', () => { clearInterval(interval); finish(null); }, { once: true });
    }
  });
}
