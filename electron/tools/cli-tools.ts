import { z } from 'zod';
import { spawnSync } from 'node:child_process';
import type { AppConfig } from '../config/schema.js';
import type { ToolDefinition } from './types.js';
import { runCommandWithStreaming, resolveProcessStreamingConfig } from './process-runner.js';
import { runToolExecution } from './execution.js';
import { isCommandAllowed } from './shell.js';

export function binaryExists(name: string): boolean {
  const isWindows = process.platform === 'win32';
  const result = isWindows
    ? spawnSync('where', [name], { stdio: 'ignore', shell: false })
    : spawnSync('command', ['-v', name], { stdio: 'ignore', shell: true });
  return result.status === 0;
}

type CliToolSpec = {
  name: string;
  binary: string;
  extraBinaries?: string[];
  description: string;
  prefix?: string;
};

function createCliTool(spec: CliToolSpec, getConfig: () => AppConfig): ToolDefinition {
  return {
    name: spec.name,
    description: spec.description,
    inputSchema: z.object({
      command: z.string().describe(`The full ${spec.binary} command to execute (e.g. "${spec.prefix ?? spec.binary} --help")`),
      cwd: z.string().optional().describe('Working directory (defaults to home)'),
      timeout: z.number().optional().describe('Timeout in milliseconds'),
    }),
    source: 'cli',
    execute: async (input, context) => runToolExecution({
      context,
      run: async () => {
        const { command, cwd, timeout } = input as { command: string; cwd?: string; timeout?: number };
        const config = getConfig();

        // Validate command starts with an allowed binary for this tool
        const allBinaries = [spec.binary, ...(spec.extraBinaries ?? [])];
        const firstToken = command.trim().split(/\s+/)[0];
        if (!allBinaries.includes(firstToken)) {
          return { error: `Command must start with one of: ${allBinaries.join(', ')}`, command, isError: true };
        }

        // Apply shell allow/deny guardrails
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
        }
        if (result.modelStream) payload.modelStream = result.modelStream;

        return payload;
      },
    }),
  };
}

export function buildCliTools(getConfig: () => AppConfig): ToolDefinition[] {
  const config = getConfig();
  const specs = config.cliTools ?? [];
  const tools: ToolDefinition[] = [];

  for (const spec of specs) {
    if (spec.enabled === false) continue;
    if (binaryExists(spec.binary)) {
      tools.push(createCliTool(spec, getConfig));
    }
  }

  return tools;
}
