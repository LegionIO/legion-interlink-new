import type { IpcMain } from 'electron';
import type { LegionConfig } from '../config/schema.js';
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
  config: LegionConfig,
  legionHome: string,
): Promise<DaemonSettingsResult> {
  const result = await daemonGet<DaemonSettings>(config, legionHome, '/api/settings');
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, settings: result.data };
}

async function updateDaemonSetting(
  config: LegionConfig,
  legionHome: string,
  key: string,
  value: unknown,
): Promise<DaemonSettingsUpdateResult> {
  const result = await daemonPut(config, legionHome, `/api/settings/${key}`, { [key]: value });
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true };
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
