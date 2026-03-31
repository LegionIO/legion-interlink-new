import type { IpcMain } from 'electron';
import { BrowserWindow, app } from 'electron';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  StartComputerSessionOptions,
  ComputerUseEvent,
  ComputerUsePermissionSection,
  ComputerUseSurface,
} from '../../shared/computer-use.js';
import { getComputerUseManager } from '../computer-use/service.js';
import { getLocalMacDisplayLayout, probeInputMonitoring } from '../computer-use/permissions.js';
import type { AppConfig } from '../config/schema.js';
import { readConversationStore, writeConversationStore, broadcastConversationChange } from './conversations.js';

const execFileAsync = promisify(execFile);

/**
 * Use AppleScript to detect which apps have full-screen windows.
 * Returns an array of app names that are currently full-screened.
 */
async function detectFullScreenApps(): Promise<string[]> {
  if (process.platform !== 'darwin') return [];
  try {
    const script = `
tell application "System Events"
  set fullScreenApps to {}
  repeat with proc in (every application process whose visible is true)
    try
      repeat with w in (every window of proc)
        try
          if value of attribute "AXFullScreen" of w is true then
            set end of fullScreenApps to name of proc
          end if
        end try
      end repeat
    end try
  end repeat
  return fullScreenApps
end tell`;
    const { stdout } = await execFileAsync('osascript', ['-e', script], { timeout: 10000 });
    const trimmed = stdout.trim();
    if (!trimmed) return [];
    // AppleScript returns comma-separated list for multiple, or a single name
    return trimmed.split(', ').map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Use AppleScript to exit full-screen for specific apps.
 */
async function exitFullScreenApps(appNames: string[]): Promise<{ exited: string[]; failed: string[] }> {
  if (process.platform !== 'darwin') return { exited: [], failed: [] };
  const exited: string[] = [];
  const failed: string[] = [];
  for (const appName of appNames) {
    try {
      const script = `tell application "System Events" to tell application process "${appName}"
  repeat with w in (every window)
    try
      if value of attribute "AXFullScreen" of w is true then
        set value of attribute "AXFullScreen" of w to false
      end if
    end try
  end repeat
end tell`;
      await execFileAsync('osascript', ['-e', script], { timeout: 5000 });
      exited.push(appName);
    } catch {
      failed.push(appName);
    }
  }
  // Wait for macOS full-screen exit animations
  if (exited.length > 0) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return { exited, failed };
}

function broadcast(event: ComputerUseEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('computer-use:event', event);
  }
}

/**
 * Find the primary application window (not overlay or operator windows).
 * The main window is the only one that is resizable and focusable.
 */
function findMainWindow(): BrowserWindow | null {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    // Overlays and operator windows are created with resizable: false and/or focusable: false.
    // The main window is resizable and focusable.
    if (win.isResizable() && win.isFocusable()) {
      return win;
    }
  }
  return null;
}

export function registerComputerUseHandlers(
  ipcMain: IpcMain,
  appHome: string,
  getConfig: () => AppConfig,
): void {
  const manager = getComputerUseManager(appHome, getConfig);
  manager.on('event', (event: ComputerUseEvent) => {
    broadcast(event);
  });

  ipcMain.handle('computer-use:start-session', async (_event, goal: string, options: StartComputerSessionOptions) => {
    return manager.startSession(goal, options);
  });
  ipcMain.handle('computer-use:pause-session', (_event, sessionId: string) => manager.pauseSession(sessionId));
  ipcMain.handle('computer-use:resume-session', (_event, sessionId: string) => manager.resumeSession(sessionId));
  ipcMain.handle('computer-use:stop-session', (_event, sessionId: string) => manager.stopSession(sessionId));
  ipcMain.handle('computer-use:approve-action', (_event, sessionId: string, actionId: string) => manager.approveAction(sessionId, actionId));
  ipcMain.handle('computer-use:reject-action', (_event, sessionId: string, actionId: string, reason?: string) => manager.rejectAction(sessionId, actionId, reason));
  ipcMain.handle('computer-use:list-sessions', () => manager.listSessions());
  ipcMain.handle('computer-use:get-session', (_event, sessionId: string) => manager.getSession(sessionId));
  ipcMain.handle('computer-use:set-surface', (_event, sessionId: string, surface: ComputerUseSurface) => manager.setSurface(sessionId, surface));
  ipcMain.handle('computer-use:send-guidance', (_event, sessionId: string, text: string) => manager.sendGuidance(sessionId, text));
  ipcMain.handle('computer-use:update-session-settings', (_event, sessionId: string, settings: { modelKey?: string | null; profileKey?: string | null; fallbackEnabled?: boolean; reasoningEffort?: string }) => manager.updateSessionSettings(sessionId, settings as Parameters<typeof manager.updateSessionSettings>[1]));
  ipcMain.handle('computer-use:continue-session', (_event, sessionId: string, newGoal: string) => manager.continueSession(sessionId, newGoal));
  ipcMain.handle('computer-use:mark-sessions-seen', (_event, conversationId: string) => { manager.markConversationSessionsSeen(conversationId); return { ok: true }; });
  ipcMain.handle('computer-use:open-setup-window', (_event, conversationId?: string | null) => manager.openSetupWindow(conversationId));
  ipcMain.handle('computer-use:get-local-macos-permissions', () => manager.getLocalMacosPermissions());
  ipcMain.handle('computer-use:request-local-macos-permissions', () => manager.requestLocalMacosPermissions());
  ipcMain.handle('computer-use:request-single-local-macos-permission', (_event, section: ComputerUsePermissionSection) => manager.requestSingleLocalMacosPermission(section));
  ipcMain.handle('computer-use:open-local-macos-privacy-settings', (_event, section?: ComputerUsePermissionSection) => manager.openLocalMacosPrivacySettings(section));
  ipcMain.handle('computer-use:probe-input-monitoring', async (_event, timeoutMs?: number) => {
    const granted = await probeInputMonitoring(timeoutMs ?? 3000);
    return { inputMonitoringGranted: granted };
  });

  ipcMain.handle('computer-use:check-fullscreen-apps', async () => {
    const allFullScreen = await detectFullScreenApps();
    const config = getConfig();

    // Apps in the capture exclusion list will produce blank screenshots if full-screened
    const excludedNames = (config.computerUse?.localMacos?.captureExcludedApps ?? [])
      .map((n: string) => n.toLowerCase());

    // Our own app is always excluded by PID, so it's always problematic when full-screened.
    // Use app.getName() so this works regardless of app name.
    const ownName = app.getName().toLowerCase();

    const problematicApps = allFullScreen.filter((fsApp) => {
      const lower = fsApp.toLowerCase();
      // Flag our own app (excluded by PID in screenshots)
      if (lower === ownName || lower.includes(ownName) || ownName.includes(lower)) return true;
      // Flag apps matching the capture exclusion list
      return excludedNames.some((ex) => lower.includes(ex) || ex.includes(lower));
    });

    return { apps: allFullScreen, problematicApps };
  });

  ipcMain.handle('computer-use:exit-fullscreen-apps', async (_event, appNames: string[]) => {
    return exitFullScreenApps(appNames);
  });

  ipcMain.handle('computer-use:list-running-apps', async () => {
    if (process.platform !== 'darwin') return { apps: [] };
    try {
      const script = `tell application "System Events" to get name of every application process whose background only is false`;
      const { stdout } = await execFileAsync('osascript', ['-e', script], { timeout: 10000 });
      const trimmed = stdout.trim();
      if (!trimmed) return { apps: [] };
      const apps = trimmed.split(', ').map((s) => s.trim()).filter(Boolean);
      // Sort alphabetically and deduplicate
      return { apps: [...new Set(apps)].sort((a, b) => a.localeCompare(b)) };
    } catch {
      return { apps: [] };
    }
  });

  ipcMain.handle('computer-use:list-displays', async () => {
    if (process.platform !== 'darwin') return { displays: [] };
    try {
      const layout = await getLocalMacDisplayLayout();
      if (!layout || layout.displays.length === 0) return { displays: [] };
      return {
        displays: layout.displays.map((d) => ({
          name: d.name,
          displayId: d.displayId,
          pixelWidth: d.pixelWidth,
          pixelHeight: d.pixelHeight,
          isPrimary: d.isPrimary,
        })),
      };
    } catch {
      return { displays: [] };
    }
  });

  ipcMain.handle('computer-use:focus-session', (_event, sessionId: string) => {
    const session = manager.getSession(sessionId);
    if (!session) return { ok: false, error: 'Session not found' };

    // Switch active conversation to the one owning this computer-use session
    const store = readConversationStore(appHome);
    if (store.conversations[session.conversationId]) {
      store.activeConversationId = session.conversationId;
      writeConversationStore(appHome, store);
      broadcastConversationChange(store);
    }

    // Focus the main window and tell its renderer to switch to the computer tab
    const mainWin = findMainWindow();
    if (mainWin) {
      if (mainWin.isMinimized()) mainWin.restore();
      if (!mainWin.isVisible()) mainWin.show();
      mainWin.focus();
      mainWin.webContents.send('computer-use:focus-thread');
    }

    return { ok: true };
  });
}
