import type { IpcMain } from 'electron';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { createHmac, randomUUID } from 'crypto';
import type { LegionConfig } from '../config/schema.js';

type DaemonResult<T = unknown> = { ok: boolean; data?: T; error?: string };

function resolveDaemonUrl(config: LegionConfig): string {
  return config.runtime?.legion?.daemonUrl?.trim() || 'http://127.0.0.1:4567';
}

function resolveAuthToken(config: LegionConfig, legionHome: string): string | null {
  const configDir = config.runtime?.legion?.configDir?.trim() || join(legionHome, 'settings');
  const cryptPath = join(configDir, 'crypt.json');
  if (!existsSync(cryptPath)) return null;

  try {
    const raw = JSON.parse(readFileSync(cryptPath, 'utf-8')) as { crypt?: { cluster_secret?: string } };
    const secret = raw.crypt?.cluster_secret?.trim();
    if (!secret) return null;

    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      sub: process.env.USER || 'legion-interlink',
      name: 'Legion Interlink',
      roles: ['desktop'],
      scope: 'human',
      iss: 'legion',
      iat: now,
      exp: now + 3600,
      jti: randomUUID(),
    })).toString('base64url');
    const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
    return `${header}.${payload}.${signature}`;
  } catch {
    return null;
  }
}

function authHeaders(config: LegionConfig, legionHome: string): Record<string, string> {
  const token = resolveAuthToken(config, legionHome);
  return {
    'accept': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

const DAEMON_TIMEOUT_MS = 5000;

function withTimeout(ms = DAEMON_TIMEOUT_MS): { signal: AbortSignal } {
  return { signal: AbortSignal.timeout(ms) };
}

async function daemonGet<T = unknown>(
  config: LegionConfig,
  legionHome: string,
  path: string,
  query?: Record<string, string>,
): Promise<DaemonResult<T>> {
  const base = resolveDaemonUrl(config);
  const url = new URL(path, base);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v) url.searchParams.set(k, v);
    }
  }

  try {
    const resp = await fetch(url.toString(), { headers: authHeaders(config, legionHome), ...withTimeout() });
    if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` };
    const body = await resp.json() as { data?: T };
    return { ok: true, data: (body.data ?? body) as T };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function daemonPost<T = unknown>(
  config: LegionConfig,
  legionHome: string,
  path: string,
  body: unknown,
): Promise<DaemonResult<T>> {
  const base = resolveDaemonUrl(config);
  try {
    const resp = await fetch(new URL(path, base).toString(), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(config, legionHome) },
      body: JSON.stringify(body),
      ...withTimeout(),
    });
    if (!resp.ok) {
      const errBody = await resp.json().catch(() => ({})) as { error?: { message?: string } };
      return { ok: false, error: errBody.error?.message || `HTTP ${resp.status}` };
    }
    const data = await resp.json().catch(() => ({})) as { data?: T };
    return { ok: true, data: (data.data ?? data) as T };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function daemonDelete(
  config: LegionConfig,
  legionHome: string,
  path: string,
): Promise<DaemonResult> {
  const base = resolveDaemonUrl(config);
  try {
    const resp = await fetch(new URL(path, base).toString(), {
      method: 'DELETE',
      headers: authHeaders(config, legionHome),
      ...withTimeout(),
    });
    if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function registerKnowledgeHandlers(
  ipcMain: IpcMain,
  legionHome: string,
  getConfig: () => LegionConfig,
): void {
  const cfg = () => getConfig();

  ipcMain.handle('knowledge:query', async (_e, query: string, scope?: string, synthesize?: boolean) =>
    daemonPost(cfg(), legionHome, '/api/apollo/query', { query, scope, synthesize }));

  ipcMain.handle('knowledge:retrieve', async (_e, query: string, scope?: string, limit?: number) =>
    daemonPost(cfg(), legionHome, '/api/apollo/retrieve', { query, scope, limit }));

  ipcMain.handle('knowledge:browse', async (_e, filters?: { tag?: string; source?: string; page?: string; per_page?: string }) => {
    const query: Record<string, string> = {};
    if (filters?.tag) query['tag'] = filters.tag;
    if (filters?.source) query['source'] = filters.source;
    if (filters?.page) query['page'] = filters.page;
    if (filters?.per_page) query['per_page'] = filters.per_page;
    return daemonGet(cfg(), legionHome, '/api/apollo/entries', query);
  });

  ipcMain.handle('knowledge:delete', async (_e, id: string) =>
    daemonDelete(cfg(), legionHome, `/api/apollo/entries/${id}`));

  ipcMain.handle('knowledge:ingest', async (_e, content: string, metadata?: Record<string, unknown>) =>
    daemonPost(cfg(), legionHome, '/api/apollo/ingest', { content, ...metadata }));

  ipcMain.handle('knowledge:ingest-file', async (_e, filePath: string) => {
    try {
      const data = readFileSync(filePath);
      const encoded = data.toString('base64');
      return daemonPost(cfg(), legionHome, '/api/lex/knowledge/ingest', {
        file: encoded,
        path: filePath,
      });
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('knowledge:monitors-list', async () =>
    daemonGet(cfg(), legionHome, '/api/lex/knowledge/monitors'));

  ipcMain.handle('knowledge:monitor-add', async (_e, path: string) =>
    daemonPost(cfg(), legionHome, '/api/lex/knowledge/monitors', { path }));

  ipcMain.handle('knowledge:monitor-remove', async (_e, id: string) =>
    daemonDelete(cfg(), legionHome, `/api/lex/knowledge/monitors/${id}`));

  ipcMain.handle('knowledge:monitor-scan', async (_e, id: string) =>
    daemonPost(cfg(), legionHome, `/api/lex/knowledge/monitors/${id}/scan`, {}));

  ipcMain.handle('knowledge:health', async () =>
    daemonGet(cfg(), legionHome, '/api/lex/knowledge/health'));

  ipcMain.handle('knowledge:maintain', async () =>
    daemonPost(cfg(), legionHome, '/api/lex/knowledge/maintain', {}));

  ipcMain.handle('knowledge:status', async () =>
    daemonGet(cfg(), legionHome, '/api/apollo/status'));
}
