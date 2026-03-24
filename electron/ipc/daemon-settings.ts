import type { IpcMain } from 'electron';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { createHmac, randomUUID } from 'crypto';
import type { LegionConfig } from '../config/schema.js';

export type DaemonSettings = Record<string, unknown>;

type DaemonSettingsResult = {
  ok: boolean;
  settings?: DaemonSettings;
  error?: string;
};

type DaemonSettingsUpdateResult = {
  ok: boolean;
  error?: string;
};

function resolveDaemonUrl(config: LegionConfig): string {
  return config.runtime?.legion?.daemonUrl?.trim() || 'http://127.0.0.1:4567';
}

function resolveDaemonAuthToken(config: LegionConfig, legionHome: string): string | null {
  const configDir = config.runtime?.legion?.configDir?.trim() || join(legionHome, 'settings');
  const cryptPath = join(configDir, 'crypt.json');
  if (!existsSync(cryptPath)) return null;

  try {
    const raw = JSON.parse(readFileSync(cryptPath, 'utf-8')) as {
      crypt?: { cluster_secret?: string };
    };
    const clusterSecret = raw.crypt?.cluster_secret?.trim();
    if (!clusterSecret) return null;

    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      sub: process.env.USER || process.env.USERNAME || 'legion-interlink',
      name: 'Legion Interlink',
      roles: ['desktop'],
      scope: 'human',
      iss: 'legion',
      iat: now,
      exp: now + 3600,
      jti: randomUUID(),
    })).toString('base64url');
    const signature = createHmac('sha256', clusterSecret)
      .update(`${header}.${payload}`)
      .digest('base64url');
    return `${header}.${payload}.${signature}`;
  } catch {
    return null;
  }
}

async function fetchDaemonSettings(
  config: LegionConfig,
  legionHome: string,
): Promise<DaemonSettingsResult> {
  const daemonUrl = resolveDaemonUrl(config);
  const authToken = resolveDaemonAuthToken(config, legionHome);

  try {
    const response = await fetch(new URL('/api/settings', daemonUrl).toString(), {
      headers: {
        'accept': 'application/json',
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
    });

    if (!response.ok) {
      return { ok: false, error: `Daemon returned HTTP ${response.status}` };
    }

    const body = await response.json() as { data?: DaemonSettings };
    return { ok: true, settings: body.data ?? body as DaemonSettings };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function updateDaemonSetting(
  config: LegionConfig,
  legionHome: string,
  key: string,
  value: unknown,
): Promise<DaemonSettingsUpdateResult> {
  const daemonUrl = resolveDaemonUrl(config);
  const authToken = resolveDaemonAuthToken(config, legionHome);

  try {
    const response = await fetch(new URL(`/api/settings/${key}`, daemonUrl).toString(), {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'accept': 'application/json',
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
      body: JSON.stringify({ [key]: value }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: { message?: string } };
      return {
        ok: false,
        error: body.error?.message || `Daemon returned HTTP ${response.status}`,
      };
    }

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function registerDaemonSettingsHandlers(
  ipcMain: IpcMain,
  legionHome: string,
  getConfig: () => LegionConfig,
): void {
  ipcMain.handle('daemon:settings', async () => {
    return fetchDaemonSettings(getConfig(), legionHome);
  });

  ipcMain.handle('daemon:settings-update', async (_event, key: string, value: unknown) => {
    return updateDaemonSetting(getConfig(), legionHome, key, value);
  });
}
