import type { z } from 'zod';

export type ToolSource = 'builtin' | 'mcp' | 'skill' | 'plugin' | 'cli';

export type ToolProgressEvent = {
  stream: 'stdout' | 'stderr';
  delta: string;
  output: string;
  bytesSeen: number;
  truncated: boolean;
  stopped: boolean;
  subAgentConversationId?: string;
};

export type ToolExecutionContext = {
  toolCallId: string;
  conversationId?: string;
  cwd?: string;
  abortSignal?: AbortSignal;
  onProgress?: (event: ToolProgressEvent) => void;
};

export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  execute: (input: unknown, context: ToolExecutionContext) => Promise<unknown>;
  source?: ToolSource;
  sourceId?: string;
  originalName?: string;
  aliases?: string[];
};
