import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';

let cachedShellEnv: NodeJS.ProcessEnv | null = null;

function loginShell(): string {
  if (process.platform === 'win32') return process.env.ComSpec || 'cmd.exe';
  return process.env.SHELL || '/bin/zsh';
}

function parseEnvOutput(output: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const line of output.split('\0')) {
    if (!line) continue;
    const index = line.indexOf('=');
    if (index <= 0) continue;
    env[line.slice(0, index)] = line.slice(index + 1);
  }
  return env;
}

function resolveLoginShellEnv(): NodeJS.ProcessEnv {
  if (process.platform === 'win32') return { ...process.env };

  const shell = loginShell();
  const result = spawnSync(shell, ['-l', '-c', 'env -0'], {
    cwd: process.env.HOME || homedir(),
    encoding: 'utf-8',
    env: { ...process.env },
    timeout: 5000,
    stdio: ['ignore', 'pipe', 'ignore'],
  });

  if (result.status !== 0 || !result.stdout) {
    return { ...process.env };
  }

  return {
    ...process.env,
    ...parseEnvOutput(result.stdout),
  };
}

export function getShellEnv(extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (!cachedShellEnv) {
    cachedShellEnv = resolveLoginShellEnv();
  }
  return { ...cachedShellEnv, ...extra };
}

export function getShellPath(): string {
  return getShellEnv().PATH || process.env.PATH || '';
}
