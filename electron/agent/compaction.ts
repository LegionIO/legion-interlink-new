import { randomUUID } from 'crypto';
import {
  countSerializedTokens,
  resolveConversationTokenization,
  serializeForTokenCounting,
} from './tokenization.js';
import type { ConversationTokenizationInfo } from './tokenization.js';
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

  // Generate summary
  const { Agent } = await import('@mastra/core/agent');
  const model = await createLanguageModelFromConfig(modelConfig);
  const agent = new Agent({
    id: `compaction-${Date.now()}`,
    name: 'compaction-agent',
    instructions: COMPACTION_SYSTEM_PROMPT,
    model: model as any,
  });

  const prompt = [
    'Summarize the conversation prefix for future continuation.',
    'Keep durable constraints, decisions, requirements, unresolved TODOs, IDs, names, and references.',
    '',
    'Conversation prefix (JSON):',
    serializeForTokenCounting(prefix),
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
