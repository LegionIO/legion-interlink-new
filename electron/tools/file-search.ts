import { z } from 'zod';
import { readdir, stat } from 'fs/promises';
import { join } from 'path';
import type { ToolDefinition } from './types.js';
import type { AppConfig } from '../config/schema.js';
import { runCommandWithStreaming, DEFAULT_PROCESS_STREAMING_CONFIG, resolveProcessStreamingConfig } from './process-runner.js';
import { runToolExecution, throwIfAborted } from './execution.js';

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function parseGrepMatches(raw: string): Array<{ file: string; line: number; text: string }> {
  const lines = raw.split('\n').filter(Boolean);
  const parsed = lines.map((line) => {
    const match = line.match(/^(.+?):(\d+):(.*)$/);
    return match ? { file: match[1], line: Number.parseInt(match[2], 10), text: match[3] } : null;
  }).filter(Boolean) as Array<{ file: string; line: number; text: string }>;
  return parsed;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export function createGrepTool(getConfig?: () => AppConfig): ToolDefinition {
  return {
    name: 'grep',
    description: 'Search file contents using regex pattern. Returns matching lines with context.',
    inputSchema: z.object({
      pattern: z.string().describe('Regex pattern to search for'),
      path: z.string().describe('Directory or file to search in'),
      glob: z.string().optional().describe('File glob filter (e.g. "*.ts", "*.py")'),
      context: z.number().optional().describe('Lines of context before/after match'),
      maxResults: z.number().optional().describe('Maximum results to return'),
      caseInsensitive: z.boolean().optional().describe('Case insensitive search'),
    }),
    execute: async (input, context) => runToolExecution({
      context,
      run: async (signal) => {
        throwIfAborted(signal);
        const { pattern, path, glob, context: lineContext = 0, maxResults = 50, caseInsensitive = false } = input as {
          pattern: string; path: string; glob?: string;
          context?: number; maxResults?: number; caseInsensitive?: boolean;
        };
        const streaming = getConfig ? resolveProcessStreamingConfig(getConfig()) : DEFAULT_PROCESS_STREAMING_CONFIG;

        if (!(await pathExists(path))) return { error: `Path not found: ${path}`, isError: true };
        throwIfAborted(signal);

        const rgArgs: string[] = ['rg', '--json'];
        if (caseInsensitive) rgArgs.push('-i');
        if (lineContext > 0) rgArgs.push('-C', String(lineContext));
        if (glob) rgArgs.push('--glob', shellQuote(glob));
        rgArgs.push('-m', String(maxResults), '--', shellQuote(pattern), shellQuote(path));

        const rgResult = await runCommandWithStreaming({
          command: rgArgs.join(' '),
          timeoutMs: 30000,
          context,
          streaming,
        });

        if (rgResult.exitCode === 0) {
          const matches: Array<{ file: string; line: number; text: string }> = [];
          for (const line of rgResult.stdout.split('\n')) {
            if (!line.trim()) continue;
            try {
              const parsed = JSON.parse(line);
              if (parsed.type === 'match') {
                matches.push({
                  file: parsed.data?.path?.text ?? '',
                  line: parsed.data?.line_number ?? 0,
                  text: parsed.data?.lines?.text?.trimEnd() ?? '',
                });
              }
            } catch {
              // Skip malformed lines.
            }
          }
          return { matches, count: matches.length };
        }

        // rg returns exit code 1 when no matches found
        if (rgResult.exitCode === 1) return { matches: [], count: 0 };

        // Fallback to basic grep if rg is unavailable/error.
        const flags = caseInsensitive ? '-rn -i' : '-rn';
        const grepCmd = glob
          ? `grep ${flags} --include=${shellQuote(glob)} -m ${maxResults} ${shellQuote(pattern)} ${shellQuote(path)}`
          : `grep ${flags} -m ${maxResults} ${shellQuote(pattern)} ${shellQuote(path)}`;
        const grepResult = await runCommandWithStreaming({
          command: grepCmd,
          timeoutMs: 30000,
          context,
          streaming,
        });

        if (grepResult.exitCode !== 0 && !grepResult.stdout.trim()) {
          return { matches: [], count: 0 };
        }
        const parsed = parseGrepMatches(grepResult.stdout);
        return { matches: parsed, count: parsed.length };
      },
    }),
  };
}

export function createGlobTool(getConfig?: () => AppConfig): ToolDefinition {
  return {
    name: 'glob',
    description: 'Find files matching a glob pattern in a directory.',
    inputSchema: z.object({
      pattern: z.string().describe('Glob pattern (e.g. "**/*.ts", "src/**/*.tsx")'),
      path: z.string().describe('Root directory to search from'),
      maxResults: z.number().optional().describe('Maximum results (default: 100)'),
    }),
    execute: async (input, context) => runToolExecution({
      context,
      run: async (signal) => {
        throwIfAborted(signal);
        const { pattern, path: rootPath, maxResults = 100 } = input as {
          pattern: string; path: string; maxResults?: number;
        };
        const streaming = getConfig ? resolveProcessStreamingConfig(getConfig()) : DEFAULT_PROCESS_STREAMING_CONFIG;

        if (!(await pathExists(rootPath))) return { error: `Path not found: ${rootPath}`, isError: true };
        throwIfAborted(signal);

        const normalizedPattern = pattern.replace(/\*\*\//g, '');
        const cmd = `find ${shellQuote(rootPath)} -type f -name ${shellQuote(normalizedPattern)} 2>/dev/null | head -${Math.max(1, Math.floor(maxResults))}`;
        const result = await runCommandWithStreaming({
          command: cmd,
          timeoutMs: 15000,
          context,
          streaming,
        });

        if (result.exitCode !== 0 && !result.stdout.trim()) return { files: [], count: 0 };
        const files = result.stdout.split('\n').filter(Boolean);
        return { files, count: files.length };
      },
    }),
  };
}

export function createListDirectoryTool(): ToolDefinition {
  return {
    name: 'list_directory',
    description: 'List files and directories at a path with metadata (size, type, modified date).',
    inputSchema: z.object({
      path: z.string().describe('Directory path to list'),
      showHidden: z.boolean().optional().describe('Include hidden files (default: false)'),
    }),
    execute: async (input, context) => runToolExecution({
      context,
      timeoutMs: 15000,
      run: async (signal) => {
        throwIfAborted(signal);
        const { path: dirPath, showHidden = false } = input as { path: string; showHidden?: boolean };

        if (!(await pathExists(dirPath))) return { error: `Path not found: ${dirPath}`, isError: true };
        throwIfAborted(signal);

        const entries = await readdir(dirPath);
        const sliced = entries
          .filter((name) => showHidden || !name.startsWith('.'))
          .slice(0, 500);

        const items = await Promise.all(sliced.map(async (name) => {
          try {
            const fullPath = join(dirPath, name);
            const info = await stat(fullPath);
            return {
              name,
              type: info.isDirectory() ? 'directory' : 'file',
              size: info.size,
              modified: info.mtime.toISOString(),
            };
          } catch {
            return { name, type: 'unknown', size: 0, modified: '' };
          }
        }));

        return { items, count: items.length, path: dirPath };
      },
    }),
  };
}
