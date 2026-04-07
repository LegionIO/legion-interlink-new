import { z } from 'zod';
import { spawnSync } from 'node:child_process';
import type { AppConfig } from '../config/schema.js';
import type { ToolDefinition } from './types.js';
import { runCommandWithStreaming, resolveProcessStreamingConfig } from './process-runner.js';
import { runToolExecution } from './execution.js';
import { isCommandAllowed } from './shell.js';

function binaryExists(name: string): boolean {
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

const CLI_TOOL_SPECS: CliToolSpec[] = [
  {
    name: 'github',
    binary: 'gh',
    extraBinaries: ['git'],
    description: [
      'Run GitHub CLI (gh) and git commands. Use for:',
      '- GitHub: gh pr list, gh issue create, gh repo clone, gh api, gh run list',
      '- Git: git status, git log, git diff, git commit, git push, git pull, git branch',
      '- Worktrees: git worktree add, git worktree list, git worktree remove',
      'Pass the full command string including the binary name (gh or git).',
    ].join('\n'),
    prefix: 'gh pr list',
  },
  {
    name: 'brew',
    binary: 'brew',
    description: [
      'Run Homebrew package manager commands.',
      'Examples: brew install <pkg>, brew upgrade, brew list, brew search <query>, brew info <pkg>, brew services list.',
    ].join('\n'),
  },
  {
    name: 'wget',
    binary: 'wget',
    description: [
      'Download files from the web using wget.',
      'Examples: wget <url>, wget -O <file> <url>, wget -r <url>, wget --spider <url>.',
    ].join('\n'),
  },
  {
    name: 'jq',
    binary: 'jq',
    description: [
      'Process JSON data with jq. Pipe JSON into jq or read from files.',
      'Examples: echo \'{"a":1}\' | jq .a, cat file.json | jq \'.items[] | .name\', jq -r .version package.json.',
    ].join('\n'),
  },
  {
    name: 'tree',
    binary: 'tree',
    description: [
      'Display directory structure as a tree.',
      'Examples: tree, tree -L 2, tree -I node_modules, tree --dirsfirst -a, tree -P "*.ts".',
    ].join('\n'),
  },
  {
    name: 'python',
    binary: 'python3',
    extraBinaries: ['pip3'],
    description: [
      'Run Python 3 and pip commands.',
      'Examples: python3 script.py, python3 -c "print(1+1)", pip3 install <pkg>, pip3 list, pip3 freeze.',
      'Pass the full command including the binary name (python3 or pip3).',
    ].join('\n'),
    prefix: 'python3 --version',
  },
  {
    name: 'ollama',
    binary: 'ollama',
    description: [
      'Manage and run local LLM models with Ollama.',
      'Examples: ollama list, ollama pull <model>, ollama run <model>, ollama show <model>, ollama ps, ollama rm <model>.',
    ].join('\n'),
  },
  {
    name: 'klist',
    binary: 'klist',
    description: [
      'Display Kerberos ticket cache contents.',
      'Examples: klist, klist -l, klist -e, klist -A.',
    ].join('\n'),
  },
  {
    name: 'jfrog',
    binary: 'jfrog',
    description: [
      'Run JFrog CLI commands for Artifactory, Xray, and other JFrog services.',
      'Examples: jfrog rt ping, jfrog rt search <pattern>, jfrog rt upload <file> <repo>, jfrog config show.',
    ].join('\n'),
  },
];

export function buildCliTools(getConfig: () => AppConfig): ToolDefinition[] {
  const tools: ToolDefinition[] = [];

  for (const spec of CLI_TOOL_SPECS) {
    if (binaryExists(spec.binary)) {
      tools.push(createCliTool(spec, getConfig));
    }
  }

  return tools;
}
