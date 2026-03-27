import { createHmac, randomUUID } from 'crypto';
import { existsSync, readFileSync, realpathSync } from 'fs';
import { join, resolve } from 'path';
import type { LegionConfig } from '../config/schema.js';
import type { LLMModelConfig } from './model-catalog.js';
import type { StreamEvent } from './mastra-agent.js';

export type AgentBackend = 'mastra' | 'legion-daemon';

type RuntimeMessage = {
  role: string;
  content: unknown;
};

export type LegionStatus = {
  backend: AgentBackend;
  daemon: {
    ok: boolean;
    status: 'ready' | 'not_ready' | 'not_running' | 'request_failed';
    error?: string;
    url: string;
    details?: unknown;
  };
};

export type LegionRuntimeDetection = {
  configDir: string;
  daemonUrl: string;
  rubyPath: string;
};

type StreamLegionOptions = {
  conversationId: string;
  messages: unknown[];
  modelConfig: LLMModelConfig;
  config: LegionConfig;
  legionHome: string;
  abortSignal?: AbortSignal;
  reasoningEffort?: string;
};

type RuntimeConfig = NonNullable<LegionConfig['runtime']>;

function runtimeConfig(config: LegionConfig): RuntimeConfig {
  const runtime = config.runtime ?? {
    agentBackend: 'mastra',
    legion: { rootPath: '', configDir: '', daemonUrl: 'http://127.0.0.1:4567', rubyPath: '' },
  };
  return {
    agentBackend: runtime.agentBackend ?? 'mastra',
    legion: {
      rootPath: runtime.legion?.rootPath ?? '',
      configDir: runtime.legion?.configDir ?? '',
      daemonUrl: runtime.legion?.daemonUrl ?? 'http://127.0.0.1:4567',
      rubyPath: runtime.legion?.rubyPath ?? '',
    },
  };
}

type InstalledLegionEnvironment = {
  legionBin: string;
  rubyPath: string;
  env: NodeJS.ProcessEnv;
};

function installedLegionCandidates(): string[] {
  return [
    '/opt/homebrew/bin/legion',
    '/usr/local/bin/legion',
  ];
}

function detectInstalledLegionEnvironment(): InstalledLegionEnvironment | null {
  const legionBin = installedLegionCandidates().find((candidate) => existsSync(candidate));
  if (!legionBin) return null;

  try {
    const realBin = realpathSync(legionBin);
    const cellarRoot = resolve(realBin, '..', '..');
    const libexecRoot = join(cellarRoot, 'libexec');
    const rubyPath = join(libexecRoot, 'bin', 'ruby');
    if (!existsSync(rubyPath)) return null;

    const rubyLib = [
      join(libexecRoot, 'lib', 'ruby', '3.4.0'),
      join(libexecRoot, 'lib', 'ruby', '3.4.0', 'arm64-darwin23'),
    ].filter((candidate) => existsSync(candidate)).join(':');
    const gemHome = join(libexecRoot, 'lib', 'ruby', 'gems', '3.4.0');
    const dyldFallback = join(libexecRoot, 'libexec');

    return {
      legionBin,
      rubyPath,
      env: {
        ...process.env,
        PATH: `${join(libexecRoot, 'bin')}:${process.env.PATH || ''}`,
        RUBYLIB: rubyLib || process.env.RUBYLIB,
        GEM_HOME: gemHome,
        GEM_PATH: gemHome,
        DYLD_FALLBACK_LIBRARY_PATH: dyldFallback,
      },
    };
  } catch {
    return null;
  }
}

function resolveLegionConfigDir(config: LegionConfig, legionHome: string): string {
  const configured = runtimeConfig(config).legion.configDir.trim();
  if (configured) return resolve(configured);
  return join(legionHome, 'settings');
}

function resolveDaemonUrl(config: LegionConfig): string {
  const configured = runtimeConfig(config).legion.daemonUrl.trim();
  return configured || 'http://127.0.0.1:4567';
}

function resolveDaemonAuthToken(config: LegionConfig, legionHome: string): string | null {
  const cryptPath = join(resolveLegionConfigDir(config, legionHome), 'crypt.json');
  if (!existsSync(cryptPath)) return null;

  try {
    const raw = JSON.parse(readFileSync(cryptPath, 'utf-8')) as {
      crypt?: { cluster_secret?: string };
    };
    const clusterSecret = raw.crypt?.cluster_secret?.trim();
    if (!clusterSecret) return null;

    const now = Math.floor(Date.now() / 1000);
    const header = base64UrlEncode({ alg: 'HS256', typ: 'JWT' });
    const payload = base64UrlEncode({
      sub: process.env.USER || process.env.USERNAME || 'legion-interlink',
      name: 'Legion Interlink',
      roles: ['desktop'],
      scope: 'human',
      iss: 'legion',
      iat: now,
      exp: now + 3600,
      jti: randomUUID(),
    });
    const signature = createHmac('sha256', clusterSecret)
      .update(`${header}.${payload}`)
      .digest('base64url');
    return `${header}.${payload}.${signature}`;
  } catch {
    return null;
  }
}

function base64UrlEncode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function resolveRubyPath(config: LegionConfig): string {
  const configured = runtimeConfig(config).legion.rubyPath.trim();
  if (configured) return configured;

  const installed = detectInstalledLegionEnvironment();
  if (installed?.rubyPath) return installed.rubyPath;

  const preferred = rubyPathCandidates().find((candidate) => candidate !== 'ruby' && existsSync(candidate));
  return preferred || process.env.RUBY || 'ruby';
}

function rubyPathCandidates(): string[] {
  const home = process.env.HOME || '';
  return [
    process.env.RUBY || '',
    home ? join(home, '.rbenv', 'shims', 'ruby') : '',
    home ? join(home, '.asdf', 'shims', 'ruby') : '',
    home ? join(home, '.local', 'share', 'mise', 'shims', 'ruby') : '',
    '/opt/homebrew/opt/ruby/bin/ruby',
    '/usr/local/opt/ruby/bin/ruby',
    'ruby',
  ].filter(Boolean);
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  return content.map((part) => {
    if (!part || typeof part !== 'object') return '';
    const typed = part as {
      type?: string;
      text?: string;
      filename?: string;
      toolName?: string;
      args?: unknown;
      result?: unknown;
    };
    switch (typed.type) {
      case 'text':
        return typed.text ?? '';
      case 'image':
        return '[Image]';
      case 'file':
        return typed.filename ? `[File: ${typed.filename}]` : '[File]';
      case 'tool-call': {
        const lines = [`[Tool call: ${typed.toolName ?? 'unknown'}]`];
        if (typed.args !== undefined) lines.push(`Args: ${stringifyValue(typed.args, 1000)}`);
        if (typed.result !== undefined) lines.push(`Result: ${stringifyValue(typed.result, 1500)}`);
        return lines.join('\n');
      }
      default:
        return '';
    }
  }).filter(Boolean).join('\n').trim();
}

function normalizeMessages(messages: unknown[]): RuntimeMessage[] {
  const normalized: Array<RuntimeMessage | null> = messages
    .map((message) => {
      if (!message || typeof message !== 'object') return null;
      const typed = message as { role?: string; content?: unknown };
      const role = typed.role === 'assistant' ? 'assistant' : typed.role === 'user' ? 'user' : '';
      if (!role) return null;
      const text = extractText(typed.content);
      if (!text) return null;
      return { role, content: [{ type: 'text', text }] };
    });
  return normalized.filter((message): message is RuntimeMessage => message !== null);
}

function stringifyValue(value: unknown, maxLength = 2000): string {
  try {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    if (typeof text !== 'string') return String(value);
    return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
  } catch {
    return String(value);
  }
}

async function* streamDaemonLegion(options: StreamLegionOptions): AsyncGenerator<StreamEvent> {
  const daemonUrl = resolveDaemonUrl(options.config);
  const readyUrl = new URL('/api/ready', daemonUrl).toString();
  const chatUrl = new URL('/api/llm/chat', daemonUrl).toString();
  const authToken = resolveDaemonAuthToken(options.config, options.legionHome);

  let readyResponse: Response;
  try {
    readyResponse = await fetch(readyUrl, {
      signal: options.abortSignal ?? AbortSignal.timeout(5000),
    });
  } catch (error) {
    yield {
      conversationId: options.conversationId,
      type: 'error',
      error: `Legion daemon not running at ${daemonUrl}: ${error instanceof Error ? error.message : String(error)}`,
    };
    yield { conversationId: options.conversationId, type: 'done' };
    return;
  }

  if (!readyResponse.ok) {
    yield {
      conversationId: options.conversationId,
      type: 'error',
      error: `Legion daemon is not ready at ${daemonUrl}.`,
    };
    yield { conversationId: options.conversationId, type: 'done' };
    return;
  }

  const daemonPayload = buildDaemonPayload(options.messages);
  if (!daemonPayload.message) {
    yield {
      conversationId: options.conversationId,
      type: 'error',
      error: 'No user message was provided to Legion.',
    };
    yield { conversationId: options.conversationId, type: 'done' };
    return;
  }

  const requestBody: Record<string, unknown> = {
    message: daemonPayload.message,
    ...(daemonPayload.context ? { context: daemonPayload.context } : {}),
    model: options.modelConfig.modelName,
    provider: toLegionProvider(options.modelConfig.provider),
  };
  if (options.reasoningEffort) {
    requestBody.reasoning_effort = options.reasoningEffort;
  }

  const useStreaming = options.config.runtime?.legion?.daemonStreaming !== false;
  if (useStreaming) {
    let streamResponse: Response;
    try {
      streamResponse = await fetch(chatUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'accept': 'text/event-stream',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify(requestBody),
        signal: options.abortSignal,
      });
    } catch (error) {
      yield {
        conversationId: options.conversationId,
        type: 'error',
        error: `Daemon streaming request failed: ${error instanceof Error ? error.message : String(error)}`,
      };
      yield { conversationId: options.conversationId, type: 'done' };
      return;
    }

    const contentType = streamResponse.headers.get('content-type') ?? '';
    if (streamResponse.ok && contentType.includes('text/event-stream') && streamResponse.body) {
      yield* consumeDaemonSSE(options.conversationId, streamResponse.body, options.abortSignal);
      return;
    }

    yield* handleDaemonSyncResponse(options.conversationId, streamResponse, chatUrl, authToken, options.abortSignal, daemonUrl);
    return;
  }

  const response = await fetch(chatUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-legion-sync': 'true',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
    body: JSON.stringify(requestBody),
    signal: options.abortSignal,
  });

  yield* handleDaemonSyncResponse(options.conversationId, response, chatUrl, authToken, options.abortSignal, daemonUrl);
}

async function* consumeDaemonSSE(
  conversationId: string,
  body: ReadableStream<Uint8Array>,
  abortSignal?: AbortSignal,
): AsyncGenerator<StreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let emittedAny = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const raw = line.slice(5).trim();
        if (!raw || raw === '[DONE]') continue;

        let event: Record<string, unknown>;
        try {
          event = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          emittedAny = true;
          yield { conversationId, type: 'text-delta', text: raw };
          continue;
        }

        const eventType = (event.type as string) || '';
        if (eventType === 'text-delta' || eventType === 'delta') {
          const text = (event.text as string) || (event.delta as string) || '';
          if (text) {
            emittedAny = true;
            yield { conversationId, type: 'text-delta', text };
          }
        } else if (eventType === 'tool-call') {
          emittedAny = true;
          yield {
            conversationId,
            type: 'tool-call',
            toolCallId: event.toolCallId as string,
            toolName: event.toolName as string,
            args: event.args,
            startedAt: new Date().toISOString(),
          };
        } else if (eventType === 'tool-result') {
          emittedAny = true;
          yield {
            conversationId,
            type: 'tool-result',
            toolCallId: event.toolCallId as string,
            toolName: event.toolName as string,
            result: event.result,
            finishedAt: new Date().toISOString(),
          };
        } else if (eventType === 'error') {
          yield {
            conversationId,
            type: 'error',
            error: (event.error as string) || (event.message as string) || 'Daemon stream error',
          };
        } else if (event.response && typeof event.response === 'string') {
          emittedAny = true;
          yield { conversationId, type: 'text-delta', text: event.response as string };
        }
      }
    }
  } catch (error) {
    if (!abortSignal?.aborted) {
      yield {
        conversationId,
        type: 'error',
        error: `SSE stream error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  } finally {
    reader.releaseLock();
  }

  if (!emittedAny && !abortSignal?.aborted) {
    yield {
      conversationId,
      type: 'error',
      error: 'Daemon SSE stream ended without producing any output.',
    };
  }
  yield { conversationId, type: 'done' };
}

async function* handleDaemonSyncResponse(
  conversationId: string,
  response: Response,
  chatUrl: string,
  authToken: string | null,
  abortSignal?: AbortSignal,
  daemonUrl?: string,
): AsyncGenerator<StreamEvent> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  const data = body && typeof body === 'object'
    ? body as { data?: Record<string, unknown>; error?: { message?: string }; task_id?: string }
    : {} as { data?: Record<string, unknown>; error?: { message?: string }; task_id?: string };

  if (response.status === 202) {
    const taskId = data.task_id || (data.data?.task_id as string | undefined);
    if (taskId) {
      yield* pollDaemonTask(conversationId, taskId, daemonUrl || '', authToken, abortSignal);
      return;
    }
    yield {
      conversationId,
      type: 'error',
      error: 'Legion daemon accepted the request asynchronously but returned no task_id for polling.',
    };
    yield { conversationId, type: 'done' };
    return;
  }

  if (!response.ok) {
    const errorMessage = (
      data.error?.message
      || (response.status === 401 || response.status === 403
        ? 'Legion daemon rejected the desktop request. Make sure daemon auth is configured or that the local cluster secret is readable from your Legion config dir.'
        : undefined)
      || `Legion daemon request failed with HTTP ${response.status}.`
    );
    yield { conversationId, type: 'error', error: errorMessage };
    yield { conversationId, type: 'done' };
    return;
  }

  const text = typeof data.data?.response === 'string' ? data.data.response : '';
  if (text) {
    yield { conversationId, type: 'text-delta', text };
  } else {
    yield {
      conversationId,
      type: 'error',
      error: `Legion daemon returned an unexpected payload from ${chatUrl}.`,
    };
  }
  yield { conversationId, type: 'done' };
}

async function* pollDaemonTask(
  conversationId: string,
  taskId: string,
  daemonUrl: string,
  authToken: string | null,
  abortSignal?: AbortSignal,
): AsyncGenerator<StreamEvent> {
  const taskUrl = new URL(`/api/tasks/${taskId}`, daemonUrl).toString();
  const headers: Record<string, string> = {
    accept: 'application/json',
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
  };

  const maxAttempts = 120;
  let attempt = 0;

  yield {
    conversationId,
    type: 'text-delta',
    text: '_Waiting for daemon to process request..._\n\n',
  };

  while (attempt < maxAttempts) {
    if (abortSignal?.aborted) {
      yield { conversationId, type: 'done' };
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
    attempt++;

    let resp: Response;
    try {
      resp = await fetch(taskUrl, { headers, signal: abortSignal });
    } catch {
      if (abortSignal?.aborted) break;
      continue;
    }

    if (!resp.ok) continue;

    let taskBody: { data?: { status?: string; result?: { response?: string }; error?: string } };
    try {
      taskBody = await resp.json() as typeof taskBody;
    } catch {
      continue;
    }

    const status = taskBody.data?.status;
    if (status === 'completed' || status === 'done') {
      const responseText = taskBody.data?.result?.response;
      if (typeof responseText === 'string' && responseText) {
        yield { conversationId, type: 'text-delta', text: responseText };
      }
      yield { conversationId, type: 'done' };
      return;
    }

    if (status === 'failed' || status === 'error') {
      yield {
        conversationId,
        type: 'error',
        error: taskBody.data?.error || `Daemon task ${taskId} failed.`,
      };
      yield { conversationId, type: 'done' };
      return;
    }
  }

  yield {
    conversationId,
    type: 'error',
    error: `Daemon task ${taskId} did not complete within ${maxAttempts} seconds.`,
  };
  yield { conversationId, type: 'done' };
}

type DaemonPayload = {
  message: string;
  context?: string;
};

function buildDaemonPayload(messages: unknown[]): DaemonPayload {
  const normalized = normalizeMessages(messages);
  let lastUserIndex = -1;
  for (let i = normalized.length - 1; i >= 0; i--) {
    if (normalized[i].role === 'user') {
      lastUserIndex = i;
      break;
    }
  }

  if (lastUserIndex === -1) {
    return { message: '' };
  }

  const message = extractText(normalized[lastUserIndex].content);
  const priorMessages = normalized.slice(0, lastUserIndex);
  if (priorMessages.length === 0) {
    return { message };
  }

  const context = priorMessages
    .map((message) => `${message.role === 'assistant' ? 'Assistant' : 'User'}: ${extractText(message.content)}`)
    .join('\n\n');

  return { message, context };
}

function toLegionProvider(provider: LLMModelConfig['provider']): string {
  switch (provider) {
    case 'openai-compatible':
      return 'openai';
    case 'amazon-bedrock':
      return 'bedrock';
    case 'anthropic':
      return 'anthropic';
    case 'google':
      return 'gemini';
    default:
      return provider;
  }
}

export async function resolveAgentBackend(config: LegionConfig): Promise<AgentBackend> {
  const daemon = await runDaemonHealthCheck(config);
  return daemon.ok ? 'legion-daemon' : 'mastra';
}

export function detectLegionRuntime(config: LegionConfig, legionHome: string): LegionRuntimeDetection {
  void config;
  return {
    configDir: resolveLegionConfigDir(config, legionHome),
    daemonUrl: resolveDaemonUrl(config),
    rubyPath: resolveRubyPath(config),
  };
}

export async function* streamLegionAgent(options: StreamLegionOptions): AsyncGenerator<StreamEvent> {
  if (await resolveAgentBackend(options.config) === 'legion-daemon') {
    yield* streamDaemonLegion(options);
    return;
  }
  throw new Error('Legion runtime should not be used when the daemon is unavailable.');
}

async function runDaemonHealthCheck(config: LegionConfig): Promise<LegionStatus['daemon']> {
  const daemonUrl = resolveDaemonUrl(config);
  const readyUrl = new URL('/api/ready', daemonUrl).toString();

  try {
    const response = await fetch(readyUrl, { signal: AbortSignal.timeout(5000) });
    let details: unknown = null;
    try {
      details = await response.json();
    } catch {
      details = null;
    }

    if (response.ok) {
      return { ok: true, status: 'ready', url: daemonUrl, details };
    }

    return {
      ok: false,
      status: 'not_ready',
      url: daemonUrl,
      details,
      error: `Legion daemon responded with HTTP ${response.status}.`,
    };
  } catch (error) {
    return {
      ok: false,
      status: 'not_running',
      url: daemonUrl,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function getLegionStatus(config: LegionConfig, legionHome: string): Promise<LegionStatus> {
  void legionHome;
  const daemon = await runDaemonHealthCheck(config);

  return {
    backend: daemon.ok ? 'legion-daemon' : 'mastra',
    daemon,
  };
}
