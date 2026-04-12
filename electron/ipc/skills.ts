/**
 * skills IPC handlers — delegates all skill operations to the Legion daemon.
 *
 * All skill execution, registration, and state management is now daemon-side.
 * This file exposes read-only list/describe and cancel operations only.
 */
import type { IpcMain } from 'electron';
import type { AppConfig } from '../config/schema.js';
import {
  resolveDaemonUrl,
  authHeaders,
  withTimeout,
} from '../lib/daemon-client.js';

export function registerSkillsHandlers(
  ipcMain: IpcMain,
  appHome: string,
  getConfig: () => AppConfig,
): void {
  ipcMain.handle('skills:list', async () => {
    const config = getConfig();
    const base = resolveDaemonUrl(config);
    const res = await fetch(
      new URL('/api/skills', base).toString(),
      { headers: authHeaders(config, appHome), ...withTimeout() },
    );
    if (!res.ok) {
      const responseText = await res.text();
      throw new Error(
        `skills:list failed: ${res.status}${responseText ? ` - ${responseText}` : ''}`,
      );
    }
    return res.json();
  });

  ipcMain.handle('skills:get', async (_event, name: string) => {
    const config = getConfig();
    const base = resolveDaemonUrl(config);
    const [ns, nm] = name.includes(':') ? name.split(':', 2) : ['default', name];
    const res = await fetch(
      new URL(`/api/skills/${encodeURIComponent(ns)}/${encodeURIComponent(nm)}`, base).toString(),
      { headers: authHeaders(config, appHome), ...withTimeout() },
    );
    if (!res.ok) {
      if (res.status === 404) return { error: `Skill "${name}" not found.` };
      const responseText = await res.text();
      throw new Error(
        `skills:get failed: ${res.status}${responseText ? ` - ${responseText}` : ''}`,
      );
    }
    return res.json();
  });

  // skills:delete and skills:toggle are no longer supported; skills are managed daemon-side.
  // Return success: false to preserve the IPC contract shape expected by the renderer.
  ipcMain.handle('skills:delete', async (_event, _name: string) => {
    return { success: false, error: 'Skill deletion must be performed via the Legion daemon.' };
  });

  ipcMain.handle('skills:toggle', async (_event, _name: string, _enable: boolean) => {
    return { success: false, enabled: _enable, error: 'Skill toggling must be performed via the Legion daemon.' };
  });

  ipcMain.handle('skills:cancel', async (_event, conversationId: string) => {
    const config = getConfig();
    const base = resolveDaemonUrl(config);
    try {
      const res = await fetch(
        new URL(`/api/skills/active/${encodeURIComponent(conversationId)}`, base).toString(),
        { method: 'DELETE', headers: authHeaders(config, appHome), ...withTimeout() },
      );
      return res.ok;
    } catch {
      return false;
    }
  });
}
