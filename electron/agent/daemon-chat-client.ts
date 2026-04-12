/**
 * DaemonChatClient — thin HTTP client that forwards LLM inference requests
 * to the LegionIO daemon running on localhost.
 *
 * All skill injection, enrichment, and inference runs daemon-side.
 * This client is a transport layer only.
 */

import { randomUUID } from 'crypto';
import { withBrandUserAgent } from '../utils/user-agent.js';

export interface DaemonChatOptions {
  baseUrl: string;
  conversationId?: string;
  /** Optional Bearer token for daemon auth (from resolveAuthToken). */
  authToken?: string | null;
  /** Request timeout in milliseconds (default: 30 000). */
  timeoutMs?: number;
}

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface InferenceRequest {
  messages: Message[];
  conversation_id?: string;
  metadata?: Record<string, unknown>;
  stream?: boolean;
}

export interface InferenceChunk {
  delta?: string;
  done?: boolean;
  error?: string;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export class DaemonChatClient {
  private readonly _baseUrl: string;
  private readonly _conversationId: string;
  private readonly _authToken: string | null;
  private readonly _timeoutMs: number;

  constructor(options: DaemonChatOptions) {
    this._baseUrl = options.baseUrl.replace(/\/$/, '');
    this._conversationId = options.conversationId ?? randomUUID();
    this._authToken = options.authToken ?? null;
    this._timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  get conversationId(): string {
    return this._conversationId;
  }

  private get inferenceUrl(): string {
    return `${this._baseUrl}/api/llm/inference`;
  }

  private buildHeaders(extra: Record<string, string> = {}): Record<string, string> {
    return withBrandUserAgent({
      'content-type': 'application/json',
      'accept': 'text/event-stream',
      ...(this._authToken ? { Authorization: `Bearer ${this._authToken}` } : {}),
      ...extra,
    });
  }

  /**
   * Send a user message to the daemon. Streams SSE response chunks to the callback.
   * Returns the full concatenated response text.
   */
  async sendMessage(
    content: string,
    onChunk: (chunk: string) => void,
    metadata: Record<string, unknown> = {},
  ): Promise<string> {
    const body: InferenceRequest = {
      messages: [{ role: 'user', content }],
      conversation_id: this._conversationId,
      metadata,
      stream: true,
    };

    const response = await fetch(this.inferenceUrl, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this._timeoutMs),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Daemon inference error ${response.status}: ${err}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let fullText = '';
    let buffer = '';
    let streamDone = false;
    let streamError: string | undefined;

    const processLine = (line: string): void => {
      const trimmed = line.replace(/\r$/, '');
      if (!trimmed || trimmed.startsWith(':') || trimmed.startsWith('event:')) return;
      if (!trimmed.startsWith('data:')) return;
      const raw = trimmed.slice(5).trimStart();
      if (!raw || raw === '[DONE]') {
        streamDone = true;
        return;
      }
      try {
        const parsed = JSON.parse(raw) as { text?: string; delta?: string; done?: boolean; error?: string };
        if (parsed.error) {
          streamError = parsed.error;
          streamDone = true;
          return;
        }
        if (parsed.done) {
          streamDone = true;
          return;
        }
        const delta = parsed.text ?? parsed.delta ?? '';
        if (delta) {
          fullText += delta;
          onChunk(delta);
        }
      } catch {
        // Non-JSON data line — forward as raw text delta
        fullText += raw;
        onChunk(raw);
      }
    };

    try {
      while (!streamDone) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          processLine(line);
          if (streamDone) break;
        }
      }

      // Flush any remaining buffered data after the read loop
      if (buffer.trim().length > 0) {
        processLine(buffer.replace(/\r$/, ''));
      }
    } finally {
      reader.releaseLock();
    }

    if (streamError) throw new Error(`Daemon stream error: ${streamError}`);

    return fullText;
  }

  /**
   * Cancel any active skill running in this conversation.
   */
  async cancelSkill(): Promise<boolean> {
    const url = `${this._baseUrl}/api/skills/active/${encodeURIComponent(this._conversationId)}`;
    const response = await fetch(url, {
      method: 'DELETE',
      headers: withBrandUserAgent({
        ...(this._authToken ? { Authorization: `Bearer ${this._authToken}` } : {}),
      }),
      signal: AbortSignal.timeout(this._timeoutMs),
    });
    return response.ok;
  }
}
