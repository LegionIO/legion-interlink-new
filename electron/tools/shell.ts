import { z } from 'zod';
import type { AppConfig } from '../config/schema.js';
import type { ToolDefinition } from './types.js';
import { runCommandWithStreaming, resolveProcessStreamingConfig } from './process-runner.js';
import { runToolExecution } from './execution.js';

function matchesPattern(command: string, pattern: string): boolean {
  if (pattern === '*') return true;
  if (pattern.includes('*')) {
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    return regex.test(command);
  }
  return command.includes(pattern);
}

export function isCommandAllowed(command: string, config: AppConfig): { allowed: boolean; reason?: string } {
  const shellConfig = config.tools.shell;
  if (!shellConfig.enabled) return { allowed: false, reason: 'Shell tool is disabled' };

  for (const pattern of shellConfig.denyPatterns) {
    if (matchesPattern(command, pattern)) {
      return { allowed: false, reason: `Command matches deny pattern: ${pattern}` };
    }
  }

  if (shellConfig.allowPatterns.length > 0 && !shellConfig.allowPatterns.includes('*')) {
    const allowed = shellConfig.allowPatterns.some((p) => matchesPattern(command, p));
    if (!allowed) return { allowed: false, reason: 'Command does not match any allow pattern' };
  }

  return { allowed: true };
}

export function createShellTool(getConfig: () => AppConfig): ToolDefinition {
  return {
    name: 'sh',
    description: 'Execute a shell command on the local machine. Returns stdout/stderr. Use for running programs, scripts, git commands, package managers, etc.',
    inputSchema: z.object({
      command: z.string().describe('The shell command to execute'),
      cwd: z.string().optional().describe('Working directory (defaults to home)'),
      timeout: z.number().optional().describe('Timeout in milliseconds'),
    }),
    execute: async (input, context) => runToolExecution({
      context,
      run: async () => {
        const { command, cwd, timeout } = input as { command: string; cwd?: string; timeout?: number };
        const config = getConfig();

        const check = isCommandAllowed(command, config);
        if (!check.allowed) {
          return { error: check.reason, command, isError: true };
        }

        const streaming = resolveProcessStreamingConfig(config);
        const result = await runCommandWithStreaming({
          command,
          cwd: cwd || context.cwd || process.env.HOME,
          timeoutMs: timeout || config.tools.shell.timeout,
          env: { ...process.env },
          context,
          streaming,
        });

        const payload: Record<string, unknown> = {
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
        };

        if (result.timedOut) payload.error = 'Command timed out';
        if (result.cancelled) payload.error = 'Command cancelled';
        if (result.truncated) {
          payload.truncated = true;
          payload.stdoutTruncated = result.stdoutTruncated;
          payload.stderrTruncated = result.stderrTruncated;
          payload.totalStdoutBytes = result.totalStdoutBytes;
          payload.totalStderrBytes = result.totalStderrBytes;
        }
        if (result.modelStream) {
          payload.modelStream = result.modelStream;
        }

        return payload;
      },
    }),
  };
}
