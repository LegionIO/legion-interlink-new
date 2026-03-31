import type { IpcMain } from 'electron';
import type { AppConfig } from '../config/schema.js';
import { daemonGet, daemonPut } from '../lib/daemon-client.js';

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

async function fetchDaemonSettings(
  config: AppConfig,
  appHome: string,
): Promise<DaemonSettingsResult> {
  const result = await daemonGet<DaemonSettings>(config, appHome, '/api/settings');
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, settings: result.data };
}

async function updateDaemonSetting(
  config: AppConfig,
  appHome: string,
  key: string,
  value: unknown,
): Promise<DaemonSettingsUpdateResult> {
  const result = await daemonPut(config, appHome, `/api/settings/${key}`, { [key]: value });
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true };
}

export function registerDaemonSettingsHandlers(
  ipcMain: IpcMain,
  appHome: string,
  getConfig: () => AppConfig,
): void {
  ipcMain.handle('daemon:settings', async () => {
    return fetchDaemonSettings(getConfig(), appHome);
  });

  ipcMain.handle('daemon:settings-update', async (_event, key: string, value: unknown) => {
    return updateDaemonSetting(getConfig(), appHome, key, value);
  });
}
