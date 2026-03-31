import { spawn } from 'child_process';
import type { ToolExecutionContext } from './types.js';
import type { AppConfig } from '../config/schema.js';

export type ProcessStreamingConfig = {
  enabled: boolean;
  updateIntervalMs: number;
  modelFeedMode: 'incremental' | 'final-only';
  maxOutputBytes: number;
  truncationMode: 'head' | 'tail' | 'head-tail';
  stopAfterMax: boolean;
  headTailRatio: number;
};

export const DEFAULT_PROCESS_STREAMING_CONFIG: ProcessStreamingConfig = {
  enabled: true,
  updateIntervalMs: 250,
  modelFeedMode: 'incremental',
  maxOutputBytes: 120_000,
  truncationMode: 'head-tail',
  stopAfterMax: true,
  headTailRatio: 0.7,
};

const TRUNCATION_MARKER = '\n[... truncated ...]\n';

function byteLength(text: string): number {
  return Buffer.byteLength(text, 'utf-8');
}

function firstBytes(text: string, maxBytes: number): string {
  if (maxBytes <= 0 || !text) return '';
  const buf = Buffer.from(text, 'utf-8');
  if (buf.length <= maxBytes) return text;
  return buf.subarray(0, maxBytes).toString('utf-8');
}

function lastBytes(text: string, maxBytes: number): string {
  if (maxBytes <= 0 || !text) return '';
  const buf = Buffer.from(text, 'utf-8');
  if (buf.length <= maxBytes) return text;
  return buf.subarray(buf.length - maxBytes).toString('utf-8');
}

function buildHeadTailOutput(
  text: string,
  cfg: ProcessStreamingConfig,
): { output: string; head: string; tail: string; tailBytes: number } {
  const markerBytes = byteLength(TRUNCATION_MARKER);
  if (cfg.maxOutputBytes <= markerBytes) {
    const markerOnly = firstBytes(TRUNCATION_MARKER, cfg.maxOutputBytes);
    return { output: markerOnly, head: '', tail: '', tailBytes: 0 };
  }

  const bodyBudget = cfg.maxOutputBytes - markerBytes;
  const headBytes = Math.floor(bodyBudget * cfg.headTailRatio);
  const tailBytes = Math.max(0, bodyBudget - headBytes);
  const head = firstBytes(text, headBytes);
  const tail = lastBytes(text, tailBytes);
  return {
    output: head + TRUNCATION_MARKER + tail,
    head,
    tail,
    tailBytes,
  };
}

type StreamState = {
  output: string;
  bytesSeen: number;
  truncated: boolean;
  stopped: boolean;
  head: string;
  tail: string;
  tailBytes: number;
};

function appendChunk(state: StreamState, chunk: string, cfg: ProcessStreamingConfig): void {
  if (!chunk || state.stopped) return;

  state.bytesSeen += byteLength(chunk);

  if (!state.truncated) {
    const candidate = state.output + chunk;
    if (byteLength(candidate) <= cfg.maxOutputBytes) {
      state.output = candidate;
      return;
    }

    state.truncated = true;

    if (cfg.stopAfterMax) {
      if (cfg.truncationMode === 'head') {
        state.output = firstBytes(candidate, cfg.maxOutputBytes);
      } else if (cfg.truncationMode === 'tail') {
        state.output = lastBytes(candidate, cfg.maxOutputBytes);
      } else {
        const headTail = buildHeadTailOutput(candidate, cfg);
        state.tailBytes = headTail.tailBytes;
        state.head = headTail.head;
        state.tail = headTail.tail;
        state.output = headTail.output;
      }
      state.stopped = true;
      return;
    }

    if (cfg.truncationMode === 'head') {
      state.output = firstBytes(candidate, cfg.maxOutputBytes);
      return;
    }

    if (cfg.truncationMode === 'tail') {
      state.output = lastBytes(candidate, cfg.maxOutputBytes);
      return;
    }

    const headTail = buildHeadTailOutput(candidate, cfg);
    state.tailBytes = headTail.tailBytes;
    state.head = headTail.head;
    state.tail = headTail.tail;
    state.output = headTail.output;
    return;
  }

  if (cfg.stopAfterMax) {
    state.stopped = true;
    return;
  }

  if (cfg.truncationMode === 'head') {
    return;
  }

  if (cfg.truncationMode === 'tail') {
    state.output = lastBytes(state.output + chunk, cfg.maxOutputBytes);
    return;
  }

  const tailBytes = state.tailBytes > 0
    ? state.tailBytes
    : buildHeadTailOutput('', cfg).tailBytes;
  state.tailBytes = tailBytes;
  state.tail = lastBytes(state.tail + chunk, tailBytes);
  state.output = state.head + TRUNCATION_MARKER + state.tail;
}

export function resolveProcessStreamingConfig(config: AppConfig): ProcessStreamingConfig {
  const raw = config.tools.processStreaming;
  return {
    enabled: raw.enabled,
    updateIntervalMs: raw.updateIntervalMs,
    modelFeedMode: raw.modelFeedMode,
    maxOutputBytes: raw.maxOutputBytes,
    truncationMode: raw.truncationMode,
    stopAfterMax: raw.stopAfterMax,
    headTailRatio: raw.headTailRatio,
  };
}

export type RunProcessOptions = {
  command: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs: number;
  context: ToolExecutionContext;
  streaming: ProcessStreamingConfig;
};

export type RunProcessResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  cancelled: boolean;
  truncated: boolean;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  totalStdoutBytes: number;
  totalStderrBytes: number;
  modelStream?: {
    stdout: string;
    stderr: string;
    truncated: boolean;
  };
};

export async function runCommandWithStreaming(options: RunProcessOptions): Promise<RunProcessResult> {
  const { command, cwd, env, timeoutMs, context, streaming } = options;

  const stdoutState: StreamState = {
    output: '',
    bytesSeen: 0,
    truncated: false,
    stopped: false,
    head: '',
    tail: '',
    tailBytes: 0,
  };

  const stderrState: StreamState = {
    output: '',
    bytesSeen: 0,
    truncated: false,
    stopped: false,
    head: '',
    tail: '',
    tailBytes: 0,
  };

  let pendingStdout = '';
  let pendingStderr = '';
  let timedOut = false;
  let cancelled = false;
  let terminationRequested = false;

  const child = spawn(command, {
    cwd,
    env,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });

  child.stdout?.setEncoding('utf-8');
  child.stderr?.setEncoding('utf-8');

  const maybeEmitProgress = (stream: 'stdout' | 'stderr', delta: string, force = false): void => {
    if (!delta && !force) return;
    if (!streaming.enabled || !context.onProgress) return;

    const state = stream === 'stdout' ? stdoutState : stderrState;
    context.onProgress({
      stream,
      delta,
      output: state.output,
      bytesSeen: state.bytesSeen,
      truncated: state.truncated,
      stopped: state.stopped,
    });
  };

  const flushPending = (): void => {
    if (pendingStdout) {
      maybeEmitProgress('stdout', pendingStdout);
      pendingStdout = '';
    }
    if (pendingStderr) {
      maybeEmitProgress('stderr', pendingStderr);
      pendingStderr = '';
    }
  };

  const killProcess = (signal: NodeJS.Signals): void => {
    if (process.platform === 'win32') {
      try {
        child.kill(signal);
      } catch {
        // Ignore process-kill races.
      }
      return;
    }

    if (!child.pid) {
      try {
        child.kill(signal);
      } catch {
        // Ignore process-kill races.
      }
      return;
    }

    let groupKilled = false;
    try {
      process.kill(-child.pid, signal);
      groupKilled = true;
    } catch {
      // Fall through to direct child kill fallback.
    }

    try {
      // Even when group kill works, also signal the shell process directly.
      child.kill(signal);
    } catch {
      // Ignore process-kill races.
      if (!groupKilled) {
        // Nothing else to do.
      }
    }
  };

  const requestTerminate = (reason: 'timeout' | 'cancel'): void => {
    if (terminationRequested) return;
    terminationRequested = true;
    if (reason === 'timeout') timedOut = true;
    if (reason === 'cancel') cancelled = true;

    killProcess('SIGTERM');
    setTimeout(() => killProcess('SIGKILL'), 750);
  };

  const timeoutId = setTimeout(() => {
    requestTerminate('timeout');
  }, Math.max(1, timeoutMs));

  const intervalId = setInterval(flushPending, Math.max(50, streaming.updateIntervalMs));

  const abortHandler = (): void => {
    requestTerminate('cancel');
  };

  if (context.abortSignal) {
    if (context.abortSignal.aborted) {
      requestTerminate('cancel');
    } else {
      context.abortSignal.addEventListener('abort', abortHandler, { once: true });
    }
  }

  child.stdout?.on('data', (chunk: string | Buffer) => {
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
    const beforeTruncated = stdoutState.truncated;
    const beforeStopped = stdoutState.stopped;
    appendChunk(stdoutState, text, streaming);
    if (streaming.enabled && !stdoutState.stopped) {
      pendingStdout += text;
    }
    const stateChanged = stdoutState.truncated !== beforeTruncated || stdoutState.stopped !== beforeStopped;
    if (stateChanged && !pendingStdout) {
      maybeEmitProgress('stdout', '', true);
    }
  });

  child.stderr?.on('data', (chunk: string | Buffer) => {
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
    const beforeTruncated = stderrState.truncated;
    const beforeStopped = stderrState.stopped;
    appendChunk(stderrState, text, streaming);
    if (streaming.enabled && !stderrState.stopped) {
      pendingStderr += text;
    }
    const stateChanged = stderrState.truncated !== beforeTruncated || stderrState.stopped !== beforeStopped;
    if (stateChanged && !pendingStderr) {
      maybeEmitProgress('stderr', '', true);
    }
  });

  const closeResult = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.on('close', (code, signal) => {
      resolve({ code, signal });
    });
    child.on('error', () => {
      resolve({ code: 1, signal: null });
    });
  });

  clearTimeout(timeoutId);
  clearInterval(intervalId);
  flushPending();

  if (context.abortSignal) {
    context.abortSignal.removeEventListener('abort', abortHandler);
  }

  const exitCode = closeResult.code ?? (timedOut ? 124 : cancelled ? 130 : 1);
  const truncated = stdoutState.truncated || stderrState.truncated;

  const result: RunProcessResult = {
    exitCode,
    stdout: stdoutState.output,
    stderr: stderrState.output,
    timedOut,
    cancelled,
    truncated,
    stdoutTruncated: stdoutState.truncated,
    stderrTruncated: stderrState.truncated,
    totalStdoutBytes: stdoutState.bytesSeen,
    totalStderrBytes: stderrState.bytesSeen,
  };

  if (streaming.modelFeedMode === 'incremental') {
    result.modelStream = {
      stdout: stdoutState.output,
      stderr: stderrState.output,
      truncated,
    };
  }

  return result;
}
