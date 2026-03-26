import { BrowserWindow, screen } from 'electron';
import { join } from 'node:path';
import type { ComputerDisplayLayout, ComputerOverlayState } from '../../shared/computer-use.js';

/**
 * Storage: sessionId → Map<displayKey, BrowserWindow>
 * Each session can have one overlay per display.
 */
const overlayWindows = new Map<string, Map<string, BrowserWindow>>();

function loadOverlayRoute(win: BrowserWindow, query: Record<string, string>): void {
  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  const rendererHtmlPath = join(__dirname, '../renderer/index.html');

  if (rendererUrl) {
    const targetUrl = new URL(rendererUrl);
    for (const [key, value] of Object.entries(query)) {
      targetUrl.searchParams.set(key, value);
    }
    void win.loadURL(targetUrl.toString());
    return;
  }

  void win.loadFile(rendererHtmlPath, { query });
}

function safelySend(win: BrowserWindow, channel: string, data: unknown): void {
  try {
    if (!win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
      win.webContents.send(channel, data);
    }
  } catch {
    // Window or frame was disposed between our check and the send — ignore.
  }
}

function getSessionWindows(sessionId: string): Map<string, BrowserWindow> {
  let windowMap = overlayWindows.get(sessionId);
  if (!windowMap) {
    windowMap = new Map();
    overlayWindows.set(sessionId, windowMap);
  }
  return windowMap;
}

function createSingleOverlay(
  sessionId: string,
  displayKey: string,
  bounds: { x: number; y: number; width: number; height: number },
): BrowserWindow {
  const preloadPath = join(__dirname, '../preload/index.mjs');
  const win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    frame: false,
    transparent: true,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    focusable: false,
    enableLargerThanScreen: true,
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Click-through so user can interact with the desktop underneath
  win.setIgnoreMouseEvents(true, { forward: true });

  // Place above all normal windows, menu bar, and dock
  win.setAlwaysOnTop(true, 'screen-saver');

  // Force full-display bounds (bypass work area constraints)
  win.setBounds(bounds);

  // Exclude from window menu and app switcher
  win.excludedFromShownWindowsMenu = true;

  loadOverlayRoute(win, { overlay: '1', sessionId, overlayDisplayId: displayKey });

  win.once('ready-to-show', () => {
    win.showInactive();
  });

  win.on('closed', () => {
    const windowMap = overlayWindows.get(sessionId);
    if (windowMap) {
      windowMap.delete(displayKey);
      if (windowMap.size === 0) overlayWindows.delete(sessionId);
    }
  });

  return win;
}

/**
 * Create overlay window(s) for a session. Creates one overlay per connected
 * display using Electron's screen API (always available, no frame capture needed).
 * If a displayLayout is provided, uses its display IDs as keys; otherwise uses
 * Electron display IDs. Skips displays that already have an overlay.
 */
export function createOverlayWindow(
  sessionId: string,
  _config: { position: 'top' | 'bottom'; heightPx: number; opacity: number },
  displayLayout?: ComputerDisplayLayout,
): BrowserWindow {
  const windowMap = getSessionWindows(sessionId);

  // Always create overlays for ALL connected displays using Electron's screen API
  const electronDisplays = screen.getAllDisplays();

  let firstWin: BrowserWindow | null = null;
  for (let i = 0; i < electronDisplays.length; i++) {
    const ed = electronDisplays[i];
    // Use the Electron display ID as the key (same as CGDirectDisplayID on macOS)
    const displayKey = String(ed.id);

    // Skip if overlay already exists for this display
    const existing = windowMap.get(displayKey);
    if (existing && !existing.isDestroyed()) {
      if (!firstWin) firstWin = existing;
      continue;
    }

    const bounds = {
      x: ed.bounds.x,
      y: ed.bounds.y,
      width: ed.bounds.width,
      height: ed.bounds.height,
    };
    const win = createSingleOverlay(sessionId, displayKey, bounds);
    windowMap.set(displayKey, win);
    if (!firstWin) firstWin = win;
  }

  // Clean up any orphaned overlays for displays that no longer exist
  const currentDisplayKeys = new Set(electronDisplays.map((ed) => String(ed.id)));
  for (const [key, win] of windowMap) {
    if (!currentDisplayKeys.has(key) && !win.isDestroyed()) {
      win.destroy();
      windowMap.delete(key);
    }
  }

  return firstWin ?? (() => {
    // Absolute fallback: create on primary
    const pd = screen.getPrimaryDisplay();
    const win = createSingleOverlay(sessionId, 'primary', pd.bounds);
    windowMap.set('primary', win);
    return win;
  })();
}

/**
 * Send updated session state to all overlay renderer processes for a session.
 * Each overlay receives the state with its own overlayDisplayId set.
 * Cursor is only shown on the overlay that matches the cursor's displayIndex.
 * frameWidth/frameHeight in state already reflect the cursor's target display.
 */
export function updateOverlayState(sessionId: string, state: ComputerOverlayState): void {
  const windowMap = overlayWindows.get(sessionId);
  if (!windowMap) return;

  const cursorDisplayIndex = state.cursor?.displayIndex ?? 0;
  const displays = state.displayLayout?.displays;
  const electronDisplays = screen.getAllDisplays();

  for (const [displayKey, win] of windowMap) {
    if (win.isDestroyed()) continue;

    // Find this overlay's display info from layout or Electron
    const thisDisplay = displays?.find((d) => d.displayId === displayKey);
    const thisElectronDisplay = electronDisplays.find((ed) => String(ed.id) === displayKey);
    const thisDisplayIndex = thisDisplay?.displayIndex ?? electronDisplays.indexOf(thisElectronDisplay!);

    // Only show cursor on the overlay that matches the cursor's target display
    const cursorForOverlay = state.cursor?.visible && cursorDisplayIndex === thisDisplayIndex
      ? state.cursor
      : state.cursor ? { ...state.cursor, visible: false } : undefined;

    // Screen dimensions for this overlay's display
    const overlayScreenWidth = thisDisplay?.logicalWidth ?? thisElectronDisplay?.bounds.width ?? state.screenWidth;
    const overlayScreenHeight = thisDisplay?.logicalHeight ?? thisElectronDisplay?.bounds.height ?? state.screenHeight;

    safelySend(win, 'computer-use:overlay-state', {
      ...state,
      overlayDisplayId: displayKey,
      cursor: cursorForOverlay,
      screenWidth: overlayScreenWidth,
      screenHeight: overlayScreenHeight,
    });
  }
}

/**
 * Hide all overlay windows for a session completely from the compositor.
 * This ensures screencapture will NOT capture them.
 */
export async function hideOverlayForCapture(sessionId: string): Promise<void> {
  const windowMap = overlayWindows.get(sessionId);
  if (!windowMap) return;

  let anyHidden = false;
  for (const win of windowMap.values()) {
    if (!win.isDestroyed() && win.isVisible()) {
      win.hide();
      anyHidden = true;
    }
  }

  if (anyHidden) {
    // Wait one+ compositor frame so the windows are fully removed from macOS window server
    await new Promise((resolve) => setTimeout(resolve, 32));
  }
}

/**
 * Re-show all overlay windows after a screenshot capture completes.
 */
export function showOverlayAfterCapture(sessionId: string): void {
  const windowMap = overlayWindows.get(sessionId);
  if (!windowMap) return;

  for (const win of windowMap.values()) {
    if (!win.isDestroyed()) {
      win.showInactive();
    }
  }
}

/**
 * Destroy all overlay windows for a session.
 */
export function closeOverlayWindow(sessionId: string): void {
  const windowMap = overlayWindows.get(sessionId);
  overlayWindows.delete(sessionId);
  if (!windowMap) return;

  for (const win of windowMap.values()) {
    if (!win.isDestroyed()) {
      win.destroy();
    }
  }
}

/**
 * Destroy all overlay windows across all sessions. Called during app quit.
 */
export function closeAllOverlayWindows(): void {
  for (const [sessionId, windowMap] of overlayWindows) {
    overlayWindows.delete(sessionId);
    for (const win of windowMap.values()) {
      if (!win.isDestroyed()) {
        win.destroy();
      }
    }
  }
}

export function hasOverlayWindow(sessionId: string): boolean {
  const windowMap = overlayWindows.get(sessionId);
  if (!windowMap) return false;
  for (const win of windowMap.values()) {
    if (!win.isDestroyed()) return true;
  }
  return false;
}
