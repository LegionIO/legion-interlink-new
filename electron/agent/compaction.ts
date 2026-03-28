import { randomUUID } from 'crypto';
import {
  countSerializedTokens,
  resolveConversationTokenization,
  serializeForTokenCounting,
} from './tokenization.js';
import type { LLMModelConfig } from './model-catalog.js';
import { createLanguageModelFromConfig } from './language-model.js';

export type ChatMessage = {
  id?: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | unknown[];
  tool_calls?: Array<{ id: string; [key: string]: unknown }>;
  tool_call_id?: string;
};

const COMPACTION_SYSTEM_PROMPT = [
  'You compact prior chat history for continuation.',
  'Summarize only durable, high-value context needed for future turns.',
  'Preserve facts, constraints, decisions, unresolved questions, and identifiers.',
  'Do not invent details.',
  'Return plain text only.',
].join(' ');

function extractToolCallIds(message: ChatMessage): Set<string> {
  const ids = new Set<string>();
  for (const tc of message.tool_calls ?? []) {
    if (tc.id) ids.add(tc.id);
  }
  if (Array.isArray(message.content)) {
    for (const part of message.content as Array<{ type?: string; toolCallId?: string }>) {
      if (part.type === 'tool-call' && part.toolCallId) ids.add(part.toolCallId);
      if (part.type === 'tool-result' && part.toolCallId) ids.add(part.toolCallId);
    }
  }
  return ids;
}

export function selectProtectedTail(
  messages: ChatMessage[],
  ignoreRecentUser: number,
  ignoreRecentAssistant: number,
): { boundaryIndex: number; protectedIds: Set<number>; protectedToolCallIds: Set<string> } {
  const protectedIds = new Set<number>();
  const protectedToolCallIds = new Set<string>();
  let remainingUsers = Math.max(0, ignoreRecentUser);
  let remainingAssistants = Math.max(0, ignoreRecentAssistant);

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === 'user' && remainingUsers > 0) {
      protectedIds.add(i);
      remainingUsers--;
    } else if (msg.role === 'assistant' && remainingAssistants > 0) {
      protectedIds.add(i);
      remainingAssistants--;
      for (const id of extractToolCallIds(msg)) protectedToolCallIds.add(id);
    } else if (remainingUsers <= 0 && remainingAssistants <= 0) break;
  }

  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === 'tool' && messages[i].tool_call_id && protectedToolCallIds.has(messages[i].tool_call_id!)) {
      protectedIds.add(i);
    }
  }

  const boundaryIndex = protectedIds.size > 0 ? Math.min(...protectedIds) : messages.length;
  return { boundaryIndex, protectedIds, protectedToolCallIds };
}

export function shouldCompact(
  messages: ChatMessage[],
  modelName: string,
  triggerPercent: number,
  contextWindowOverride?: number,
): { shouldCompact: boolean; usedTokens: number; contextWindowTokens: number } {
  const tokenization = resolveConversationTokenization(modelName, contextWindowOverride);
  if (!tokenization.encoding || !tokenization.contextWindowTokens) {
    return { shouldCompact: false, usedTokens: 0, contextWindowTokens: 0 };
  }
  const usedTokens = countSerializedTokens(messages, tokenization) ?? 0;
  const triggerTokens = Math.floor(tokenization.contextWindowTokens * triggerPercent);
  return {
    shouldCompact: usedTokens >= triggerTokens,
    usedTokens,
    contextWindowTokens: tokenization.contextWindowTokens,
  };
}

export type CompactionResult = {
  compactedMessages: ChatMessage[] | null;
  summaryText: string | null;
  compactionId: string | null;
  compactedMessageIds: string[];
};

export async function compactConversationPrefix(
  messages: ChatMessage[],
  modelConfig: LLMModelConfig,
  config: {
    triggerPercent: number;
    ignoreRecentUserMessages: number;
    ignoreRecentAssistantMessages: number;
    outputMaxTokens: number;
    promptReserveTokens: number;
    contextWindowTokens?: number;
  },
): Promise<CompactionResult> {
  const tokenization = resolveConversationTokenization(
    modelConfig.modelName,
    config.contextWindowTokens ?? modelConfig.maxInputTokens,
  );

  if (!tokenization.encoding || !tokenization.contextWindowTokens) {
    return { compactedMessages: null, summaryText: null, compactionId: null, compactedMessageIds: [] };
  }

  const { boundaryIndex } = selectProtectedTail(
    messages,
    config.ignoreRecentUserMessages,
    config.ignoreRecentAssistantMessages,
  );

  const prefix = messages.slice(0, boundaryIndex);
  const suffix = messages.slice(boundaryIndex);
  if (prefix.length === 0) {
    return { compactedMessages: null, summaryText: null, compactionId: null, compactedMessageIds: [] };
  }

  // Budget the compaction prompt input to avoid exceeding the context window.
  // Mirrors maelstrom-agent: contextWindow - outputMaxTokens - promptReserveTokens
  const promptInputBudget = Math.floor(
    tokenization.contextWindowTokens
      - Math.max(0, config.outputMaxTokens)
      - Math.max(0, config.promptReserveTokens),
  );
  if (promptInputBudget <= 0) {
    return { compactedMessages: null, summaryText: null, compactionId: null, compactedMessageIds: [] };
  }

  // Fit prefix to the input budget by dropping oldest messages until it fits
  const fittedPrefix = [...prefix];
  while (fittedPrefix.length > 0) {
    const candidatePromptText = serializeForTokenCounting(fittedPrefix);
    const candidateTokens = tokenization.encoding.encode(candidatePromptText).length;
    if (candidateTokens <= promptInputBudget) break;
    fittedPrefix.shift();
  }

  if (fittedPrefix.length === 0) {
    return { compactedMessages: null, summaryText: null, compactionId: null, compactedMessageIds: [] };
  }

  // Generate summary
  const { Agent } = await import('@mastra/core/agent');
  const model = await createLanguageModelFromConfig(modelConfig);
  type AgentConfig = ConstructorParameters<typeof Agent>[0];
  const agent = new Agent({
    id: `compaction-${Date.now()}`,
    name: 'compaction-agent',
    instructions: COMPACTION_SYSTEM_PROMPT,
    model: model as AgentConfig['model'],
  });

  const prompt = [
    'Summarize the conversation prefix for future continuation.',
    'Keep durable constraints, decisions, requirements, unresolved TODOs, IDs, names, and references.',
    '',
    'Conversation prefix (JSON):',
    serializeForTokenCounting(fittedPrefix),
  ].join('\n');

  const result = await agent.generate(prompt, { maxSteps: 1 });
  const summaryText = typeof result.text === 'string' ? result.text.trim() : null;
  if (!summaryText) {
    return { compactedMessages: null, summaryText: null, compactionId: null, compactedMessageIds: [] };
  }

  const compactionId = randomUUID();
  const summaryMessage: ChatMessage = {
    id: `compaction-summary-${compactionId}`,
    role: 'assistant',
    content: summaryText,
  };

  const compactedMessageIds = prefix
    .map((m) => m.id)
    .filter((id): id is string => typeof id === 'string');

  return {
    compactedMessages: [summaryMessage, ...suffix],
    summaryText,
    compactionId,
    compactedMessageIds,
  };
}

/* ── Tool Result Compaction ── */
/* Ported from maelstrom-agent/packages/agent-sdk/src/core/tool-extraction.ts */

export type ToolCompactionConfig = {
  enabled: boolean;
  useAI: boolean;
  triggerTokens: number;
  outputMaxTokens: number;
  truncateMinChars: number;
  truncateHeadRatio: number;
  truncateMinTailChars: number;
};

export type ToolCompactionResult = {
  content: string;
  wasCompacted: boolean;
  extractionDurationMs?: number;
};

/**
 * Estimate token count from a string. Uses the model-aware tokenizer when
 * available, otherwise falls back to a rough chars/4 heuristic.
 */
export function estimateToolTokens(text: string, modelName?: string): number {
  if (modelName) {
    const tokenization = resolveConversationTokenization(modelName);
    if (tokenization.encoding) {
      return tokenization.encoding.encode(text).length;
    }
  }
  return Math.ceil(text.length / 4);
}

/**
 * Truncate content to fit within a token budget using head/tail ratio.
 * Mirrors maelstrom's truncateToTokenBudget.
 */
function truncateToTokenBudget(
  content: string,
  maxTokens: number,
  options: { minChars: number; headRatio: number; minTailChars: number },
  modelName?: string,
): string {
  if (!content) return content;
  const totalTokens = estimateToolTokens(content, modelName);
  if (totalTokens <= maxTokens) return content;

  const ratio = Math.max(0.05, maxTokens / totalTokens);
  const keepChars = Math.max(options.minChars, Math.floor(content.length * ratio));
  const headChars = Math.floor(keepChars * options.headRatio);
  const tailChars = Math.max(options.minTailChars, keepChars - headChars);

  return [
    content.slice(0, headChars),
    '\n\n...[tool output truncated for size]...\n\n',
    content.slice(-tailChars),
  ].join('');
}

/**
 * Use an AI model to extract relevant information from a large tool result.
 */
async function aiExtractRelevantInfo(
  content: string,
  toolName: string,
  userQuery: string,
  maxOutputTokens: number,
  modelConfig: LLMModelConfig,
): Promise<string | null> {
  try {
    const { Agent } = await import('@mastra/core/agent');
    const model = await createLanguageModelFromConfig(modelConfig);
    type AgentConfig = ConstructorParameters<typeof Agent>[0];
    const agent = new Agent({
      id: `tool-compact-${Date.now()}`,
      name: 'tool-compaction-agent',
      instructions: 'Summarize only the information needed to answer the user request. Keep important IDs, names, and values. Omit boilerplate and repeated metadata. If output is JSON-like, preserve key fields in compact form.',
      model: model as AgentConfig['model'],
    });

    const prompt = [
      `User request: ${userQuery || '(none provided)'}`,
      `Tool: ${toolName}`,
      '',
      'Tool output:',
      content,
    ].join('\n');

    const result = await agent.generate(prompt, { maxSteps: 1 });
    return typeof result.text === 'string' ? result.text.trim() || null : null;
  } catch {
    return null;
  }
}

/**
 * Compact a tool result if it exceeds the configured token threshold.
 *
 * Strategy (matching maelstrom):
 *  1. If disabled or under triggerTokens, return as-is
 *  2. If useAI, try AI extraction → then bound to outputMaxTokens via truncation
 *  3. Fallback: head/tail truncation to outputMaxTokens
 */
export async function compactToolResult(
  content: string,
  toolName: string,
  userQuery: string,
  settings: ToolCompactionConfig,
  modelConfig?: LLMModelConfig,
  modelName?: string,
): Promise<ToolCompactionResult> {
  const started = Date.now();

  if (!settings.enabled) {
    return { content, wasCompacted: false };
  }

  if (estimateToolTokens(content, modelName) <= settings.triggerTokens) {
    return { content, wasCompacted: false };
  }

  const truncateOpts = {
    minChars: settings.truncateMinChars,
    headRatio: settings.truncateHeadRatio,
    minTailChars: settings.truncateMinTailChars,
  };

  // Try AI extraction first
  if (settings.useAI && modelConfig) {
    const extracted = await aiExtractRelevantInfo(
      content,
      toolName,
      userQuery,
      settings.outputMaxTokens,
      modelConfig,
    );
    if (extracted) {
      // Bound AI output to outputMaxTokens in case the model went over
      const bounded = truncateToTokenBudget(extracted, settings.outputMaxTokens, truncateOpts, modelName);
      return {
        content: bounded,
        wasCompacted: bounded !== content,
        extractionDurationMs: Date.now() - started,
      };
    }
  }

  // Fallback: head/tail truncation
  const fallback = truncateToTokenBudget(content, settings.outputMaxTokens, truncateOpts, modelName);
  return {
    content: fallback,
    wasCompacted: fallback !== content,
    extractionDurationMs: Date.now() - started,
  };
}
