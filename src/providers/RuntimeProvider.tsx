import { useState, useCallback, useEffect, useRef, useMemo, type ReactNode, createContext as createCtx, useContext as useCtx } from 'react';
import type { ThreadMessageLike, AppendMessage } from '@assistant-ui/react';
import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
} from '@assistant-ui/react';
import { app } from '@/lib/ipc-client';
import { useAttachments } from './AttachmentContext';
import { useConfig } from './ConfigProvider';
import { createUnifiedSpeechAdapter, createUnifiedDictationAdapter, type AudioProvider } from '@/lib/audio/speech-adapters';

export type DebateEnrichment = {
  enabled: boolean;
  rounds?: number;
  advocate_model?: string;
  challenger_model?: string;
  judge_model?: string;
  advocate_summary?: string;
  challenger_summary?: string;
  judge_confidence?: number;
};

export type CurationEnrichment = {
  thinking_blocks_stripped?: number;
  tool_results_distilled?: number;
  exchanges_folded?: number;
  superseded_reads_evicted?: number;
  duplicates_removed?: number;
  token_savings_estimate?: number;
};

export type PipelineEnrichments = {
  debate?: DebateEnrichment;
  curation?: CurationEnrichment;
};

export type TokenUsageData = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
};

type ContentPart =
  | { type: 'text'; text: string; source?: 'assistant' | 'observer' | 'interrupt' | 'unspoken' }
  | { type: 'image'; image: string }
  | { type: 'file'; data: string; mimeType: string; filename: string }
  | { type: 'enrichments'; enrichments: PipelineEnrichments }
  | {
    type: 'tool-call';
    toolCallId: string;
    toolName: string;
    args: unknown;
    argsText?: string;
    result?: unknown;
    isError?: boolean;
    startedAt?: string;
    finishedAt?: string;
    /** Original (pre-compaction) result content — present only when tool output was compacted */
    originalResult?: unknown;
    /** Tool compaction metadata — present only when tool output was compacted */
    compactionMeta?: {
      wasCompacted: boolean;
      extractionDurationMs: number;
    };
    /** Live compaction phase — 'start' while AI summarization is running, cleared on complete */
    compactionPhase?: 'start' | 'complete' | null;
    liveOutput?: {
      stdout?: string;
      stderr?: string;
      truncated?: boolean;
      stopped?: boolean;
      subAgentConversationId?: string;
    };
  };

// A message with an ID and parentId for tree branching
type StoredMessage = ThreadMessageLike & {
  id: string;
  parentId: string | null;
  tokenUsage?: TokenUsageData;
};

export type ConversationRecord = {
  id: string;
  title: string | null;
  fallbackTitle: string | null;
  messages: ThreadMessageLike[];
  /** Full message tree for branch support. If absent, messages array is the linear history. */
  messageTree?: StoredMessage[];
  /** ID of the current head message in the tree */
  headId?: string | null;
  conversationCompaction: unknown | null;
  lastContextUsage: unknown | null;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string | null;
  titleStatus: string;
  titleUpdatedAt: string | null;
  messageCount: number;
  userMessageCount: number;
  runStatus: string;
  hasUnread: boolean;
  lastAssistantUpdateAt: string | null;
  selectedModelKey: string | null;
  selectedProfileKey?: string | null;
  fallbackEnabled?: boolean;
  profilePrimaryModelKey?: string | null;
  // Sub-agent metadata
  parentConversationId?: string | null;
  parentToolCallId?: string | null;
  subAgentDepth?: number;
  isSubAgent?: boolean;
};

export type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh';

export type SubAgentThreadState = {
  conversationId: string;
  parentConversationId: string;
  parentToolCallId: string;
  task: string;
  status: 'running' | 'awaiting-input' | 'completed' | 'stopped' | 'error';
  messages: StoredMessage[];
  headId: string | null;
  depth: number;
};

function nowIso(): string {
  return new Date().toISOString();
}

function summarizeToolParts(parts: ContentPart[]): Array<Record<string, unknown>> {
  return parts
    .filter((part) => part.type === 'tool-call')
    .map((part) => ({
      toolCallId: part.toolCallId,
      toolName: part.toolName,
      hasResult: part.result !== undefined,
      compactionPhase: part.compactionPhase ?? null,
      wasCompacted: part.compactionMeta?.wasCompacted ?? false,
    }));
}

function logRuntimeToolDebug(stage: string, details: Record<string, unknown>): void {
  console.info(`[RuntimeToolDebug] ${stage} ${JSON.stringify(details)}`);
}

function msgId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function toStoredContent(parts: ContentPart[]): ThreadMessageLike['content'] {
  return parts as unknown as ThreadMessageLike['content'];
}

function extractUserText(messages: ThreadMessageLike[]): string {
  const firstUser = messages.find((message) => message.role === 'user');
  if (!firstUser || !Array.isArray(firstUser.content)) return '';

  return firstUser.content
    .filter((part: unknown) => (part as { type?: string }).type === 'text')
    .map((part: unknown) => (part as { text?: string }).text ?? '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toTitleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function deriveFallbackTitle(messages: ThreadMessageLike[]): string | null {
  const text = extractUserText(messages)
    .replace(/[?!.,]+$/g, '')
    .trim();

  if (!text) return null;

  const weatherMatch = text.match(/\bweather(?:\s+(?:in|for|at)\s+(.+))?$/i);
  if (weatherMatch) {
    const location = weatherMatch[1]?.trim();
    return location ? `${toTitleCase(location)} Weather` : 'Weather';
  }

  const simplified = text
    .replace(/^(what(?:'s| is)|can you|could you|would you|please|tell me|show me|give me)\s+/i, '')
    .replace(/[^\w\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!simplified) return null;

  return toTitleCase(
    simplified
      .split(' ')
      .filter((word) => word.length > 1)
      .slice(0, 4)
      .join(' '),
  ) || null;
}

// --- Message tree helpers ---

/** Walk from a leaf message up to the root, returning the active branch (reversed to chronological order) */
function getActiveBranch(tree: StoredMessage[], headId: string | null): StoredMessage[] {
  if (!headId || tree.length === 0) return [];
  const byId = new Map(tree.map((m) => [m.id, m]));
  const branch: StoredMessage[] = [];
  let current = headId;
  while (current) {
    const msg = byId.get(current);
    if (!msg) break;
    branch.unshift(msg);
    current = msg.parentId!;
  }
  return branch;
}

// Branch navigation context
import { createContext, useContext } from 'react';

// Sub-agent context
type SubAgentActions = {
  threads: Map<string, SubAgentThreadState>;
  sendMessage: (subAgentConversationId: string, text: string) => Promise<void>;
  stop: (subAgentConversationId: string) => Promise<void>;
  deleteThread: (subAgentConversationId: string) => void;
  navigateTo: (subAgentConversationId: string) => void;
  activeSubAgentView: string | null;
  setActiveSubAgentView: (id: string | null) => void;
};

const SubAgentContext = createCtx<SubAgentActions>({
  threads: new Map(),
  sendMessage: async () => {},
  stop: async () => {},
  deleteThread: () => {},
  navigateTo: () => {},
  activeSubAgentView: null,
  setActiveSubAgentView: () => {},
});

export function useSubAgents(): SubAgentActions {
  return useCtx(SubAgentContext);
}

type BranchNav = {
  total: number;
  current: number; // 1-based
  goToPrevious: () => void;
  goToNext: () => void;
};

const BranchNavContext = createContext<BranchNav | null>(null);

export function useBranchNav(): BranchNav | null {
  return useContext(BranchNavContext);
}

// --- Module-level sub-agent state (survives RuntimeProvider remounts) ---

const globalSubAgentThreads = new Map<string, SubAgentThreadState>();
const globalSubAgentAccumulators = new Map<string, { messages: StoredMessage[]; headId: string | null }>();
let globalSubAgentVersion = 0; // bumped on every change to trigger re-renders

// --- Stream accumulator functions ---

const streamAccumulators = new Map<string, { messages: StoredMessage[]; headId: string | null }>();
/** Conversations where the next assistant message should be forced-new (after realtime call reconnect) */
const forceNewAssistant = new Set<string>();

function getOrCreateAssistantInAcc(acc: { messages: StoredMessage[]; headId: string | null }): { msg: StoredMessage; idx: number } {
  const branch = getActiveBranch(acc.messages, acc.headId);
  const last = branch[branch.length - 1];
  if (last?.role === 'assistant') {
    const idx = acc.messages.findIndex((m) => m.id === last.id);
    return { msg: last, idx };
  }
  // Create new assistant message
  const newMsg: StoredMessage = {
    id: msgId(),
    parentId: acc.headId,
    role: 'assistant',
    content: [],
    createdAt: new Date(),
  };
  acc.messages.push(newMsg);
  acc.headId = newMsg.id;
  return { msg: newMsg, idx: acc.messages.length - 1 };
}

function applyTextDelta(acc: { messages: StoredMessage[]; headId: string | null }, text: string): void {
  const { msg, idx } = getOrCreateAssistantInAcc(acc);
  const content = (Array.isArray(msg.content) ? [...msg.content] : []) as ContentPart[];
  const lastPart = content[content.length - 1];

  if (lastPart?.type === 'text' && (lastPart.source ?? 'assistant') === 'assistant') {
    content[content.length - 1] = { type: 'text', source: 'assistant', text: lastPart.text + text };
  } else {
    content.push({ type: 'text', source: 'assistant', text });
  }
  acc.messages[idx] = { ...msg, content: toStoredContent(content) };
}

function applyObserverMessage(acc: { messages: StoredMessage[]; headId: string | null }, text: string): void {
  const { msg, idx } = getOrCreateAssistantInAcc(acc);
  const content = (Array.isArray(msg.content) ? [...msg.content] : []) as ContentPart[];
  const normalized = text.trim();
  if (!normalized) return;
  const lastPart = content[content.length - 1];
  // Keep observer updates plain and lightweight; the assistant response adds the separator
  // when transitioning back to final output.
  const block = `${lastPart?.type === 'text' ? '\n\n' : ''}${normalized}\n\n`;
  content.push({ type: 'text', source: 'observer', text: block });
  acc.messages[idx] = { ...msg, content: toStoredContent(content) };
}

function applyToolCall(
  acc: { messages: StoredMessage[]; headId: string | null },
  e: { toolCallId: string; toolName: string; args: unknown; startedAt?: string },
): void {
  const { msg, idx } = getOrCreateAssistantInAcc(acc);
  const content = (Array.isArray(msg.content) ? [...msg.content] : []) as ContentPart[];
  const existingIdx = content.findIndex((p) => p.type === 'tool-call' && p.toolCallId === e.toolCallId);
  const matchMode = existingIdx >= 0 ? 'exact' : 'new';
  if (existingIdx >= 0) {
    const existing = content[existingIdx] as ContentPart & { type: 'tool-call' };
    content[existingIdx] = {
      ...existing,
      toolName: e.toolName || existing.toolName,
      args: e.args ?? existing.args ?? {},
      argsText: JSON.stringify(e.args ?? existing.args ?? {}, null, 2),
      startedAt: e.startedAt ?? existing.startedAt ?? nowIso(),
      liveOutput: existing.liveOutput ?? { stdout: '', stderr: '', truncated: false, stopped: false },
    };
  } else {
    content.push({
      type: 'tool-call',
      toolCallId: e.toolCallId,
      toolName: e.toolName,
      args: e.args ?? {},
      argsText: JSON.stringify(e.args, null, 2),
      startedAt: e.startedAt ?? nowIso(),
      liveOutput: { stdout: '', stderr: '', truncated: false, stopped: false },
    });
  }
  logRuntimeToolDebug('apply-tool-call', {
    toolCallId: e.toolCallId,
    toolName: e.toolName,
    matchMode,
    toolParts: summarizeToolParts(content),
  });
  acc.messages[idx] = { ...msg, content: toStoredContent(content) };
}

function applyToolProgress(
  acc: { messages: StoredMessage[]; headId: string | null },
  e: {
    toolCallId?: string;
    toolName?: string;
    data?: {
      stream?: 'stdout' | 'stderr';
      output?: string;
      truncated?: boolean;
      stopped?: boolean;
    };
  },
): void {
  const { msg, idx } = getOrCreateAssistantInAcc(acc);
  const content = (Array.isArray(msg.content) ? [...msg.content] : []) as ContentPart[];
  let tcIdx = -1;
  let matchMode: 'exact' | 'fallback' | 'orphan' = 'orphan';
  if (e.toolCallId) {
    tcIdx = content.findIndex((p) => p.type === 'tool-call' && p.toolCallId === e.toolCallId);
    if (tcIdx >= 0) matchMode = 'exact';
  }
  if (tcIdx < 0) {
    // Some runtimes emit progress before call metadata or without call id.
    // In that case attach to the most recent unresolved tool call.
    for (let i = content.length - 1; i >= 0; i--) {
      const part = content[i];
      if (part.type !== 'tool-call') continue;
      if (part.result !== undefined) continue;
      if (e.toolName && part.toolName !== e.toolName) continue;
      tcIdx = i;
      matchMode = 'fallback';
      break;
    }
  }
  if (tcIdx < 0) {
    // Ignore orphan progress without a resolvable tool call to avoid duplicate cards.
    logRuntimeToolDebug('apply-tool-progress-orphan', {
      toolCallId: e.toolCallId ?? null,
      toolName: e.toolName ?? null,
      toolParts: summarizeToolParts(content),
    });
    return;
  }

  const existing = content[tcIdx] as ContentPart & { type: 'tool-call' };
  const liveOutput = {
    stdout: existing.liveOutput?.stdout ?? '',
    stderr: existing.liveOutput?.stderr ?? '',
    truncated: existing.liveOutput?.truncated ?? false,
    stopped: existing.liveOutput?.stopped ?? false,
    subAgentConversationId: existing.liveOutput?.subAgentConversationId
      ?? (e.data as { subAgentConversationId?: string } | undefined)?.subAgentConversationId,
  };
  if (e.data?.stream === 'stdout') liveOutput.stdout = e.data.output ?? liveOutput.stdout;
  if (e.data?.stream === 'stderr') liveOutput.stderr = e.data.output ?? liveOutput.stderr;
  liveOutput.truncated = Boolean(liveOutput.truncated || e.data?.truncated);
  liveOutput.stopped = Boolean(liveOutput.stopped || e.data?.stopped);
  content[tcIdx] = { ...existing, liveOutput };
  logRuntimeToolDebug('apply-tool-progress', {
    toolCallId: e.toolCallId ?? null,
    toolName: e.toolName ?? null,
    matchMode,
    toolParts: summarizeToolParts(content),
  });
  acc.messages[idx] = { ...msg, content: toStoredContent(content) };
}

function applyToolCompaction(
  acc: { messages: StoredMessage[]; headId: string | null },
  e: {
    toolCallId?: string;
    toolName?: string;
    data?: {
      phase?: 'start' | 'complete' | 'error' | null;
      originalContent?: string;
      extractionDurationMs?: number;
    };
  },
): void {
  const { msg, idx } = getOrCreateAssistantInAcc(acc);
  const content = (Array.isArray(msg.content) ? [...msg.content] : []) as ContentPart[];
  let tcIdx = -1;
  let matchMode: 'exact' | 'fallback' | 'created' = 'created';
  if (e.toolCallId) {
    tcIdx = content.findIndex((p) => p.type === 'tool-call' && p.toolCallId === e.toolCallId);
    if (tcIdx >= 0) matchMode = 'exact';
  }
  if (tcIdx < 0) {
    for (let i = content.length - 1; i >= 0; i--) {
      const part = content[i];
      if (part.type !== 'tool-call') continue;
      if (part.result !== undefined) continue;
      if (e.toolName && part.toolName !== e.toolName) continue;
      tcIdx = i;
      matchMode = 'fallback';
      break;
    }
  }
  if (tcIdx < 0) {
    if (!e.toolCallId) return;
    content.push({
      type: 'tool-call',
      toolCallId: e.toolCallId,
      toolName: e.toolName ?? 'unknown',
      args: {},
      argsText: '{}',
      startedAt: nowIso(),
      liveOutput: { stdout: '', stderr: '', truncated: false, stopped: false },
    });
    tcIdx = content.length - 1;
    matchMode = 'created';
  }

  const existing = content[tcIdx] as ContentPart & { type: 'tool-call' };
  if (e.data?.phase === 'start') {
    content[tcIdx] = {
      ...existing,
      compactionPhase: 'start',
      ...(typeof e.data.originalContent === 'string' && e.data.originalContent.length > 0
        ? { originalResult: existing.originalResult ?? e.data.originalContent }
        : {}),
    };
  } else if (e.data?.phase === 'complete') {
    content[tcIdx] = {
      ...existing,
      compactionPhase: 'complete',
      ...(typeof e.data.originalContent === 'string' && e.data.originalContent.length > 0
        ? { originalResult: existing.originalResult ?? e.data.originalContent }
        : {}),
      compactionMeta: {
        wasCompacted: true,
        extractionDurationMs: e.data.extractionDurationMs ?? existing.compactionMeta?.extractionDurationMs ?? 0,
      },
    };
  } else {
    content[tcIdx] = {
      ...existing,
      compactionPhase: null,
    };
  }

  logRuntimeToolDebug('apply-tool-compaction', {
    toolCallId: e.toolCallId ?? null,
    toolName: e.toolName ?? null,
    phase: e.data?.phase ?? null,
    matchMode,
    hasOriginalContent: typeof e.data?.originalContent === 'string' && e.data.originalContent.length > 0,
    extractionDurationMs: e.data?.extractionDurationMs ?? null,
    toolParts: summarizeToolParts(content),
  });
  acc.messages[idx] = { ...msg, content: toStoredContent(content) };
}

function applyToolResult(
  acc: { messages: StoredMessage[]; headId: string | null },
  e: {
    toolCallId?: string;
    toolName?: string;
    result: unknown;
    startedAt?: string;
    finishedAt?: string;
    compaction?: {
      originalContent: string;
      wasCompacted: boolean;
      extractionDurationMs: number;
    };
  },
): void {
  const { msg, idx } = getOrCreateAssistantInAcc(acc);
  const content = (Array.isArray(msg.content) ? [...msg.content] : []) as ContentPart[];
  let tcIdx = -1;
  let matchMode: 'exact' | 'fallback' | 'created' = 'created';
  if (e.toolCallId) {
    tcIdx = content.findIndex((p) => p.type === 'tool-call' && p.toolCallId === e.toolCallId);
    if (tcIdx >= 0) matchMode = 'exact';
  }
  if (tcIdx < 0) {
    for (let i = content.length - 1; i >= 0; i--) {
      const part = content[i];
      if (part.type !== 'tool-call') continue;
      if (part.result !== undefined) continue;
      if (e.toolName && part.toolName !== e.toolName) continue;
      tcIdx = i;
      matchMode = 'fallback';
      break;
    }
  }
  if (tcIdx < 0) {
    if (!e.toolCallId) return;
    content.push({
      type: 'tool-call',
      toolCallId: e.toolCallId,
      toolName: e.toolName ?? 'unknown',
      args: {},
      argsText: '{}',
      startedAt: e.startedAt ?? nowIso(),
      liveOutput: { stdout: '', stderr: '', truncated: false, stopped: false },
    });
    tcIdx = content.length - 1;
    matchMode = 'created';
  }
  if (tcIdx >= 0) {
    const existing = content[tcIdx] as ContentPart & { type: 'tool-call' };
    const finishedAt = e.finishedAt ?? nowIso();

    // If compaction metadata was injected by the main process, apply it
    const compactionFields: Partial<ContentPart & { type: 'tool-call' }> = e.compaction?.wasCompacted
      ? {
          originalResult: e.compaction.originalContent,
          compactionMeta: {
            wasCompacted: true,
            extractionDurationMs: e.compaction.extractionDurationMs,
          },
          compactionPhase: 'complete' as const,
        }
      : {};

    content[tcIdx] = {
      ...existing,
      result: e.result,
      startedAt: e.startedAt ?? existing.startedAt ?? finishedAt,
      finishedAt,
      ...(!e.compaction?.wasCompacted && existing.compactionPhase === 'start'
        ? { compactionPhase: existing.compactionMeta?.wasCompacted ? 'complete' as const : null }
        : {}),
      ...compactionFields,
    };
  }
  logRuntimeToolDebug('apply-tool-result', {
    toolCallId: e.toolCallId ?? null,
    toolName: e.toolName ?? null,
    matchMode,
    hasCompaction: Boolean(e.compaction?.wasCompacted),
    toolParts: summarizeToolParts(content),
  });
  acc.messages[idx] = { ...msg, content: toStoredContent(content) };
}

function applyTokenUsage(acc: { messages: StoredMessage[]; headId: string | null }, usage: TokenUsageData): void {
  const branch = getActiveBranch(acc.messages, acc.headId);
  const last = branch[branch.length - 1];
  if (!last || last.role !== 'assistant') return;
  const idx = acc.messages.findIndex((m) => m.id === last.id);
  if (idx < 0) return;
  acc.messages[idx] = { ...acc.messages[idx], tokenUsage: usage };
}

function applyError(acc: { messages: StoredMessage[]; headId: string | null }, error: string): void {
  const { msg, idx } = getOrCreateAssistantInAcc(acc);
  const content = (Array.isArray(msg.content) ? [...msg.content] : []) as ContentPart[];
  content.push({ type: 'text', text: `\n\n**Error:** ${error}` });
  acc.messages[idx] = { ...msg, content: toStoredContent(content) };
}

function applyEnrichments(
  acc: { messages: StoredMessage[]; headId: string | null },
  data: Record<string, unknown>,
): void {
  // Normalize daemon enrichment payload — supports both flat keys and nested
  const debate = (data['debate:result'] ?? data['debate'] ?? data['debate_result']) as Record<string, unknown> | undefined;
  const curation = (data['curation:stats'] ?? data['curation'] ?? data['curation_stats']) as Record<string, unknown> | undefined;

  if (!debate && !curation) return;

  const enrichments: PipelineEnrichments = {};

  if (debate && typeof debate === 'object') {
    enrichments.debate = {
      enabled: Boolean(debate.enabled ?? true),
      rounds: typeof debate.rounds === 'number' ? debate.rounds : undefined,
      advocate_model: typeof debate.advocate_model === 'string' ? debate.advocate_model : undefined,
      challenger_model: typeof debate.challenger_model === 'string' ? debate.challenger_model : undefined,
      judge_model: typeof debate.judge_model === 'string' ? debate.judge_model : undefined,
      advocate_summary: typeof debate.advocate_summary === 'string' ? debate.advocate_summary : undefined,
      challenger_summary: typeof debate.challenger_summary === 'string' ? debate.challenger_summary : undefined,
      judge_confidence: typeof debate.judge_confidence === 'number' ? debate.judge_confidence : undefined,
    };
  }

  if (curation && typeof curation === 'object') {
    enrichments.curation = {
      thinking_blocks_stripped: typeof curation.thinking_blocks_stripped === 'number' ? curation.thinking_blocks_stripped : undefined,
      tool_results_distilled: typeof curation.tool_results_distilled === 'number' ? curation.tool_results_distilled : undefined,
      exchanges_folded: typeof curation.exchanges_folded === 'number' ? curation.exchanges_folded : undefined,
      superseded_reads_evicted: typeof curation.superseded_reads_evicted === 'number' ? curation.superseded_reads_evicted : undefined,
      duplicates_removed: typeof curation.duplicates_removed === 'number' ? curation.duplicates_removed : undefined,
      token_savings_estimate: typeof curation.token_savings_estimate === 'number' ? curation.token_savings_estimate : undefined,
    };
  }

  const { msg, idx } = getOrCreateAssistantInAcc(acc);
  const content = (Array.isArray(msg.content) ? [...msg.content] : []) as ContentPart[];

  // Replace existing enrichments part if present, otherwise append
  const existingIdx = content.findIndex((p) => p.type === 'enrichments');
  if (existingIdx >= 0) {
    content[existingIdx] = { type: 'enrichments', enrichments };
  } else {
    content.push({ type: 'enrichments', enrichments });
  }

  acc.messages[idx] = { ...msg, content: toStoredContent(content) };
}

function discardTrailingAssistant(acc: { messages: StoredMessage[]; headId: string | null }): void {
  const branch = getActiveBranch(acc.messages, acc.headId);
  const last = branch[branch.length - 1];
  if (last?.role !== 'assistant') return;
  acc.messages = acc.messages.filter((m) => m.id !== last.id);
  acc.headId = last.parentId ?? null;
}

// --- Persistence ---

async function persistConversation(
  conversationId: string,
  tree: StoredMessage[],
  headId: string | null,
  updates: Partial<ConversationRecord> = {},
): Promise<void> {
  try {
    const conv = await app.conversations.get(conversationId) as ConversationRecord | null;
    if (!conv) return;
    const branch = getActiveBranch(tree, headId);
    const now = nowIso();
    await app.conversations.put({
      ...conv,
      messages: branch, // linear view for backward compat
      messageTree: tree,
      headId,
      fallbackTitle: conv.fallbackTitle ?? null,
      updatedAt: now,
      lastMessageAt: now,
      messageCount: branch.length,
      userMessageCount: branch.filter((m) => m.role === 'user').length,
      ...updates,
    });
  } catch (err) {
    console.error('[Runtime] Failed to persist:', err);
  }
}

// --- Title generation with maelstrom-style retitle logic ---

type TitleSettings = {
  enabled: boolean;
  retitleIntervalMessages: number;
  retitleEagerUntilMessage: number;
};

// Track last retitle count per conversation to avoid duplicate title gen
const lastRetitleCount = new Map<string, number>();
const titleGenInFlight = new Set<string>();

async function getTitleSettings(): Promise<TitleSettings> {
  try {
    const config = await app.config.get() as { titleGeneration?: TitleSettings } | null;
    return config?.titleGeneration ?? { enabled: true, retitleIntervalMessages: 5, retitleEagerUntilMessage: 5 };
  } catch {
    return { enabled: true, retitleIntervalMessages: 5, retitleEagerUntilMessage: 5 };
  }
}

async function maybeGenerateTitle(conversationId: string, messages: ThreadMessageLike[]): Promise<void> {
  try {
    const settings = await getTitleSettings();
    if (!settings.enabled) return;

    const conv = await app.conversations.get(conversationId) as ConversationRecord | null;
    if (!conv) return;

    const userMessageCount = messages.filter((m) => m.role === 'user').length;
    if (userMessageCount !== 1) return;

    // Dedup: don't regenerate if we already did for this exact user message count
    const lastCount = lastRetitleCount.get(conversationId);
    if (lastCount === userMessageCount) return;

    // Don't run concurrent title gen for same conversation
    if (titleGenInFlight.has(conversationId)) return;

    lastRetitleCount.set(conversationId, userMessageCount);
    titleGenInFlight.add(conversationId);

    try {
      // Mark as generating
      await app.conversations.put({ ...conv, titleStatus: 'generating' });

      // Stagger the title request slightly so Bedrock is less likely to reject
      // it when the main response request starts at the exact same moment.
      await new Promise((resolve) => setTimeout(resolve, 350));

      const result = await app.agent.generateTitle(messages, conv.selectedModelKey ?? undefined);
      if (result.title) {
        const latest = await app.conversations.get(conversationId) as ConversationRecord | null;
        if (latest) {
          await app.conversations.put({
            ...latest,
            title: result.title,
            fallbackTitle: result.title,
            titleStatus: 'ready',
            titleUpdatedAt: nowIso(),
          });
        }
      } else {
        // Title gen returned nothing — keep the UI moving with a simple fallback.
        const latest = await app.conversations.get(conversationId) as ConversationRecord | null;
        if (latest && latest.titleStatus === 'generating') {
          const fallbackTitle = latest.fallbackTitle ?? deriveFallbackTitle(messages);
          await app.conversations.put({ ...latest, fallbackTitle, titleStatus: 'idle' });
        }
      }
    } finally {
      titleGenInFlight.delete(conversationId);
    }
  } catch {
    const latest = await app.conversations.get(conversationId) as ConversationRecord | null;
    if (latest && latest.titleStatus === 'generating') {
      const fallbackTitle = latest.fallbackTitle ?? deriveFallbackTitle(messages);
      await app.conversations.put({ ...latest, fallbackTitle, titleStatus: 'idle' });
    }
    titleGenInFlight.delete(conversationId);
  }
}

// --- Helpers to convert flat messages to tree ---

function ensureTree(conv: ConversationRecord): { tree: StoredMessage[]; headId: string | null } {
  if (conv.messageTree && conv.messageTree.length > 0) {
    // Rehydrate createdAt from ISO string to Date
    const tree = conv.messageTree.map((m) => ({
      ...m,
      createdAt: m.createdAt ? new Date(m.createdAt as unknown as string) : undefined,
    }));
    return { tree, headId: conv.headId ?? tree[tree.length - 1]?.id ?? null };
  }
  // Convert flat messages to tree
  let parentId: string | null = null;
  const tree: StoredMessage[] = (conv.messages ?? []).map((m) => {
    const id = (m as StoredMessage).id || msgId();
    const sm: StoredMessage = { ...m, id, parentId, role: m.role as 'user' | 'assistant' };
    parentId = id;
    return sm;
  });
  const headId = tree.length > 0 ? tree[tree.length - 1].id : null;
  return { tree, headId };
}

// Fallback banner context
type FallbackBannerState = {
  fromModel: string;
  toModel: string;
  error: string;
  reason?: string;
} | null;

type FallbackBannerActions = {
  banner: FallbackBannerState;
  dismiss: () => void;
};

const FallbackBannerContext = createCtx<FallbackBannerActions>({
  banner: null,
  dismiss: () => {},
});

export function useFallbackBanner(): FallbackBannerActions {
  return useCtx(FallbackBannerContext);
}

// =============================================================================

export function RuntimeProvider({
  children,
  conversationId,
  selectedModelKey,
  reasoningEffort,
  selectedProfileKey,
  fallbackEnabled,
  onModelFallback,
  onConversationSettingsLoaded,
}: {
  children: ReactNode;
  conversationId?: string | null;
  selectedModelKey?: string | null;
  reasoningEffort?: ReasoningEffort;
  selectedProfileKey?: string | null;
  fallbackEnabled?: boolean;
  onModelFallback?: (toModelKey: string) => void;
  onConversationSettingsLoaded?: (settings: { selectedModelKey: string | null; selectedProfileKey: string | null; fallbackEnabled: boolean; profilePrimaryModelKey: string | null }) => void;
}) {
  const [tree, setTree] = useState<StoredMessage[]>([]);
  const [headId, setHeadId] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [fallbackBanner, setFallbackBanner] = useState<FallbackBannerState>(null);
  const fallbackBannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeIdRef = useRef<string | null>(null);
  const treeRef = useRef<StoredMessage[]>([]);
  const headIdRef = useRef<string | null>(null);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onModelFallbackRef = useRef(onModelFallback);
  onModelFallbackRef.current = onModelFallback;
  const onConversationSettingsLoadedRef = useRef(onConversationSettingsLoaded);
  onConversationSettingsLoadedRef.current = onConversationSettingsLoaded;
  const { consumeAttachments } = useAttachments();

  // --- Audio adapters (TTS & Dictation) ---
  const { config } = useConfig();
  type ExpandedAudioConfig = {
    provider?: AudioProvider;
    azure?: {
      endpoint?: string;
      region?: string;
      subscriptionKey?: string;
      ttsVoice?: string;
      ttsOutputFormat?: string;
      ttsRate?: number;
      sttLanguage?: string;
      sttEndpoint?: string;
    };
    tts?: { enabled?: boolean; voice?: string; rate?: number };
    dictation?: { enabled?: boolean; language?: string; continuous?: boolean };
  };
  const audioConfig = (config as Record<string, unknown> | null)?.audio as ExpandedAudioConfig | undefined;
  const audioProvider: AudioProvider = audioConfig?.provider ?? 'native';

  const speechAdapter = useMemo(() => {
    const tts = audioConfig?.tts;
    if (!tts?.enabled) return undefined;

    return createUnifiedSpeechAdapter({
      provider: audioProvider,
      enabled: true,
      voice: tts.voice,
      rate: tts.rate ?? 1,
      azure: audioProvider === 'azure' ? {
        endpoint: audioConfig?.azure?.endpoint,
        region: audioConfig?.azure?.region ?? 'eastus',
        subscriptionKey: audioConfig?.azure?.subscriptionKey ?? '',
        voice: audioConfig?.azure?.ttsVoice ?? 'en-US-JennyNeural',
        outputFormat: audioConfig?.azure?.ttsOutputFormat ?? 'audio-24khz-48kbitrate-mono-mp3',
        rate: audioConfig?.azure?.ttsRate ?? 1,
      } : undefined,
    });
  }, [
    audioProvider,
    audioConfig?.tts?.enabled, audioConfig?.tts?.voice, audioConfig?.tts?.rate,
    audioConfig?.azure?.endpoint, audioConfig?.azure?.region,
    audioConfig?.azure?.subscriptionKey, audioConfig?.azure?.ttsVoice,
    audioConfig?.azure?.ttsOutputFormat, audioConfig?.azure?.ttsRate,
  ]);

  const dictationAdapter = useMemo(() => {
    const dict = audioConfig?.dictation;
    if (!dict?.enabled) return undefined;

    return createUnifiedDictationAdapter({
      provider: audioProvider,
      enabled: true,
      language: dict.language,
      continuous: dict.continuous ?? true,
      azure: audioProvider === 'azure' ? {
        endpoint: audioConfig?.azure?.endpoint,
        region: audioConfig?.azure?.region ?? 'eastus',
        subscriptionKey: audioConfig?.azure?.subscriptionKey ?? '',
        language: audioConfig?.azure?.sttLanguage ?? dict.language ?? 'en-US',
        continuous: dict.continuous ?? true,
        inputDeviceId: (audioConfig?.dictation as { inputDeviceId?: string } | undefined)?.inputDeviceId,
      } : undefined,
    });
  }, [
    audioProvider,
    audioConfig?.dictation?.enabled, audioConfig?.dictation?.language, audioConfig?.dictation?.continuous,
    audioConfig?.azure?.endpoint, audioConfig?.azure?.region,
    audioConfig?.azure?.subscriptionKey, audioConfig?.azure?.sttLanguage,
  ]);

  // Sub-agent state — backed by module-level globals so it survives remounts
  const [subAgentVersion, setSubAgentVersion] = useState(globalSubAgentVersion);
  const [activeSubAgentView, setActiveSubAgentView] = useState<string | null>(null);
  // Snapshot of global threads for rendering (updated when version changes)
  const subAgentThreads = useMemo(() => new Map(globalSubAgentThreads), [subAgentVersion]);

  const bumpSubAgentVersion = useCallback(() => {
    globalSubAgentVersion++;
    setSubAgentVersion(globalSubAgentVersion);
  }, []);

  useEffect(() => { activeIdRef.current = activeConversationId; }, [activeConversationId]);
  useEffect(() => { treeRef.current = tree; }, [tree]);
  useEffect(() => { headIdRef.current = headId; }, [headId]);

  // Derive active branch from tree
  const activeBranch = useMemo(() => getActiveBranch(tree, headId), [tree, headId]);

  // Track siblings for branch picking — only when not streaming to avoid transient wrong counts
  const branchInfo = useMemo(() => {
    if (isRunning) return null; // don't show branches while generating
    const branch = getActiveBranch(tree, headId);
    const lastAssistant = [...branch].reverse().find((m) => m.role === 'assistant');
    if (!lastAssistant) return null;
    const parentId = lastAssistant.parentId;
    const siblings = tree.filter((m) => m.parentId === parentId && m.role === 'assistant');
    if (siblings.length <= 1) return null; // no branches
    const currentIdx = siblings.findIndex((m) => m.id === lastAssistant.id);
    return { siblings, currentIdx, total: siblings.length, parentId };
  }, [tree, headId, isRunning]);

  const loadConversationState = useCallback(async (id: string) => {
    const conv = await app.conversations.get(id) as ConversationRecord | null;
    if (!conv) return false;

    const { tree: t, headId: h } = ensureTree(conv);
    setActiveConversationId(id);
    setTree(t);
    setHeadId(h);

    const hasActiveStream = streamAccumulators.has(id);
    setIsRunning(hasActiveStream);
    if (conv.runStatus === 'running' && !hasActiveStream) {
      void persistConversation(id, t, h, { runStatus: 'idle' });
    }

    // Restore per-conversation settings (model, profile, fallback)
    onConversationSettingsLoadedRef.current?.({
      selectedModelKey: conv.selectedModelKey ?? null,
      selectedProfileKey: conv.selectedProfileKey ?? null,
      fallbackEnabled: conv.fallbackEnabled ?? false,
      profilePrimaryModelKey: conv.profilePrimaryModelKey ?? null,
    });

    return true;
  }, []);

  // Load active conversation on mount
  useEffect(() => {
    (async () => {
      try {
        const id = conversationId ?? await app.conversations.getActiveId();
        if (id && await loadConversationState(id)) {
          return;
        }
        const newId = crypto.randomUUID();
        const now = nowIso();
        await app.conversations.put({
          id: newId, title: null, fallbackTitle: null, messages: [], messageTree: [], headId: null,
          conversationCompaction: null, lastContextUsage: null,
          createdAt: now, updatedAt: now, lastMessageAt: null,
          titleStatus: 'idle', titleUpdatedAt: null,
          messageCount: 0, userMessageCount: 0,
          runStatus: 'idle', hasUnread: false, lastAssistantUpdateAt: null,
          selectedModelKey: null,
        } as ConversationRecord);
        await app.conversations.setActiveId(newId);
        setActiveConversationId(newId);
        setTree([]);
        setHeadId(null);
      } catch (err) {
        console.error('[Runtime] Failed to load conversation:', err);
      }
    })();
  }, [loadConversationState]);

  useEffect(() => {
    if (!conversationId || conversationId === activeConversationId) return;

    void loadConversationState(conversationId);
  }, [conversationId, activeConversationId, loadConversationState]);

  const schedulePersist = useCallback((conversationId: string, t: StoredMessage[], h: string | null, extra: Partial<ConversationRecord> = {}) => {
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => { persistConversation(conversationId, t, h, extra); }, 300);
  }, []);

  // Stable ref for values the stream handler needs without re-subscribing
  const streamHandlerRef = useRef({ tree, headId, schedulePersist });
  useEffect(() => { streamHandlerRef.current = { tree, headId, schedulePersist }; }, [tree, headId, schedulePersist]);

  // Stream event listener — subscribes ONCE, reads mutable values via refs/globals
  useEffect(() => {
    const unsubscribe = app.agent.onStreamEvent((event: unknown) => {
      const e = event as {
        conversationId: string; type: string; text?: string;
        toolCallId?: string; toolName?: string; args?: unknown;
        result?: unknown; error?: string;
        startedAt?: string; finishedAt?: string;
        compaction?: {
          originalContent: string;
          wasCompacted: boolean;
          extractionDurationMs: number;
        };
        data?: unknown;
        // Sub-agent fields
        subAgentConversationId?: string;
        parentConversationId?: string;
        parentToolCallId?: string;
        status?: string;
        summary?: string;
      };

      // Route sub-agent events to global sub-agent state
      if (e.subAgentConversationId) {
        const saId = e.subAgentConversationId;

        if (e.type === 'sub-agent-status') {
          const existing = globalSubAgentThreads.get(saId);
          const rawSummary = e.summary ?? '';
          const cleanTask = rawSummary.startsWith('Starting task: ')
            ? rawSummary.slice('Starting task: '.length)
            : rawSummary;
          if (existing) {
            globalSubAgentThreads.set(saId, {
              ...existing,
              status: (e.status as SubAgentThreadState['status']) ?? existing.status,
              task: existing.task || cleanTask,
            });
          } else {
            globalSubAgentThreads.set(saId, {
              conversationId: saId,
              parentConversationId: e.parentConversationId ?? '',
              parentToolCallId: e.parentToolCallId ?? '',
              task: cleanTask,
              status: (e.status as SubAgentThreadState['status']) ?? 'running',
              messages: [],
              headId: null,
              depth: 0,
            });
          }
          bumpSubAgentVersion();
          return;
        }

        // Accumulate sub-agent messages
        if (!globalSubAgentAccumulators.has(saId)) {
          // Initialize from existing thread messages (survives remount)
          const existingThread = globalSubAgentThreads.get(saId);
          globalSubAgentAccumulators.set(saId, {
            messages: existingThread?.messages ? [...existingThread.messages] : [],
            headId: existingThread?.headId ?? null,
          });
        }
        const saAcc = globalSubAgentAccumulators.get(saId)!;

        if (e.type === 'sub-agent-user-message') {
          // Dedup: skip if the last message in the accumulator is already
          // a user message with identical text (from local add in sendSubAgentMessage)
          const msgText = e.text ?? '';
          const lastMsg = saAcc.messages[saAcc.messages.length - 1];
          const lastIsUser = lastMsg?.role === 'user';
          const lastContent = lastIsUser && Array.isArray(lastMsg.content) ? lastMsg.content : [];
          const lastText = lastContent.find((p: unknown) => (p as { type: string }).type === 'text') as { text?: string } | undefined;
          const isDuplicate = lastIsUser && lastText?.text === msgText;

          if (!isDuplicate) {
            const userMsg: StoredMessage = {
              id: msgId(),
              parentId: saAcc.headId,
              role: 'user',
              content: toStoredContent([{ type: 'text', text: msgText }]),
              createdAt: new Date(),
            };
            saAcc.messages.push(userMsg);
            saAcc.headId = userMsg.id;
          }
        } else if (e.type === 'text-delta') {
          applyTextDelta(saAcc, e.text ?? '');
        } else if (e.type === 'tool-call' && e.toolCallId) {
          applyToolCall(saAcc, { toolCallId: e.toolCallId, toolName: e.toolName ?? 'unknown', args: e.args, startedAt: e.startedAt });
        } else if (e.type === 'tool-result') {
          applyToolResult(saAcc, { toolCallId: e.toolCallId, toolName: e.toolName, result: e.result, startedAt: e.startedAt, finishedAt: e.finishedAt });
        } else if (e.type === 'tool-progress') {
          applyToolProgress(saAcc, { toolCallId: e.toolCallId, toolName: e.toolName, data: e.data as { stream?: 'stdout' | 'stderr'; output?: string; truncated?: boolean; stopped?: boolean } | undefined });
        } else if (e.type === 'error') {
          applyError(saAcc, e.error ?? 'Unknown error');
        }

        const finalMessages = [...saAcc.messages];
        const finalHeadId = saAcc.headId;
        const isDone = e.type === 'done';

        if (isDone) {
          globalSubAgentAccumulators.delete(saId);
        }

        // Update global thread state
        const existing = globalSubAgentThreads.get(saId);
        const msgs = finalMessages.length > 0 ? finalMessages : (existing?.messages ?? []);
        const head = finalMessages.length > 0 ? finalHeadId : (existing?.headId ?? null);
        globalSubAgentThreads.set(saId, {
          conversationId: saId,
          parentConversationId: e.parentConversationId ?? existing?.parentConversationId ?? '',
          parentToolCallId: e.parentToolCallId ?? existing?.parentToolCallId ?? '',
          task: existing?.task ?? '',
          status: isDone ? 'completed' : (existing?.status ?? 'running'),
          messages: msgs,
          headId: head,
          depth: existing?.depth ?? 0,
        });
        bumpSubAgentVersion();
        return;
      }

      const convId = e.conversationId;
      const isActiveConv = convId === activeIdRef.current;

      if (!streamAccumulators.has(convId)) {
        if (isActiveConv) {
          const { tree: curTree, headId: curHead } = streamHandlerRef.current;
          streamAccumulators.set(convId, { messages: [...curTree], headId: curHead });
        } else {
          streamAccumulators.set(convId, { messages: [], headId: null });
        }
      }

      const acc = streamAccumulators.get(convId)!;

      if (e.type === 'tool-call' || e.type === 'tool-result' || e.type === 'tool-compaction') {
        logRuntimeToolDebug('stream-event', {
          conversationId: convId,
          eventType: e.type,
          toolCallId: e.toolCallId ?? null,
          toolName: e.toolName ?? null,
          compactionPhase: e.type === 'tool-compaction'
            ? ((e.data as { phase?: string } | undefined)?.phase ?? null)
            : null,
          hasResultCompaction: e.type === 'tool-result' ? Boolean(e.compaction?.wasCompacted) : false,
        });
      }

      if (e.type === 'text-delta') {
        // If a new realtime call started, force a fresh assistant message
        if (forceNewAssistant.has(convId)) {
          forceNewAssistant.delete(convId);
          const branch = getActiveBranch(acc.messages, acc.headId);
          const last = branch[branch.length - 1];
          if (last?.role === 'assistant' && Array.isArray(last.content) && last.content.length > 0) {
            const fresh: StoredMessage = {
              id: msgId(),
              parentId: acc.headId,
              role: 'assistant',
              content: [],
              createdAt: new Date(),
            };
            acc.messages.push(fresh);
            acc.headId = fresh.id;
          }
        }
        applyTextDelta(acc, e.text ?? '');
      } else if (e.type === 'realtime-user-transcript') {
        // Realtime audio: create/update a user message for spoken text
        const itemId = (e as { itemId?: string }).itemId ?? msgId();
        const text = e.text ?? '';
        const existingIdx = acc.messages.findIndex((m) => m.id === `rt-user-${itemId}`);
        if (existingIdx >= 0) {
          // Update existing partial user message
          acc.messages[existingIdx] = {
            ...acc.messages[existingIdx],
            content: [{ type: 'text', text }],
          };
        } else if (text.trim()) {
          // Create new user message for this spoken utterance
          const userMsg: StoredMessage = {
            id: `rt-user-${itemId}`,
            parentId: acc.headId,
            role: 'user',
            content: [{ type: 'text', text }],
            createdAt: new Date(),
          };
          acc.messages.push(userMsg);
          acc.headId = userMsg.id;
        }
      } else if (e.type === 'realtime-interrupt') {
        // User interrupted the AI response. Replace the assistant message content
        // to show spoken text normally, then an interrupt marker, then unspoken text struck-through.
        const payload = e as { spokenText?: string; unspokenText?: string };
        const spokenText = payload.spokenText ?? '';
        const unspokenText = payload.unspokenText ?? '';

        // Find the current assistant message and replace its content
        let assistantIdx = -1;
        for (let i = acc.messages.length - 1; i >= 0; i--) {
          if (acc.messages[i].role === 'assistant') { assistantIdx = i; break; }
        }
        if (assistantIdx >= 0) {
          const newContent: ContentPart[] = [];
          if (spokenText) newContent.push({ type: 'text', source: 'assistant', text: spokenText });
          newContent.push({ type: 'text', source: 'interrupt', text: '[interrupted]' });
          if (unspokenText) newContent.push({ type: 'text', source: 'unspoken', text: unspokenText });
          acc.messages[assistantIdx] = { ...acc.messages[assistantIdx], content: toStoredContent(newContent) };
        }
      } else if (e.type === 'realtime-status') {
        const rtStatus = (e as { status?: string }).status;
        // When a new realtime call connects, finalize the existing accumulator
        // so the new call starts with a clean slate — prevents the new greeting
        // from merging into the previous call's last assistant message.
        if (rtStatus === 'connected' && acc.messages.length > 0) {
          if (persistTimerRef.current) { clearTimeout(persistTimerRef.current); persistTimerRef.current = null; }
          streamAccumulators.delete(convId);
          forceNewAssistant.add(convId);
          persistConversation(convId, acc.messages, acc.headId, {
            lastAssistantUpdateAt: new Date().toISOString(),
          });
          if (isActiveConv) {
            setTree([...acc.messages]);
            setHeadId(acc.headId);
          }
        }
        return;
      } else if (e.type === 'observer-message') {
        applyObserverMessage(acc, e.text ?? '');
      } else if (e.type === 'tool-call') {
        if (!e.toolCallId) return;
        applyToolCall(acc, {
          toolCallId: e.toolCallId,
          toolName: e.toolName ?? 'unknown',
          args: e.args,
          startedAt: e.startedAt,
        });
      } else if (e.type === 'tool-result') {
        applyToolResult(acc, {
          toolCallId: e.toolCallId,
          toolName: e.toolName,
          result: e.result,
          startedAt: e.startedAt,
          finishedAt: e.finishedAt,
          compaction: e.compaction,
        });
      } else if (e.type === 'tool-progress') {
        const toolProgressData = e.data as {
          type?: string;
          stream?: 'stdout' | 'stderr';
          output?: string;
          truncated?: boolean;
          stopped?: boolean;
          content?: string;
          duration_ms?: number;
        } | undefined;
        if (toolProgressData?.type === 'extraction_start' || toolProgressData?.type === 'extraction_complete') {
          applyToolCompaction(acc, {
            toolCallId: e.toolCallId,
            toolName: e.toolName,
            data: {
              phase: toolProgressData.type === 'extraction_start' ? 'start' : 'complete',
              originalContent: toolProgressData.type === 'extraction_start' ? toolProgressData.content : undefined,
              extractionDurationMs: toolProgressData.duration_ms,
            },
          });
        } else {
          applyToolProgress(acc, {
            toolCallId: e.toolCallId,
            toolName: e.toolName,
            data: toolProgressData,
          });
        }
      } else if (e.type === 'tool-compaction') {
        applyToolCompaction(acc, {
          toolCallId: e.toolCallId,
          toolName: e.toolName,
          data: e.data as {
            phase?: 'start' | 'complete' | 'error' | null;
            originalContent?: string;
            extractionDurationMs?: number;
          } | undefined,
        });
      } else if (e.type === 'enrichment') {
        const enrichData = e.data as Record<string, unknown> | undefined;
        if (enrichData) applyEnrichments(acc, enrichData);
      } else if (e.type === 'context-usage') {
        const usageData = e.data as {
          inputTokens?: number;
          outputTokens?: number;
          cacheReadTokens?: number;
          cacheWriteTokens?: number;
          totalTokens?: number;
        } | undefined;
        if (usageData?.inputTokens !== undefined || usageData?.outputTokens !== undefined) {
          applyTokenUsage(acc, {
            inputTokens: usageData.inputTokens ?? 0,
            outputTokens: usageData.outputTokens ?? 0,
            cacheReadTokens: usageData.cacheReadTokens ?? 0,
            cacheWriteTokens: usageData.cacheWriteTokens ?? 0,
            totalTokens: usageData.totalTokens ?? (usageData.inputTokens ?? 0) + (usageData.outputTokens ?? 0),
          });
        }
      } else if (e.type === 'model-fallback') {
        const fbData = e.data as {
          fromModel: string;
          toModel: string;
          toModelKey?: string;
          error: string;
          reason?: string;
          discardPartialAssistant?: boolean;
        } | undefined;
        if (fbData?.discardPartialAssistant) {
          discardTrailingAssistant(acc);
        }
        if (fbData && isActiveConv) {
          setFallbackBanner({
            fromModel: fbData.fromModel,
            toModel: fbData.toModel,
            error: fbData.error,
            reason: fbData.reason,
          });
          if (fallbackBannerTimerRef.current) clearTimeout(fallbackBannerTimerRef.current);
          fallbackBannerTimerRef.current = setTimeout(() => setFallbackBanner(null), 8000);
          // Update model selector to show the fallback model
          if (fbData.toModelKey) {
            onModelFallbackRef.current?.(fbData.toModelKey);
          }
        }
      } else if (e.type === 'error') {
        if (persistTimerRef.current) { clearTimeout(persistTimerRef.current); persistTimerRef.current = null; }
        streamAccumulators.delete(convId);
        persistConversation(convId, acc.messages, acc.headId, {
          runStatus: 'idle', lastAssistantUpdateAt: nowIso(), hasUnread: !isActiveConv,
        });
        if (isActiveConv) {
          setIsRunning(false);
          setTree([...acc.messages]);
          setHeadId(acc.headId);
        }
        return;
      } else if (e.type === 'done') {
        if (persistTimerRef.current) { clearTimeout(persistTimerRef.current); persistTimerRef.current = null; }
        streamAccumulators.delete(convId);
        persistConversation(convId, acc.messages, acc.headId, {
          runStatus: 'idle', lastAssistantUpdateAt: nowIso(), hasUnread: !isActiveConv,
        });
        if (isActiveConv) {
          setIsRunning(false);
          setTree([...acc.messages]);
          setHeadId(acc.headId);
        }
        return;
      }

      if (isActiveConv) {
        setTree([...acc.messages]);
        setHeadId(acc.headId);
      }
      streamHandlerRef.current.schedulePersist(convId, acc.messages, acc.headId, { runStatus: 'running' });
    });
    return unsubscribe;
  }, [bumpSubAgentVersion]);

  const onNew = useCallback(async (message: AppendMessage) => {
    const convId = activeIdRef.current;
    if (!convId) return;

    const pendingAttachments = consumeAttachments();
    const userContent: ContentPart[] = [];
    for (const part of message.content) {
      if (part.type === 'text') userContent.push({ type: 'text', text: part.text });
      else if (part.type === 'image') userContent.push({ type: 'image', image: (part as { image: string }).image });
    }
    for (const att of pendingAttachments) {
      if (att.isImage) {
        userContent.push({ type: 'image', image: att.dataUrl });
      } else if (att.text) {
        userContent.push({ type: 'file', data: att.dataUrl, mimeType: att.mime, filename: att.name });
        userContent.push({ type: 'text', text: `\n\n--- File: ${att.name} ---\n${att.text}\n--- End File ---\n` });
      } else {
        userContent.push({ type: 'file', data: att.dataUrl, mimeType: att.mime, filename: att.name });
        userContent.push({ type: 'text', text: `\n[Attached file: ${att.name} (${att.mime}, ${(att.size / 1024).toFixed(1)} KB)]` });
      }
    }
    if (!userContent.some((p) => p.type === 'text')) return;

    const userMsg: StoredMessage = { id: msgId(), parentId: headId, role: 'user', content: toStoredContent(userContent), createdAt: new Date() };
    const newTree = [...tree, userMsg];
    const newHead = userMsg.id;
    setTree(newTree);
    setHeadId(newHead);
    setIsRunning(true);

    streamAccumulators.set(convId, { messages: [...newTree], headId: newHead });
    const branch = getActiveBranch(newTree, newHead);
    await persistConversation(convId, newTree, newHead, { runStatus: 'running' });
    void maybeGenerateTitle(convId, branch);
    console.info(`[UI:stream] Firing agent:stream conv=${convId} model=${selectedModelKey ?? 'default'} reasoning=${reasoningEffort ?? 'medium'} messageCount=${branch.length} roles=${branch.map((m) => m.role).join(',')}`);
    console.info('[UI:stream] Last message preview:', branch.length > 0 ? JSON.stringify(branch[branch.length - 1]).slice(0, 500) : '(empty)');
    app.agent.stream(convId, branch, selectedModelKey ?? undefined, reasoningEffort ?? 'medium', selectedProfileKey ?? undefined, fallbackEnabled ?? false);
  }, [tree, headId, selectedModelKey, reasoningEffort, selectedProfileKey, fallbackEnabled, consumeAttachments]);

  const onReload = useCallback(async (parentId: string | null) => {
    const convId = activeIdRef.current;
    if (!convId) return;

    // parentId is the message ID to regenerate from (the user message before the assistant response)
    // We keep the old assistant branch (it becomes an alternate sibling) and start a new one
    const reloadParentId = parentId ?? headId;
    if (!reloadParentId) return;

    // Find the parent message — if it's an assistant message, go to its parent (the user message)
    const parentMsg = tree.find((m) => m.id === reloadParentId);
    const actualParent = parentMsg?.role === 'assistant' ? parentMsg.parentId : reloadParentId;

    // Clear retitle dedup so the regenerated response can trigger a title update
    lastRetitleCount.delete(convId);

    setHeadId(actualParent);
    setIsRunning(true);

    const newTree = [...tree]; // keep all existing messages (old branches preserved)
    streamAccumulators.set(convId, { messages: newTree, headId: actualParent });
    const branch = getActiveBranch(newTree, actualParent);
    persistConversation(convId, newTree, actualParent, { runStatus: 'running' });
    console.info(`[UI:stream:reload] Firing agent:stream conv=${convId} model=${selectedModelKey ?? 'default'} reasoning=${reasoningEffort ?? 'medium'} messageCount=${branch.length} roles=${branch.map((m) => m.role).join(',')}`);
    app.agent.stream(convId, branch, selectedModelKey ?? undefined, reasoningEffort ?? 'medium', selectedProfileKey ?? undefined, fallbackEnabled ?? false);
  }, [tree, headId, selectedModelKey, reasoningEffort, selectedProfileKey, fallbackEnabled]);

  const onCancel = useCallback(async () => {
    const convId = activeIdRef.current;
    if (!convId) return;

    // Use refs to get the latest tree/headId (not stale closure values)
    const currentTree = treeRef.current;
    const currentHeadId = headIdRef.current;

    // Clean up accumulator first — use its state if it has more recent data
    const acc = streamAccumulators.get(convId);
    streamAccumulators.delete(convId);
    const latestTree = acc ? acc.messages : currentTree;
    const latestHead = acc ? acc.headId : currentHeadId;

    // If the head is a user message, no assistant response was created yet.
    // Insert a placeholder so the cancelled state is visible with a retry button.
    const headMsg = latestTree.find((m) => m.id === latestHead);
    if (headMsg?.role === 'user') {
      const cancelledMsg: StoredMessage = {
        id: msgId(),
        parentId: latestHead,
        role: 'assistant',
        content: [],
        createdAt: new Date(),
      };
      const newTree = [...latestTree, cancelledMsg];
      const newHead = cancelledMsg.id;
      setTree(newTree);
      setHeadId(newHead);
      setIsRunning(false);
      try { await app.agent.cancelStream(convId); } catch { /* ignore */ }
      persistConversation(convId, newTree, newHead, { runStatus: 'idle' });
      return;
    }

    // Head is already an assistant message — preserve whatever content it has
    setTree([...latestTree]);
    setHeadId(latestHead);
    setIsRunning(false);
    try {
      await app.agent.cancelStream(convId);
    } catch (err) {
      console.error('[Runtime] Cancel failed:', err);
    }
    persistConversation(convId, latestTree, latestHead, { runStatus: 'idle' });
  }, []);

  // Branch navigation
  const goToBranch = useCallback((siblingId: string) => {
    // Walk from this sibling down to the deepest descendant on the "latest" path
    let newHead = siblingId;
    // Find the deepest child chain from this sibling
    const childrenOf = (parentId: string) => tree.filter((m) => m.parentId === parentId);
    let children = childrenOf(newHead);
    while (children.length > 0) {
      newHead = children[children.length - 1].id; // take last child (most recent)
      children = childrenOf(newHead);
    }
    setHeadId(newHead);
    // Persist
    const convId = activeIdRef.current;
    if (convId) persistConversation(convId, tree, newHead);
  }, [tree]);

  const goToPreviousBranch = useCallback(() => {
    if (!branchInfo || branchInfo.currentIdx <= 0) return;
    goToBranch(branchInfo.siblings[branchInfo.currentIdx - 1].id);
  }, [branchInfo, goToBranch]);

  const goToNextBranch = useCallback(() => {
    if (!branchInfo || branchInfo.currentIdx >= branchInfo.total - 1) return;
    goToBranch(branchInfo.siblings[branchInfo.currentIdx + 1].id);
  }, [branchInfo, goToBranch]);

  const branchNav: BranchNav | null = branchInfo && branchInfo.total > 1
    ? { total: branchInfo.total, current: branchInfo.currentIdx + 1, goToPrevious: goToPreviousBranch, goToNext: goToNextBranch }
    : null;

  // Sub-agent actions
  const sendSubAgentMessage = useCallback(async (subAgentConversationId: string, text: string) => {
    // For RUNNING sub-agents (accumulator exists): add locally for instant UI display.
    // The backend won't broadcast a sub-agent-user-message event for queue-sourced follow-ups.
    // For COMPLETED sub-agents (no accumulator): DON'T add locally.
    // The backend's resumeSubAgent will broadcast a sub-agent-user-message event.
    const saAcc = globalSubAgentAccumulators.get(subAgentConversationId);
    if (saAcc) {
      const userMsg: StoredMessage = {
        id: msgId(),
        parentId: saAcc.headId,
        role: 'user',
        content: toStoredContent([{ type: 'text', text }]),
        createdAt: new Date(),
      };
      saAcc.messages.push(userMsg);
      saAcc.headId = userMsg.id;
      const existing = globalSubAgentThreads.get(subAgentConversationId);
      if (existing) {
        globalSubAgentThreads.set(subAgentConversationId, { ...existing, messages: [...saAcc.messages], headId: saAcc.headId });
      }
      bumpSubAgentVersion();
    }
    try { await app.agent.sendSubAgentMessage(subAgentConversationId, text); } catch (err) { console.error('[Runtime] Sub-agent message failed:', err); }
  }, [bumpSubAgentVersion]);

  const stopSubAgentAction = useCallback(async (subAgentConversationId: string) => {
    try {
      await app.agent.stopSubAgent(subAgentConversationId);
      const existing = globalSubAgentThreads.get(subAgentConversationId);
      if (existing) {
        globalSubAgentThreads.set(subAgentConversationId, { ...existing, status: 'stopped' });
      }
      bumpSubAgentVersion();
    } catch (err) { console.error('[Runtime] Sub-agent stop failed:', err); }
  }, [bumpSubAgentVersion]);

  const deleteSubAgentThread = useCallback((subAgentConversationId: string) => {
    globalSubAgentThreads.delete(subAgentConversationId);
    globalSubAgentAccumulators.delete(subAgentConversationId);
    if (activeSubAgentView === subAgentConversationId) setActiveSubAgentView(null);
    bumpSubAgentVersion();
  }, [bumpSubAgentVersion, activeSubAgentView]);

  const navigateToSubAgent = useCallback((subAgentConversationId: string) => {
    setActiveSubAgentView(subAgentConversationId);
  }, []);

  const subAgentActions = useMemo<SubAgentActions>(() => ({
    threads: subAgentThreads,
    sendMessage: sendSubAgentMessage,
    stop: stopSubAgentAction,
    deleteThread: deleteSubAgentThread,
    navigateTo: navigateToSubAgent,
    activeSubAgentView,
    setActiveSubAgentView,
  }), [subAgentThreads, sendSubAgentMessage, stopSubAgentAction, deleteSubAgentThread, navigateToSubAgent, activeSubAgentView]);

  const runtime = useExternalStoreRuntime({
    messages: activeBranch,
    setMessages: () => {},
    onNew,
    onReload,
    onCancel,
    convertMessage: (m: ThreadMessageLike) => m,
    isRunning,
    adapters: {
      ...(speechAdapter ? { speech: speechAdapter } : {}),
      ...(dictationAdapter ? { dictation: dictationAdapter } : {}),
    },
  });

  const dismissFallbackBanner = useCallback(() => {
    setFallbackBanner(null);
    if (fallbackBannerTimerRef.current) {
      clearTimeout(fallbackBannerTimerRef.current);
      fallbackBannerTimerRef.current = null;
    }
  }, []);

  const fallbackBannerActions = useMemo<FallbackBannerActions>(() => ({
    banner: fallbackBanner,
    dismiss: dismissFallbackBanner,
  }), [fallbackBanner, dismissFallbackBanner]);

  return (
    <FallbackBannerContext.Provider value={fallbackBannerActions}>
      <SubAgentContext.Provider value={subAgentActions}>
        <BranchNavContext.Provider value={branchNav}>
          <AssistantRuntimeProvider runtime={runtime}>
            {children}
          </AssistantRuntimeProvider>
        </BranchNavContext.Provider>
      </SubAgentContext.Provider>
    </FallbackBannerContext.Provider>
  );
}
