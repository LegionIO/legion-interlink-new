import { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import type { AppConfig } from '../config/schema.js';
import type { LLMModelConfig } from './model-catalog.js';
import { createLanguageModelFromConfig } from './language-model.js';

export type ToolObserverConfig = {
  enabled: boolean;
  intervalMs: number;
  maxSnapshotChars: number;
  maxMessagesPerTool: number;
  maxTotalLaunchedTools: number;
};

export type ToolProgressEnvelope = {
  toolCallId?: string;
  toolName?: string;
  data?: {
    stream?: 'stdout' | 'stderr';
    output?: string;
    delta?: string;
    bytesSeen?: number;
    truncated?: boolean;
    stopped?: boolean;
  };
};

type ToolStartState = {
  toolCallId: string;
  toolName: string;
  args: unknown;
  observerInitiated?: boolean;
};

export type ObserverEventRecord = {
  at: string;
  type: 'send_message' | 'cancel_tool' | 'launch_tool';
  targetToolCallId?: string;
  details: string;
  outcome: 'applied' | 'skipped' | 'failed';
};

export type LaunchToolCallResult = {
  ok: boolean;
  launchedToolCallId?: string;
  details?: string;
};

type ObservedToolState = {
  toolCallId: string;
  toolName: string;
  args: unknown;
  startedAt: string;
  finishedAt?: string;
  running: boolean;
  observerInitiated: boolean;
  stdout: string;
  stderr: string;
  bytesSeen: number;
  truncated: boolean;
  stopped: boolean;
  lastDelta: string;
  observerMessageCount: number;
};

type ToolAugmentationState = {
  events: ObserverEventRecord[];
  launchedToolResults: Array<{
    toolCallId: string;
    toolName: string;
    finishedAt: string;
    isError: boolean;
    summary: string;
  }>;
};

type ToolObserverManagerOptions = {
  conversationId: string;
  modelConfig: LLMModelConfig;
  config: ToolObserverConfig;
  userRequestSummary: string;
  baseThreadContext: string;
  emitMidToolMessage: (text: string) => void;
  cancelToolCall: (toolCallId: string) => boolean;
  launchToolCall?: (toolName: string, args: unknown) => Promise<LaunchToolCallResult>;
  messageSubAgent?: (toolCallId: string, message: string) => boolean;
};

const MAX_ACTIONS_PER_TICK = 6;
const MAX_DYNAMIC_CONTEXT_CHARS = 6000;

const OBSERVER_SYSTEM_PROMPT = [
  'You are a runtime tool observer for a local coding assistant.',
  'You observe all currently-running tool calls together and return ONLY structured actions.',
  'Available actions:',
  '- continue: no operation.',
  '- send_message: publish a short user-facing progress update.',
  '- cancel_tool: request cancellation for a specific running toolCallId.',
  '- launch_tool: start a new tool call with toolName+args when it materially helps.',
  '- message_sub_agent: send a follow-up message to a running sub_agent tool (use the sub-agent\'s toolCallId).',
  'Rules:',
  '- Prefer continue by default.',
  '- Cancel only on clear error/risk/mismatch.',
  '- Never fabricate toolCallIds; pick from the provided running tools.',
  '- Keep send_message text <= 220 chars.',
  '- Use message_sub_agent to guide running sub-agents, ask for updates, or redirect their work.',
].join(' ');

type AgentConfig = ConstructorParameters<typeof Agent>[0];

const ObserverActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('continue'),
    toolCallId: z.string().optional(),
  }),
  z.object({
    type: z.literal('send_message'),
    message: z.string().min(1).max(220),
    toolCallId: z.string().optional(),
  }),
  z.object({
    type: z.literal('cancel_tool'),
    toolCallId: z.string(),
    reason: z.string().max(240).optional(),
    message: z.string().max(220).optional(),
  }),
  z.object({
    type: z.literal('launch_tool'),
    toolName: z.string().min(1),
    args: z.record(z.any()).default({}),
    message: z.string().max(220).optional(),
    rationale: z.string().max(240).optional(),
    toolCallId: z.string().optional(),
  }),
  z.object({
    type: z.literal('message_sub_agent'),
    toolCallId: z.string(),
    message: z.string().min(1).max(500),
    rationale: z.string().max(240).optional(),
  }),
]);

const ObserverDecisionSchema = z.object({
  actions: z.array(ObserverActionSchema).max(MAX_ACTIONS_PER_TICK),
});

type ObserverDecision = z.infer<typeof ObserverDecisionSchema>;
type ObserverAction = z.infer<typeof ObserverActionSchema>;

export function resolveToolObserverConfig(config: AppConfig): ToolObserverConfig {
  const raw = config.tools.processStreaming.observer;
  return {
    enabled: raw.enabled,
    intervalMs: raw.intervalMs,
    maxSnapshotChars: raw.maxSnapshotChars,
    maxMessagesPerTool: raw.maxMessagesPerTool,
    maxTotalLaunchedTools: raw.maxTotalLaunchedTools,
  };
}

function extractText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  const chunks: string[] = [];
  for (const part of value) {
    if (!part || typeof part !== 'object') continue;
    const p = part as { type?: string; text?: string };
    if (p.type === 'text' && typeof p.text === 'string') chunks.push(p.text);
  }
  return chunks.join('\n');
}

export function summarizeLatestUserRequest(messages: unknown[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg || typeof msg !== 'object') continue;
    const m = msg as { role?: string; content?: unknown };
    if (m.role !== 'user') continue;
    const text = extractText(m.content).trim();
    if (text) return text.slice(0, 1200);
  }
  return '';
}

function summarizeMessageContent(value: unknown, maxChars: number): string {
  if (typeof value === 'string') return value.slice(0, maxChars);
  if (!Array.isArray(value)) return '';

  const chunks: string[] = [];
  for (const part of value) {
    if (!part || typeof part !== 'object') continue;
    const p = part as {
      type?: string;
      text?: string;
      toolName?: string;
      toolCallId?: string;
      isError?: boolean;
      result?: unknown;
    };

    if (p.type === 'text' && typeof p.text === 'string') {
      chunks.push(p.text);
      continue;
    }
    if (p.type === 'tool-call') {
      const name = p.toolName ?? 'tool';
      const id = p.toolCallId ? ` (${p.toolCallId})` : '';
      chunks.push(`[tool-call] ${name}${id}`);
      continue;
    }
    if (p.type === 'tool-result') {
      const name = p.toolName ?? 'tool';
      const id = p.toolCallId ? ` (${p.toolCallId})` : '';
      const suffix = p.isError ? ' error' : p.result !== undefined ? ' completed' : '';
      chunks.push(`[tool-result] ${name}${id}${suffix}`);
      continue;
    }
  }

  return chunks.join('\n').slice(0, maxChars);
}

export function summarizeThreadContext(
  messages: unknown[],
  options?: { maxMessages?: number; maxCharsPerMessage?: number; maxTotalChars?: number },
): string {
  const maxMessages = Math.max(1, options?.maxMessages ?? 10);
  const maxCharsPerMessage = Math.max(80, options?.maxCharsPerMessage ?? 380);
  const maxTotalChars = Math.max(500, options?.maxTotalChars ?? 3200);

  const normalized: Array<{ role: string; summary: string }> = [];
  for (const raw of messages) {
    if (!raw || typeof raw !== 'object') continue;
    const msg = raw as { role?: string; content?: unknown };
    const role = typeof msg.role === 'string' ? msg.role : 'unknown';
    const summary = summarizeMessageContent(msg.content, maxCharsPerMessage).trim();
    if (!summary) continue;
    normalized.push({ role, summary });
  }

  const recent = normalized.slice(-maxMessages);
  const lines = recent.map((entry) => `${entry.role.toUpperCase()}: ${entry.summary}`);
  const joined = lines.join('\n\n');
  return joined.length > maxTotalChars ? joined.slice(-maxTotalChars) : joined;
}

function clampHeadTail(value: string, maxChars: number): string {
  if (maxChars <= 0) return '';
  if (value.length <= maxChars) return value;
  const marker = '\n[...snip...]\n';
  if (marker.length >= maxChars) return marker.slice(0, maxChars);
  const body = maxChars - marker.length;
  const head = Math.floor(body * 0.7);
  const tail = Math.max(0, body - head);
  return value.slice(0, head) + marker + value.slice(-tail);
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function toResultSummary(result: unknown): { isError: boolean; summary: string } {
  if (result && typeof result === 'object') {
    const r = result as Record<string, unknown>;
    const isError = Boolean(r.isError || (typeof r.error === 'string' && r.error.length > 0));
    if (typeof r.error === 'string' && r.error.trim()) {
      return { isError: true, summary: oneLine(r.error).slice(0, 240) };
    }
    if (typeof r.stdout === 'string' && r.stdout.trim()) {
      return { isError, summary: clampHeadTail(oneLine(r.stdout), 240) };
    }
    if (typeof r.response === 'string' && r.response.trim()) {
      return { isError, summary: oneLine(r.response).slice(0, 240) };
    }
  }
  if (typeof result === 'string') {
    return { isError: false, summary: oneLine(result).slice(0, 240) };
  }
  return { isError: false, summary: '[result captured]' };
}

export class ToolObserverManager {
  private readonly conversationId: string;
  private readonly modelConfig: LLMModelConfig;
  private readonly config: ToolObserverConfig;
  private readonly userRequestSummary: string;
  private readonly baseThreadContext: string;
  private readonly emitMidToolMessage: (text: string) => void;
  private readonly cancelToolCall: (toolCallId: string) => boolean;
  private readonly launchToolCall: (toolName: string, args: unknown) => Promise<LaunchToolCallResult>;
  private readonly messageSubAgent: ((toolCallId: string, message: string) => boolean) | undefined;
  private readonly tools = new Map<string, ObservedToolState>();
  private readonly observerJournal: string[] = [];
  private readonly perToolAugmentation = new Map<string, ToolAugmentationState>();
  private readonly launchedToolParents = new Map<string, string[]>();
  private readonly pendingLaunchedByParent = new Map<string, Set<string>>();
  private readonly parentWaiters = new Map<string, Array<() => void>>();
  private disposed = false;
  private observerAgent: Agent | null = null;
  private observerAgentPromise: Promise<Agent> | null = null;
  private evaluationTimer: ReturnType<typeof setTimeout> | null = null;
  private evaluationInFlight = false;
  private evaluationPending = false;
  private lastEvaluatedAtMs = 0;
  private totalLaunchedTools = 0;

  constructor(options: ToolObserverManagerOptions) {
    this.conversationId = options.conversationId;
    this.modelConfig = options.modelConfig;
    this.config = options.config;
    this.userRequestSummary = options.userRequestSummary;
    this.baseThreadContext = options.baseThreadContext;
    this.emitMidToolMessage = options.emitMidToolMessage;
    this.cancelToolCall = options.cancelToolCall;
    this.launchToolCall = options.launchToolCall ?? (async () => ({
      ok: false,
      details: 'Observer-initiated tool launch is not enabled in this runtime path.',
    }));
    this.messageSubAgent = options.messageSubAgent;
  }

  onToolExecutionStart(start: ToolStartState): void {
    if (!this.config.enabled || this.disposed) return;
    const existing = this.tools.get(start.toolCallId);
    const state: ObservedToolState = existing ?? {
      toolCallId: start.toolCallId,
      toolName: start.toolName,
      args: start.args,
      startedAt: new Date().toISOString(),
      running: true,
      observerInitiated: Boolean(start.observerInitiated),
      stdout: '',
      stderr: '',
      bytesSeen: 0,
      truncated: false,
      stopped: false,
      lastDelta: '',
      observerMessageCount: 0,
    };

    state.toolName = start.toolName || state.toolName;
    state.args = start.args;
    state.running = true;
    state.finishedAt = undefined;
    state.observerInitiated = Boolean(start.observerInitiated) || state.observerInitiated;
    this.tools.set(start.toolCallId, state);
    this.ensureToolAugmentation(start.toolCallId);

    if (state.observerInitiated) {
      this.appendJournal(`[observer-launch] ${state.toolName} (${state.toolCallId}) started`);
    }
    this.scheduleEvaluation();
  }

  onToolProgress(event: ToolProgressEnvelope): void {
    if (!this.config.enabled || this.disposed || !event.toolCallId) return;
    const state = this.tools.get(event.toolCallId);
    if (!state) return;

    if (event.toolName) state.toolName = event.toolName;
    if (event.data?.stream === 'stdout' && typeof event.data.output === 'string') {
      state.stdout = event.data.output;
    }
    if (event.data?.stream === 'stderr' && typeof event.data.output === 'string') {
      state.stderr = event.data.output;
    }
    if (typeof event.data?.bytesSeen === 'number') {
      state.bytesSeen = event.data.bytesSeen;
    }
    if (typeof event.data?.delta === 'string') {
      state.lastDelta = event.data.delta;
    }
    state.truncated = Boolean(state.truncated || event.data?.truncated);
    state.stopped = Boolean(state.stopped || event.data?.stopped);
    this.scheduleEvaluation();
  }

  onToolExecutionResult(toolCallId: string, toolName: string, result: unknown): void {
    const { isError, summary } = toResultSummary(result);
    const finishedAt = new Date().toISOString();
    const parents = this.launchedToolParents.get(toolCallId) ?? [];
    for (const parentId of parents) {
      const aug = this.ensureToolAugmentation(parentId);
      aug.launchedToolResults.push({
        toolCallId,
        toolName,
        finishedAt,
        isError,
        summary,
      });
      this.markLinkedLaunchedToolComplete(parentId, toolCallId);
    }

    const selfAug = this.ensureToolAugmentation(toolCallId);
    if (parents.length > 0) {
      selfAug.events.push({
        at: finishedAt,
        type: 'launch_tool',
        targetToolCallId: toolCallId,
        details: `Observer-launched tool completed: ${summary}`,
        outcome: isError ? 'failed' : 'applied',
      });
    }
    this.launchedToolParents.delete(toolCallId);

    this.appendJournal(`[tool-result] ${toolName} (${toolCallId}) ${isError ? 'error' : 'completed'}: ${summary}`);
  }

  async waitForLinkedLaunchedTools(parentToolCallId: string, timeoutMs = 15000): Promise<void> {
    const pending = this.pendingLaunchedByParent.get(parentToolCallId);
    if (!pending || pending.size === 0) return;

    await new Promise<void>((resolve) => {
      let resolved = false;
      const done = (): void => {
        if (resolved) return;
        resolved = true;
        resolve();
      };

      const timer = setTimeout(() => {
        done();
      }, Math.max(1, timeoutMs));

      const wrappedDone = (): void => {
        clearTimeout(timer);
        done();
      };

      const queue = this.parentWaiters.get(parentToolCallId) ?? [];
      queue.push(wrappedDone);
      this.parentWaiters.set(parentToolCallId, queue);

      // Re-check after enqueue in case pending drained between checks.
      const current = this.pendingLaunchedByParent.get(parentToolCallId);
      if (!current || current.size === 0) {
        wrappedDone();
      }
    });
  }

  onToolExecutionEnd(toolCallId: string): void {
    const state = this.tools.get(toolCallId);
    if (!state) return;
    state.running = false;
    state.finishedAt = new Date().toISOString();
  }

  getToolAugmentation(toolCallId: string): Record<string, unknown> | undefined {
    const state = this.perToolAugmentation.get(toolCallId);
    if (!state) return undefined;
    if (state.events.length === 0 && state.launchedToolResults.length === 0) {
      return undefined;
    }

    return {
      observer: {
        events: state.events,
        launchedToolResults: state.launchedToolResults,
      },
    };
  }

  dispose(): void {
    this.disposed = true;
    if (this.evaluationTimer) {
      clearTimeout(this.evaluationTimer);
      this.evaluationTimer = null;
    }
    this.tools.clear();
    this.perToolAugmentation.clear();
    this.launchedToolParents.clear();
    this.pendingLaunchedByParent.clear();
    this.parentWaiters.clear();
  }

  private ensureToolAugmentation(toolCallId: string): ToolAugmentationState {
    const existing = this.perToolAugmentation.get(toolCallId);
    if (existing) return existing;
    const created: ToolAugmentationState = {
      events: [],
      launchedToolResults: [],
    };
    this.perToolAugmentation.set(toolCallId, created);
    return created;
  }

  private getRunningTools(): ObservedToolState[] {
    return Array.from(this.tools.values()).filter((t) => t.running);
  }

  private addLinkedLaunchedTool(parentToolCallId: string, launchedToolCallId: string): void {
    const pending = this.pendingLaunchedByParent.get(parentToolCallId) ?? new Set<string>();
    pending.add(launchedToolCallId);
    this.pendingLaunchedByParent.set(parentToolCallId, pending);
  }

  private markLinkedLaunchedToolComplete(parentToolCallId: string, launchedToolCallId: string): void {
    const pending = this.pendingLaunchedByParent.get(parentToolCallId);
    if (!pending) return;
    pending.delete(launchedToolCallId);
    if (pending.size > 0) return;

    this.pendingLaunchedByParent.delete(parentToolCallId);
    const waiters = this.parentWaiters.get(parentToolCallId);
    if (!waiters || waiters.length === 0) return;
    this.parentWaiters.delete(parentToolCallId);
    for (const waiter of waiters) waiter();
  }

  private scheduleEvaluation(): void {
    if (this.disposed || !this.config.enabled) return;
    if (this.getRunningTools().length === 0) return;

    if (this.evaluationInFlight) {
      this.evaluationPending = true;
      return;
    }

    const elapsed = Date.now() - this.lastEvaluatedAtMs;
    const delay = Math.max(0, this.config.intervalMs - elapsed);
    if (delay === 0) {
      void this.evaluateAllTools();
      return;
    }

    if (!this.evaluationTimer) {
      this.evaluationTimer = setTimeout(() => {
        this.evaluationTimer = null;
        void this.evaluateAllTools();
      }, delay);
    }
  }

  private appendJournal(line: string): void {
    const stamped = `${new Date().toISOString()} ${line}`;
    this.observerJournal.push(stamped);
    if (this.observerJournal.length > 120) {
      this.observerJournal.splice(0, this.observerJournal.length - 120);
    }
  }

  private async getObserverAgent(): Promise<Agent> {
    if (this.observerAgent) return this.observerAgent;
    if (!this.observerAgentPromise) {
      this.observerAgentPromise = (async () => {
        const model = await createLanguageModelFromConfig(this.modelConfig);
        const agent = new Agent({
          id: `tool-observer-${this.conversationId}`,
          name: 'tool-observer',
          instructions: OBSERVER_SYSTEM_PROMPT,
          model: model as AgentConfig['model'],
        });
        this.observerAgent = agent;
        return agent;
      })();
    }
    return this.observerAgentPromise;
  }

  private buildDynamicThreadContext(runningTools: ObservedToolState[]): string {
    const runningLines = runningTools.map((tool) => {
      const out = tool.stdout || tool.stderr || '';
      const excerpt = out ? clampHeadTail(oneLine(out), 280) : '[no output yet]';
      return `${tool.toolName} (${tool.toolCallId}) running, bytes=${tool.bytesSeen}, truncated=${tool.truncated}, stopped=${tool.stopped}\n${excerpt}`;
    });

    const observerLines = this.observerJournal.slice(-32);
    const joined = [
      this.baseThreadContext ? `BASE THREAD CONTEXT\n${this.baseThreadContext}` : '',
      observerLines.length > 0 ? `OBSERVER JOURNAL\n${observerLines.join('\n')}` : '',
      runningLines.length > 0 ? `RUNNING TOOLS SNAPSHOT\n${runningLines.join('\n\n')}` : '',
    ].filter(Boolean).join('\n\n');

    return joined.length > MAX_DYNAMIC_CONTEXT_CHARS
      ? joined.slice(joined.length - MAX_DYNAMIC_CONTEXT_CHARS)
      : joined;
  }

  private buildPromptPayload(runningTools: ObservedToolState[]): string {
    const toolsPayload = runningTools.map((tool) => ({
      toolCallId: tool.toolCallId,
      toolName: tool.toolName,
      args: tool.args,
      startedAt: tool.startedAt,
      bytesSeen: tool.bytesSeen,
      truncated: tool.truncated,
      stopped: tool.stopped,
      observerInitiated: tool.observerInitiated,
      output: {
        lastDelta: clampHeadTail(tool.lastDelta, 600),
        stdout: clampHeadTail(tool.stdout, this.config.maxSnapshotChars),
        stderr: clampHeadTail(tool.stderr, this.config.maxSnapshotChars),
      },
    }));

    return JSON.stringify({
      userRequest: this.userRequestSummary,
      threadContext: this.buildDynamicThreadContext(runningTools),
      runningTools: toolsPayload,
      limits: {
        maxActionsPerTick: MAX_ACTIONS_PER_TICK,
        maxTotalLaunchedTools: this.config.maxTotalLaunchedTools,
        launchedSoFar: this.totalLaunchedTools,
      },
    }, null, 2);
  }

  private recordEvent(
    targetToolCallIds: string[],
    event: ObserverEventRecord,
    messageForJournal?: string,
  ): void {
    for (const toolCallId of targetToolCallIds) {
      const aug = this.ensureToolAugmentation(toolCallId);
      aug.events.push(event);
    }
    if (messageForJournal) {
      this.appendJournal(messageForJournal);
    }
  }

  private resolveTargets(action: ObserverAction, runningTools: ObservedToolState[]): ObservedToolState[] {
    const toolCallId = 'toolCallId' in action ? action.toolCallId : undefined;
    if (toolCallId) {
      const exact = runningTools.find((t) => t.toolCallId === toolCallId);
      return exact ? [exact] : [];
    }
    return runningTools;
  }

  private async applyAction(action: ObserverAction, runningTools: ObservedToolState[]): Promise<void> {
    const targets = this.resolveTargets(action, runningTools);
    const targetIds = targets.map((t) => t.toolCallId);

    if (action.type === 'continue') {
      return;
    }

    if (action.type === 'send_message') {
      const message = oneLine(action.message).slice(0, 220);
      if (!message) return;

      const eligible = targets.filter((t) => t.observerMessageCount < this.config.maxMessagesPerTool);
      if (eligible.length === 0) {
        this.recordEvent(
          targetIds.length > 0 ? targetIds : this.getRunningTools().map((t) => t.toolCallId),
          {
            at: new Date().toISOString(),
            type: 'send_message',
            targetToolCallId: action.toolCallId,
            details: 'Skipped observer message: message budget reached.',
            outcome: 'skipped',
          },
          '[observer-action] send_message skipped (budget reached)',
        );
        return;
      }

      this.emitMidToolMessage(message);
      for (const target of eligible) {
        target.observerMessageCount++;
      }
      this.recordEvent(
        eligible.map((t) => t.toolCallId),
        {
          at: new Date().toISOString(),
          type: 'send_message',
          targetToolCallId: action.toolCallId,
          details: `Sent observer message: ${message}`,
          outcome: 'applied',
        },
        `[observer-message] ${message}`,
      );
      return;
    }

    if (action.type === 'cancel_tool') {
      const target = runningTools.find((t) => t.toolCallId === action.toolCallId);
      if (!target) {
        this.recordEvent(
          this.getRunningTools().map((t) => t.toolCallId),
          {
            at: new Date().toISOString(),
            type: 'cancel_tool',
            targetToolCallId: action.toolCallId,
            details: `Cancel skipped: tool ${action.toolCallId} is not running.`,
            outcome: 'skipped',
          },
          `[observer-action] cancel_tool skipped for ${action.toolCallId}`,
        );
        return;
      }

      const cancelled = this.cancelToolCall(action.toolCallId);
      if (!cancelled) {
        const msg = `Cancellation request failed for ${target.toolName} (${action.toolCallId}).`;
        this.emitMidToolMessage(msg);
        this.recordEvent(
          [target.toolCallId],
          {
            at: new Date().toISOString(),
            type: 'cancel_tool',
            targetToolCallId: action.toolCallId,
            details: msg,
            outcome: 'failed',
          },
          `[observer-action] cancel_tool failed for ${action.toolCallId}`,
        );
        return;
      }

      const reason = action.reason ? ` Reason: ${oneLine(action.reason).slice(0, 240)}` : '';
      const message = action.message
        ? oneLine(action.message).slice(0, 220)
        : `Cancellation requested for ${target.toolName} (${action.toolCallId}).`;
      this.emitMidToolMessage(message);
      this.recordEvent(
        [target.toolCallId],
        {
          at: new Date().toISOString(),
          type: 'cancel_tool',
          targetToolCallId: action.toolCallId,
          details: `Cancellation requested.${reason}`,
          outcome: 'applied',
        },
        `[observer-action] cancel_tool applied for ${action.toolCallId}${reason}`,
      );
      return;
    }

    if (action.type === 'message_sub_agent') {
      await this.applyMessageSubAgent(action);
      return;
    }

    if (this.totalLaunchedTools >= this.config.maxTotalLaunchedTools) {
      this.recordEvent(
        targetIds.length > 0 ? targetIds : this.getRunningTools().map((t) => t.toolCallId),
        {
          at: new Date().toISOString(),
          type: 'launch_tool',
          targetToolCallId: action.toolCallId,
          details: `Launch skipped: max launched tools (${this.config.maxTotalLaunchedTools}) reached.`,
          outcome: 'skipped',
        },
        '[observer-action] launch_tool skipped (global launch cap reached)',
      );
      return;
    }

    const toolName = oneLine(action.toolName);
    const args = action.args ?? {};
    const launch = await this.launchToolCall(toolName, args);
    if (!launch.ok) {
      const details = launch.details ? oneLine(launch.details) : `Failed launching ${toolName}.`;
      this.emitMidToolMessage(`Failed launching ${toolName}: ${details}`);
      this.recordEvent(
        targetIds.length > 0 ? targetIds : this.getRunningTools().map((t) => t.toolCallId),
        {
          at: new Date().toISOString(),
          type: 'launch_tool',
          targetToolCallId: action.toolCallId,
          details,
          outcome: 'failed',
        },
        `[observer-action] launch_tool failed for ${toolName}: ${details}`,
      );
      return;
    }

    this.totalLaunchedTools++;
    const launchedToolCallId = launch.launchedToolCallId ?? `tc-obs-${Date.now()}`;
    const launchedDetails = `Launched ${toolName} as ${launchedToolCallId}.`;
    const parents = targetIds.length > 0 ? targetIds : this.getRunningTools().map((t) => t.toolCallId);
    this.launchedToolParents.set(launchedToolCallId, parents);
    for (const parent of parents) {
      this.addLinkedLaunchedTool(parent, launchedToolCallId);
    }

    this.recordEvent(
      parents,
      {
        at: new Date().toISOString(),
        type: 'launch_tool',
        targetToolCallId: action.toolCallId,
        details: launchedDetails,
        outcome: 'applied',
      },
      `[observer-action] launch_tool applied: ${launchedDetails}`,
    );

    if (action.message) {
      const message = oneLine(action.message).slice(0, 220);
      if (message) {
        this.emitMidToolMessage(message);
        this.appendJournal(`[observer-message] ${message}`);
      }
    }
  }

  private async applyMessageSubAgent(action: { type: 'message_sub_agent'; toolCallId: string; message: string; rationale?: string }): Promise<void> {
    const tool = this.tools.get(action.toolCallId);
    if (!tool || tool.toolName !== 'sub_agent') {
      this.appendJournal(`[observer-action] message_sub_agent skipped: ${action.toolCallId} is not a running sub_agent`);
      return;
    }

    if (!this.messageSubAgent) {
      this.appendJournal(`[observer-action] message_sub_agent not available in this runtime`);
      return;
    }

    const ok = this.messageSubAgent(action.toolCallId, action.message);
    const outcome = ok ? 'applied' : 'failed';
    this.recordEvent(
      [action.toolCallId],
      {
        at: new Date().toISOString(),
        type: 'send_message', // reuse existing event type for recording
        targetToolCallId: action.toolCallId,
        details: `message_sub_agent ${outcome}: ${oneLine(action.message).slice(0, 120)}`,
        outcome,
      },
      `[observer-action] message_sub_agent ${outcome} for ${action.toolCallId}`,
    );
  }

  private async evaluateAllTools(): Promise<void> {
    if (this.disposed || this.evaluationInFlight) return;
    const runningTools = this.getRunningTools();
    if (runningTools.length === 0) return;

    this.evaluationInFlight = true;
    this.evaluationPending = false;
    try {
      const observer = await this.getObserverAgent();
      const prompt = this.buildPromptPayload(runningTools);

      const result = await observer.generate(prompt, {
        maxSteps: 1,
        structuredOutput: {
          schema: ObserverDecisionSchema,
          jsonPromptInjection: true,
        },
      });

      const decision = (result.object as ObserverDecision | undefined) ?? { actions: [] };
      const actions = Array.isArray(decision.actions) ? decision.actions.slice(0, MAX_ACTIONS_PER_TICK) : [];
      for (const action of actions) {
        await this.applyAction(action, this.getRunningTools());
      }
    } catch (error) {
      console.warn('[ToolObserver] Evaluation failed:', error);
    } finally {
      this.lastEvaluatedAtMs = Date.now();
      this.evaluationInFlight = false;
      if (this.evaluationPending && !this.disposed) {
        this.evaluationPending = false;
        this.scheduleEvaluation();
      } else if (!this.disposed && this.getRunningTools().length > 0) {
        this.scheduleEvaluation();
      }
    }
  }
}
