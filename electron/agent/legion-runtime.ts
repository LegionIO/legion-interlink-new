import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { createHmac, randomUUID } from 'crypto';
import { createInterface } from 'readline';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import type { LegionConfig } from '../config/schema.js';
import type { LLMModelConfig } from './model-catalog.js';
import type { StreamEvent } from './mastra-agent.js';
import { LEGION_BRIDGE_SCRIPT } from './legion-bridge-script.js';

export type AgentBackend = 'mastra' | 'legion-embedded' | 'legion-daemon';

type RuntimeMessage = {
  role: string;
  content: unknown;
};

type EmbeddedBridgeEvent =
  | { type: 'text-delta'; text?: string }
  | { type: 'tool-call'; toolCallId?: string; toolName?: string; args?: unknown }
  | { type: 'tool-result'; toolCallId?: string; toolName?: string; result?: unknown }
  | { type: 'error'; error?: string }
  | { type: 'done' }
  | { type: 'health'; ok?: boolean; status?: string; error?: string };

export type LegionStatus = {
  backend: AgentBackend;
  embedded: {
    ok: boolean;
    status: 'llm_ready' | 'llm_unavailable' | 'settings_error' | 'bridge_error';
    error?: string;
    rubyPath?: string;
    rootPath?: string;
    configDir?: string;
  };
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
};

type RuntimeConfig = NonNullable<LegionConfig['runtime']>;

function runtimeConfig(config: LegionConfig): RuntimeConfig {
  const runtime = config.runtime ?? {
    agentBackend: 'legion-embedded',
    legion: { rootPath: '', configDir: '', daemonUrl: 'http://127.0.0.1:4567', rubyPath: '' },
  };
  return {
    agentBackend: runtime.agentBackend ?? 'legion-embedded',
    legion: {
      rootPath: runtime.legion?.rootPath ?? '',
      configDir: runtime.legion?.configDir ?? '',
      daemonUrl: runtime.legion?.daemonUrl ?? 'http://127.0.0.1:4567',
      rubyPath: runtime.legion?.rubyPath ?? '',
    },
  };
}

function resolveLegionRoot(config: LegionConfig): string {
  const configured = runtimeConfig(config).legion.rootPath.trim();
  if (configured) return resolve(configured);

  const candidates = legionRootCandidates();
  const found = candidates.find((candidate) => existsSync(join(candidate, 'lib')));
  return found ?? '';
}

function legionRootCandidates(): string[] {
  return [
    resolve(process.cwd(), '..', 'LegionIO'),
    resolve(process.cwd(), '..', 'legionio'),
    resolve(process.cwd(), 'LegionIO'),
    resolve(process.cwd(), 'legionio'),
  ];
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

function spawnBridgeProcess(
  config: LegionConfig,
  legionHome: string,
): { child: ChildProcessWithoutNullStreams; rootPath: string; rubyPath: string } {
  const rootPath = resolveLegionRoot(config);
  const rubyPath = resolveRubyPath(config);
  const scriptPath = ensureBridgeScript(legionHome);
  const hasGemfile = rootPath ? existsSync(join(rootPath, 'Gemfile')) : false;
  const installed = detectInstalledLegionEnvironment();

  const child = hasGemfile
    ? spawn('bundle', ['exec', rubyPath, scriptPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: rootPath,
      })
    : spawn(rubyPath, [scriptPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: process.cwd(),
        env: installed?.rubyPath === rubyPath ? installed.env : process.env,
      });

  return { child, rootPath, rubyPath };
}

function ensureBridgeScript(legionHome: string): string {
  const dir = join(legionHome, 'cache');
  mkdirSync(dir, { recursive: true });
  const scriptPath = join(dir, 'legion-bridge.rb');
  writeFileSync(scriptPath, LEGION_BRIDGE_SCRIPT, 'utf-8');
  return scriptPath;
}

function summarizeEmbeddedError(stderr: string, config: LegionConfig): string {
  const text = stderr.trim();
  if (!text) return 'Legion bridge failed.';

  const hints: string[] = [];
  if (text.includes('/System/Library/Frameworks/Ruby.framework/Versions/2.6')) {
    hints.push('Legion is using macOS system Ruby 2.6. Set Settings > Models > Agent Runtime > Ruby Path to a managed Ruby 3.4+.');
  }
  if (text.includes("Could not find gem 'mysql2'")) {
    hints.push('Your Legion runtime is falling back to a repo/Bundler install. If you want zero setup, use the Homebrew-installed Legion runtime and leave Ruby Path blank.');
  }
  if (text.includes('cannot load such file -- thor')) {
    hints.push('Run `bundle install` inside your LegionIO repo.');
  }
  if (text.includes('ffi') && text.includes('extensions are not built')) {
    hints.push('Run `gem pristine ffi --version 1.15.5` in the same Ruby environment.');
  }

  const firstLine = text.split('\n').find((line) => line.trim().length > 0) || text;
  return hints.length > 0 ? `${firstLine} ${hints.join(' ')}` : firstLine;
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

async function* streamEmbeddedLegion(options: StreamLegionOptions): AsyncGenerator<StreamEvent> {
  const { child } = spawnBridgeProcess(options.config, options.legionHome);

  const onAbort = () => {
    if (!child.killed) child.kill('SIGTERM');
  };
  options.abortSignal?.addEventListener('abort', onAbort, { once: true });

  const payload = {
    type: 'run',
    rootPath: resolveLegionRoot(options.config),
    configDir: resolveLegionConfigDir(options.config, options.legionHome),
    cwd: process.cwd(),
    extraDirs: [],
    model: options.modelConfig.modelName,
    provider: toLegionProvider(options.modelConfig.provider),
    systemPrompt: options.config.systemPrompt,
    permissionMode: 'headless',
    messages: normalizeMessages(options.messages),
  };

  child.stdin.write(`${JSON.stringify(payload)}\n`);
  child.stdin.end();

  const stdout = createInterface({ input: child.stdout });
  let sawDone = false;
  let stderr = '';

  child.stderr.setEncoding('utf-8');
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });

  try {
    for await (const line of stdout) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let event: EmbeddedBridgeEvent;
      try {
        event = JSON.parse(trimmed) as EmbeddedBridgeEvent;
      } catch {
        continue;
      }

      if (event.type === 'text-delta' && event.text) {
        yield { conversationId: options.conversationId, type: 'text-delta', text: event.text };
      } else if (event.type === 'tool-call') {
        yield {
          conversationId: options.conversationId,
          type: 'tool-call',
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: event.args,
          startedAt: new Date().toISOString(),
        };
      } else if (event.type === 'tool-result') {
        yield {
          conversationId: options.conversationId,
          type: 'tool-result',
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          result: event.result,
          finishedAt: new Date().toISOString(),
        };
      } else if (event.type === 'error') {
        yield {
          conversationId: options.conversationId,
          type: 'error',
          error: event.error || 'Legion bridge failed.',
        };
      } else if (event.type === 'done') {
        sawDone = true;
        yield { conversationId: options.conversationId, type: 'done' };
      }
    }
  } finally {
    options.abortSignal?.removeEventListener('abort', onAbort);
  }

  const exitCode: number = await new Promise((resolveExit) => {
    child.once('exit', (code) => resolveExit(code ?? 0));
  });

  if (!sawDone && !options.abortSignal?.aborted) {
    if (stderr.trim()) {
      yield { conversationId: options.conversationId, type: 'error', error: summarizeEmbeddedError(stderr, options.config) };
    } else if (exitCode !== 0) {
      yield { conversationId: options.conversationId, type: 'error', error: `Legion bridge exited with code ${exitCode}.` };
    }
    yield { conversationId: options.conversationId, type: 'done' };
  }
}

async function* streamDaemonLegion(options: StreamLegionOptions): AsyncGenerator<StreamEvent> {
  const daemonUrl = resolveDaemonUrl(options.config);
  const readyUrl = new URL('/api/ready', daemonUrl).toString();
  const chatUrl = new URL('/api/llm/chat', daemonUrl).toString();
  const authToken = resolveDaemonAuthToken(options.config, options.legionHome);

  let readyResponse: Response;
  try {
    readyResponse = await fetch(readyUrl, { signal: options.abortSignal });
  } catch (error) {
    yield {
      conversationId: options.conversationId,
      type: 'error',
      error: `Legion daemon not running at ${daemonUrl}: ${error instanceof Error ? error.message : String(error)}`,
    };
    yield { conversationId: options.conversationId, type: 'done' };
    return;
  }

  let readyBody: unknown = null;
  try {
    readyBody = await readyResponse.json();
  } catch {
    readyBody = null;
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

  const message = buildDaemonPrompt(options.messages);
  if (!message) {
    yield {
      conversationId: options.conversationId,
      type: 'error',
      error: 'No user message was provided to Legion.',
    };
    yield { conversationId: options.conversationId, type: 'done' };
    return;
  }

  const response = await fetch(chatUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-legion-sync': 'true',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
    body: JSON.stringify({
      message,
      model: options.modelConfig.modelName,
      provider: toLegionProvider(options.modelConfig.provider),
    }),
    signal: options.abortSignal,
  });

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  const data = body && typeof body === 'object' ? (body as { data?: Record<string, unknown>; error?: { message?: string } }) : {};
  if (response.status === 202) {
    yield {
      conversationId: options.conversationId,
      type: 'error',
      error: 'Legion daemon accepted the request asynchronously, but polling that response is not implemented yet. Use embedded Legion mode or disable Legion cache for now.',
    };
    yield { conversationId: options.conversationId, type: 'done' };
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
    yield { conversationId: options.conversationId, type: 'error', error: errorMessage };
    yield { conversationId: options.conversationId, type: 'done' };
    return;
  }

  const text = typeof data.data?.response === 'string' ? data.data.response : '';
  if (text) {
    yield { conversationId: options.conversationId, type: 'text-delta', text };
  } else {
    yield {
      conversationId: options.conversationId,
      type: 'error',
      error: `Legion daemon returned an unexpected payload from ${chatUrl}.`,
    };
  }
  void readyBody;
  yield { conversationId: options.conversationId, type: 'done' };
}

function buildDaemonPrompt(messages: unknown[]): string {
  const normalized = normalizeMessages(messages);
  return normalized
    .map((message) => `${message.role === 'assistant' ? 'Assistant' : 'User'}: ${extractText(message.content)}`)
    .join('\n\n')
    .trim();
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

export function resolveAgentBackend(config: LegionConfig): AgentBackend {
  return runtimeConfig(config).agentBackend;
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
  if (resolveAgentBackend(options.config) === 'legion-daemon') {
    yield* streamDaemonLegion(options);
    return;
  }
  yield* streamEmbeddedLegion(options);
}

async function runEmbeddedHealthCheck(config: LegionConfig, legionHome: string): Promise<LegionStatus['embedded']> {
  return await new Promise((resolveHealth) => {
    const { child, rootPath, rubyPath } = spawnBridgeProcess(config, legionHome);
    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf-8');
    child.stderr.setEncoding('utf-8');
    child.stdout.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    child.once('exit', () => {
      const firstLine = stdout.split('\n').find((line) => line.trim().length > 0);
      if (!firstLine) {
        resolveHealth({
          ok: false,
          status: 'bridge_error',
          error: stderr.trim() || 'Legion bridge returned no output.',
          rubyPath,
          rootPath,
          configDir: resolveLegionConfigDir(config, legionHome),
        });
        return;
      }

      try {
        const event = JSON.parse(firstLine) as EmbeddedBridgeEvent;
        if (event.type !== 'health') {
          resolveHealth({
            ok: false,
            status: 'bridge_error',
            error: 'Legion bridge returned an unexpected response.',
            rubyPath,
            rootPath,
            configDir: resolveLegionConfigDir(config, legionHome),
          });
          return;
        }

        resolveHealth({
          ok: Boolean(event.ok),
          status: event.status === 'llm_ready' ? 'llm_ready' : event.status === 'settings_error' ? 'settings_error' : 'llm_unavailable',
          error: event.error,
          rubyPath,
          rootPath,
          configDir: resolveLegionConfigDir(config, legionHome),
        });
      } catch {
        resolveHealth({
          ok: false,
          status: 'bridge_error',
          error: stderr.trim() || 'Failed to parse Legion bridge health output.',
          rubyPath,
          rootPath,
          configDir: resolveLegionConfigDir(config, legionHome),
        });
      }
    });

    child.stdin.write(`${JSON.stringify({
      type: 'health',
      rootPath: resolveLegionRoot(config),
      configDir: resolveLegionConfigDir(config, legionHome),
    })}\n`);
    child.stdin.end();
  });
}

async function runDaemonHealthCheck(config: LegionConfig): Promise<LegionStatus['daemon']> {
  const daemonUrl = resolveDaemonUrl(config);
  const readyUrl = new URL('/api/ready', daemonUrl).toString();

  try {
    const response = await fetch(readyUrl);
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
  const [embedded, daemon] = await Promise.all([
    runEmbeddedHealthCheck(config, legionHome),
    runDaemonHealthCheck(config),
  ]);

  return {
    backend: resolveAgentBackend(config),
    embedded,
    daemon,
  };
}
