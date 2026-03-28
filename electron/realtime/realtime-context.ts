/**
 * Realtime Memory Context Builder
 *
 * Gathers conversation memory (working memory, message history, observational memory,
 * semantic recall) from Mastra Memory and assembles it into a text block to inject
 * into the OpenAI Realtime API session instructions.
 *
 * The assembled context stays within a configurable token budget so the realtime
 * model's 32k context window isn't exhausted by memory alone.
 */

import type { LegionConfig } from '../config/schema.js';
import { getSharedMemory, getResourceId } from '../agent/memory.js';

/* ── Token estimation ── */

/** Rough chars-to-tokens ratio (conservative — 1 token ~ 4 chars for English) */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Truncate text to fit within a token budget, cutting from the start (oldest content). */
function truncateToTokenBudget(text: string, maxTokens: number): string {
  const estimated = estimateTokens(text);
  if (estimated <= maxTokens) return text;

  // Cut from the beginning (oldest content goes first)
  const maxChars = maxTokens * 4;
  const truncated = text.slice(-maxChars);

  // Try to break at a newline to avoid cutting mid-sentence
  const firstNewline = truncated.indexOf('\n');
  if (firstNewline > 0 && firstNewline < 200) {
    return '...\n' + truncated.slice(firstNewline + 1);
  }
  return '...' + truncated;
}

/* ── Message formatting ── */

function extractTextFromContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  return content
    .map((part: unknown) => {
      if (!part || typeof part !== 'object') return '';
      const typed = part as { type?: string; text?: string };
      if (typed.type === 'text' && typed.text) return typed.text;
      return '';
    })
    .filter(Boolean)
    .join(' ')
    .trim();
}

function formatMessagesAsConversation(
  messages: Array<{ role?: string; content?: unknown }>,
): string {
  return messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => {
      const text = extractTextFromContent(m.content);
      if (!text) return null;
      const role = m.role === 'user' ? 'User' : 'Assistant';
      // Keep each message reasonably short for context
      const trimmed = text.length > 500 ? text.slice(0, 500) + '...' : text;
      return `${role}: ${trimmed}`;
    })
    .filter(Boolean)
    .join('\n');
}

/* ── Main builder ── */

const CALL_INSTRUCTIONS = `## Call Instructions
You are receiving a phone call. Start the conversation by naturally answering the call with a brief greeting, as if picking up a ringing phone. Vary your greeting naturally. If you have conversation context above, you may reference it naturally in your greeting (e.g., "Hey! Were you wanting to continue talking about...?"). Keep your greeting brief and warm.`;

type ConversationMessage = {
  role?: string;
  content?: unknown;
};

type SemanticRecallThreadConfig = {
  lastMessages: false;
  semanticRecall: {
    topK: number;
    messageRange: { before: number; after: number };
  };
};

export async function buildRealtimeMemoryContext(
  conversationId: string,
  config: LegionConfig,
  dbPath: string,
): Promise<string> {
  const memoryConfig = config.realtime.memoryContext;
  if (!memoryConfig?.enabled) {
    console.info('[RealtimeContext] Memory context disabled in config');
    return CALL_INSTRUCTIONS;
  }

  console.info(`[RealtimeContext] Building context for conversation=${conversationId}, dbPath=${dbPath}`);
  console.info(`[RealtimeContext] Config: maxTokens=${memoryConfig.maxTokens}, convoHistory=${memoryConfig.conversationHistory.enabled}, workingMem=${memoryConfig.workingMemory.enabled}, obs=${memoryConfig.observationalMemory.enabled}, semantic=${memoryConfig.semanticRecall.enabled}`);

  const maxTokens = memoryConfig.maxTokens || 8000;
  const memory = getSharedMemory(config, dbPath);

  if (!memory) {
    console.info('[RealtimeContext] Memory not initialized (getSharedMemory returned null) — using call instructions only');
    return CALL_INSTRUCTIONS;
  }

  console.info('[RealtimeContext] Memory instance obtained successfully');
  const resourceId = getResourceId();
  console.info(`[RealtimeContext] Using resourceId=${resourceId}`);
  const sections: Array<{ label: string; content: string; priority: number }> = [];

  // ── 1. Working Memory (highest priority) ──
  if (memoryConfig.workingMemory.enabled) {
    try {
      console.info('[RealtimeContext] Fetching working memory...');
      const workingMemory = await memory.getWorkingMemory({
        threadId: conversationId,
        resourceId,
      });
      console.info(`[RealtimeContext] Working memory result: ${workingMemory ? workingMemory.length + ' chars' : 'null/empty'}`);
      if (workingMemory && workingMemory.trim()) {
        sections.push({
          label: '## Working Memory',
          content: workingMemory.trim(),
          priority: 1,
        });
      }
    } catch (err) {
      console.warn('[RealtimeContext] Failed to get working memory:', err);
    }
  }

  // ── 2. Conversation History ──
  if (memoryConfig.conversationHistory.enabled) {
    try {
      const maxMessages = memoryConfig.conversationHistory.maxMessages || 20;
      console.info(`[RealtimeContext] Fetching conversation history (max ${maxMessages} messages)...`);

      // First try to get the thread to verify it exists in Mastra storage
      const thread = await memory.getThreadById({ threadId: conversationId });
      console.info(`[RealtimeContext] Thread lookup: ${thread ? `found (title="${thread.title}")` : 'NOT FOUND'}`);

      if (thread) {
        const result = await memory.recall({
          threadId: conversationId,
          resourceId,
          perPage: maxMessages,
        });

        console.info(`[RealtimeContext] Recall returned ${result.messages?.length ?? 0} messages (total=${result.total})`);

        if (result.messages && result.messages.length > 0) {
          // Log first few message roles for debugging
          const preview = result.messages
            .slice(0, 5)
            .map((message) => {
              const typedMessage = message as ConversationMessage;
              const contentPreview = typeof typedMessage.content === 'string'
                ? typedMessage.content.slice(0, 50)
                : JSON.stringify(typedMessage.content).slice(0, 50);
              return `${typedMessage.role}:${contentPreview}`;
            });
          console.info(`[RealtimeContext] Message preview: ${JSON.stringify(preview)}`);

          const formatted = formatMessagesAsConversation(
            result.messages as Array<{ role?: string; content?: unknown }>,
          );
          console.info(`[RealtimeContext] Formatted conversation: ${formatted ? formatted.length + ' chars' : 'empty'}`);
          if (formatted) {
            sections.push({
              label: '## Recent Conversation',
              content: formatted,
              priority: 2,
            });
          }
        }
      } else {
        // Thread not in Mastra storage — try reading from conversations.json directly
        console.info('[RealtimeContext] Thread not found in Mastra storage — falling back to conversations store');
        try {
          const { readFileSync, existsSync } = await import('fs');
          const { join, dirname } = await import('path');
          const convStorePath = join(dirname(dbPath), 'conversations.json');
          if (existsSync(convStorePath)) {
            const store = JSON.parse(readFileSync(convStorePath, 'utf-8')) as {
              conversations?: Record<string, { messages?: Array<{ role?: string; content?: unknown }> }>;
            };
            const convo = store.conversations?.[conversationId];
            if (convo?.messages && convo.messages.length > 0) {
              console.info(`[RealtimeContext] Found ${convo.messages.length} messages in conversations.json`);
              const recentMessages = convo.messages.slice(-maxMessages);
              const formatted = formatMessagesAsConversation(recentMessages);
              console.info(`[RealtimeContext] Formatted from conversations.json: ${formatted ? formatted.length + ' chars' : 'empty'}`);
              if (formatted) {
                sections.push({
                  label: '## Recent Conversation',
                  content: formatted,
                  priority: 2,
                });
              }
            } else {
              console.info(`[RealtimeContext] Conversation "${conversationId}" not found or empty in conversations.json`);
            }
          } else {
            console.info(`[RealtimeContext] conversations.json not found at ${convStorePath}`);
          }
        } catch (fallbackErr) {
          console.warn('[RealtimeContext] Fallback conversation read failed:', fallbackErr);
        }
      }
    } catch (err) {
      console.warn('[RealtimeContext] Failed to get conversation history:', err);
    }
  }

  // ── 3. Observational Memory ──
  if (memoryConfig.observationalMemory.enabled) {
    try {
      console.info('[RealtimeContext] Fetching observational memory...');
      // Access observational memory through the storage layer
      const storageAccess = memory as unknown as {
        storage?: {
          getStore(name: string): Promise<{
            getObservationalMemory(
              threadId: string | null,
              resourceId: string,
            ): Promise<{ activeObservations?: string } | null>;
          }>;
        };
      };

      if (storageAccess.storage) {
        const store = await storageAccess.storage.getStore('memory');
        console.info(`[RealtimeContext] Got memory store, calling getObservationalMemory(null, "${resourceId}")...`);
        const obsRecord = await store.getObservationalMemory(null, resourceId);
        console.info(`[RealtimeContext] Observational memory: ${obsRecord?.activeObservations ? obsRecord.activeObservations.length + ' chars' : 'null/empty'}`);
        if (obsRecord?.activeObservations?.trim()) {
          sections.push({
            label: '## Long-term Memory (Observations)',
            content: obsRecord.activeObservations.trim(),
            priority: 3,
          });
        }
      } else {
        console.info('[RealtimeContext] No storage accessor found on memory instance');
      }
    } catch (err) {
      console.warn('[RealtimeContext] Failed to get observational memory:', err);
    }
  }

  // ── 4. Semantic Recall (lowest priority — uses conversation summary as search) ──
  if (memoryConfig.semanticRecall.enabled) {
    try {
      // Build a search string from the recent conversation context
      const existingConvoSection = sections.find((s) => s.priority === 2);
      const searchString = existingConvoSection
        ? existingConvoSection.content.slice(-1000) // Use last ~1000 chars as search query
        : '';

      if (searchString) {
        const topK = memoryConfig.semanticRecall.topK || 3;
        const threadConfig: SemanticRecallThreadConfig = {
          lastMessages: false,
          semanticRecall: {
            topK,
            messageRange: { before: 1, after: 1 },
          },
        };
        const result = await memory.recall({
          threadId: conversationId,
          resourceId,
          vectorSearchString: searchString,
          threadConfig,
        });

        if (result.messages && result.messages.length > 0) {
          const formatted = formatMessagesAsConversation(
            result.messages as Array<{ role?: string; content?: unknown }>,
          );
          if (formatted) {
            sections.push({
              label: '## Related Context (from earlier conversations)',
              content: formatted,
              priority: 4,
            });
          }
        }
      }
    } catch (err) {
      console.warn('[RealtimeContext] Failed to get semantic recall:', err);
    }
  }

  // ── Assemble with token budgeting ──
  if (sections.length === 0) {
    return CALL_INSTRUCTIONS;
  }

  // Sort by priority (lowest number = highest priority)
  sections.sort((a, b) => a.priority - b.priority);

  // Reserve tokens for the call instructions and header
  const callInstructionTokens = estimateTokens(CALL_INSTRUCTIONS) + 50; // +50 for header
  let remainingTokens = maxTokens - callInstructionTokens;

  const assembledParts: string[] = ['--- Conversation Context ---', ''];

  for (const section of sections) {
    const sectionTokens = estimateTokens(section.label + '\n' + section.content);

    if (remainingTokens <= 0) {
      console.info(`[RealtimeContext] Budget exhausted — skipping "${section.label}"`);
      break;
    }

    if (sectionTokens > remainingTokens) {
      // Truncate this section to fit remaining budget
      const truncated = truncateToTokenBudget(section.content, remainingTokens - estimateTokens(section.label) - 5);
      if (truncated.length > 20) { // Only include if there's meaningful content
        assembledParts.push(section.label);
        assembledParts.push(truncated);
        assembledParts.push('');
      }
      remainingTokens = 0;
    } else {
      assembledParts.push(section.label);
      assembledParts.push(section.content);
      assembledParts.push('');
      remainingTokens -= sectionTokens;
    }
  }

  assembledParts.push(CALL_INSTRUCTIONS);

  const result = assembledParts.join('\n');
  console.info(`[RealtimeContext] Built context: ${result.length} chars (~${estimateTokens(result)} tokens), ${sections.length} section(s)`);

  return result;
}
