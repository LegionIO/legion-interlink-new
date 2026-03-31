import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { createHmac, randomUUID } from 'crypto';
import type { AppConfig } from '../config/schema.js';

export type DaemonResult<T = unknown> = { ok: boolean; data?: T; error?: string };

export const DAEMON_TIMEOUT_MS = 5000;

export function resolveDaemonUrl(config: AppConfig): string {
  return config.runtime?.daemon?.daemonUrl?.trim() || 'http://127.0.0.1:4567';
}

export function resolveAuthToken(config: AppConfig, appHome: string): string | null {
  const configDir = config.runtime?.daemon?.configDir?.trim() || join(appHome, 'settings');
  const cryptPath = join(configDir, 'crypt.json');
  if (!existsSync(cryptPath)) return null;

  try {
    const raw = JSON.parse(readFileSync(cryptPath, 'utf-8')) as { crypt?: { cluster_secret?: string } };
    const secret = raw.crypt?.cluster_secret?.trim();
    if (!secret) return null;

    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      sub: process.env.USER || process.env.USERNAME || __BRAND_AGENT_ID,
      name: __BRAND_PRODUCT_NAME,
      roles: ['desktop'],
      scope: 'human',
      iss: __BRAND_JWT_ISSUER,
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

export function authHeaders(config: AppConfig, appHome: string): Record<string, string> {
  const token = resolveAuthToken(config, appHome);
  return {
    'accept': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export function withTimeout(ms = DAEMON_TIMEOUT_MS): { signal: AbortSignal } {
  return { signal: AbortSignal.timeout(ms) };
}

export async function daemonGet<T = unknown>(
  config: AppConfig,
  appHome: string,
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
    const resp = await fetch(url.toString(), { headers: authHeaders(config, appHome), ...withTimeout() });
    if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` };
    const body = await resp.json() as { data?: T };
    return { ok: true, data: (body.data ?? body) as T };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function daemonPost<T = unknown>(
  config: AppConfig,
  appHome: string,
  path: string,
  body: unknown,
): Promise<DaemonResult<T>> {
  const base = resolveDaemonUrl(config);
  try {
    const resp = await fetch(new URL(path, base).toString(), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(config, appHome) },
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

export async function daemonPatch<T = unknown>(
  config: AppConfig,
  appHome: string,
  path: string,
  body: unknown,
): Promise<DaemonResult<T>> {
  const base = resolveDaemonUrl(config);
  try {
    const resp = await fetch(new URL(path, base).toString(), {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...authHeaders(config, appHome) },
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

export async function daemonPut<T = unknown>(
  config: AppConfig,
  appHome: string,
  path: string,
  body: unknown,
): Promise<DaemonResult<T>> {
  const base = resolveDaemonUrl(config);
  try {
    const resp = await fetch(new URL(path, base).toString(), {
      method: 'PUT',
      headers: { 'content-type': 'application/json', ...authHeaders(config, appHome) },
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

export async function daemonDelete(
  config: AppConfig,
  appHome: string,
  path: string,
): Promise<DaemonResult> {
  const base = resolveDaemonUrl(config);
  try {
    const resp = await fetch(new URL(path, base).toString(), {
      method: 'DELETE',
      headers: authHeaders(config, appHome),
      ...withTimeout(),
    });
    if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
