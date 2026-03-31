import { BrowserWindow } from 'electron';
import { join } from 'node:path';

const operatorWindows = new Map<string, BrowserWindow>();
const setupWindows = new Map<string, BrowserWindow>();
const DEFAULT_SETUP_KEY = '__default__';

function getSetupWindowKey(conversationId?: string | null): string {
  return conversationId?.trim() || DEFAULT_SETUP_KEY;
}

function createOperatorBrowserWindow(title: string): BrowserWindow {
  const preloadPath = join(__dirname, '../preload/index.mjs');
  return new BrowserWindow({
    width: 1280,
    height: 900,
    title,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
}

function revealWindow(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function loadOperatorRoute(win: BrowserWindow, query: Record<string, string>): void {
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

export function openComputerSetupWindow(conversationId?: string | null): BrowserWindow {
  const setupKey = getSetupWindowKey(conversationId);
  const existing = setupWindows.get(setupKey);
  if (existing && !existing.isDestroyed()) {
    revealWindow(existing);
    return existing;
  }

  const win = createOperatorBrowserWindow(__BRAND_PRODUCT_NAME + ' Computer Setup');
  loadOperatorRoute(win, {
    operator: '1',
    setup: '1',
    ...(conversationId ? { conversationId } : {}),
  });

  win.on('closed', () => {
    setupWindows.delete(setupKey);
  });
  setupWindows.set(setupKey, win);
  revealWindow(win);
  return win;
}

export function openOperatorWindow(
  sessionId: string,
  onClosed?: () => void,
  options?: { conversationId?: string | null },
): BrowserWindow {
  const existing = operatorWindows.get(sessionId);
  if (existing && !existing.isDestroyed()) {
    revealWindow(existing);
    return existing;
  }

  const setupKey = getSetupWindowKey(options?.conversationId);
  const setupWindow = setupWindows.get(setupKey)
    ?? (setupKey !== DEFAULT_SETUP_KEY ? setupWindows.get(DEFAULT_SETUP_KEY) : undefined);
  const win = setupWindow && !setupWindow.isDestroyed()
    ? setupWindow
    : createOperatorBrowserWindow(__BRAND_PRODUCT_NAME + ' Operator');

  if (setupWindow && !setupWindow.isDestroyed()) {
    setupWindows.delete(setupKey);
    setupWindows.delete(DEFAULT_SETUP_KEY);
    win.setTitle(__BRAND_PRODUCT_NAME + ' Operator');
  }

  loadOperatorRoute(win, { operator: '1', sessionId });

  win.on('closed', () => {
    operatorWindows.delete(sessionId);
    onClosed?.();
  });
  operatorWindows.set(sessionId, win);
  revealWindow(win);
  return win;
}

export function closeOperatorWindow(sessionId: string): void {
  const win = operatorWindows.get(sessionId);
  operatorWindows.delete(sessionId);
  if (win && !win.isDestroyed()) win.close();
}
