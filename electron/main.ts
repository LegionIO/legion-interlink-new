import { app, BrowserWindow, ipcMain, shell, Menu, nativeTheme, dialog, net, MenuItem, clipboard, systemPreferences } from 'electron';
import { join } from 'path';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { readEffectiveConfig, registerConfigHandlers } from './ipc/config.js';
import { registerAgentHandlers, registerTools, updateMcpTools, updateSkillTools, updatePluginTools, getRegisteredTools } from './ipc/agent.js';
import { registerConversationHandlers } from './ipc/conversations.js';
import { buildToolRegistry } from './tools/registry.js';
import { registerMcpHandlers } from './ipc/mcp.js';
import { registerMemoryHandlers } from './ipc/memory.js';
import { rebuildMcpTools } from './tools/mcp-client.js';
import { loadSkillsAsTools } from './tools/skill-loader.js';
import { registerSkillsHandlers } from './ipc/skills.js';
import { registerDaemonSettingsHandlers } from './ipc/daemon-settings.js';
import { registerDaemonApiHandlers } from './ipc/daemon-api.js';
import { PluginManager } from './plugins/plugin-manager.js';
import { registerPluginHandlers } from './ipc/plugins.js';
import { registerMicRecorderHandlers, cleanupMicRecorder } from './audio/mic-recorder.js';
import { registerLiveSttHandlers } from './audio/live-stt.js';
import { registerRealtimeHandlers, updateActiveRealtimeSessionTools } from './ipc/realtime.js';
import type { LegionConfig } from './config/schema.js';
import { registerComputerUseHandlers } from './ipc/computer-use.js';
import { closeAllOverlayWindows } from './computer-use/overlay-window.js';

const LEGION_HOME = join(homedir(), '.legionio');

// Set app name early so macOS menu bar and dock show "Legion Interlink" instead of "Electron"
app.setName('Legion Interlink');

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

// Module-level ref for cleanup in before-quit handler
let pluginManagerRef: PluginManager | null = null;

function ensureLegionHome(): void {
  const dirs = [
    LEGION_HOME,
    join(LEGION_HOME, 'data'),
    join(LEGION_HOME, 'settings'),
    join(LEGION_HOME, 'skills'),
    join(LEGION_HOME, 'plugins'),
    join(LEGION_HOME, 'certs'),
  ];
  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}

function applyTheme(): void {
  try {
    const config = readEffectiveConfig(LEGION_HOME);
    const theme = config?.ui?.theme;
    if (theme === 'dark') nativeTheme.themeSource = 'dark';
    else if (theme === 'light') nativeTheme.themeSource = 'light';
    else nativeTheme.themeSource = 'system';
  } catch {
    nativeTheme.themeSource = 'system';
  }
}

function buildMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Settings…',
          accelerator: 'Cmd+,',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            if (win) win.webContents.send('menu:open-settings');
          },
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        {
          label: 'Find',
          accelerator: 'Cmd+F',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            if (win) win.webContents.send('menu:find');
          },
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom', label: 'Maximize' },
        { role: 'close' },
        { type: 'separator' },
        { role: 'front' },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Resolve the app icon — works in both dev and packaged builds
const APP_ICON = join(__dirname, '../../build/icon.png');
const IS_MAC = process.platform === 'darwin';

function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    title: 'Legion Interlink',
    icon: APP_ICON,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 15, y: 10 },
    transparent: IS_MAC,
    vibrancy: IS_MAC ? 'sidebar' : undefined,
    visualEffectState: IS_MAC ? 'active' : undefined,
    backgroundColor: IS_MAC ? '#00000000' : (nativeTheme.shouldUseDarkColors ? '#1a1a1a' : '#ffffff'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Grant microphone permission for speech dictation
  mainWindow.webContents.session.setPermissionRequestHandler((_webContents, permission, callback) => {
    const allowed = ['media', 'microphone', 'audioCapture'];
    callback(allowed.includes(permission));
  });
  mainWindow.webContents.session.setPermissionCheckHandler((_webContents, permission) => {
    const allowed = ['media', 'microphone', 'audioCapture'];
    return allowed.includes(permission);
  });

  // Default right-click context menu
  mainWindow.webContents.on('context-menu', (_event, params) => {
    const menu = new Menu();

    // Image context menu
    if (params.mediaType === 'image' && params.srcURL) {
      menu.append(new MenuItem({
        label: 'Copy Image',
        click: () => mainWindow.webContents.copyImageAt(params.x, params.y),
      }));
      menu.append(new MenuItem({
        label: 'Copy Image URL',
        click: () => clipboard.writeText(params.srcURL),
      }));
      menu.append(new MenuItem({
        label: 'Save Image As\u2026',
        click: async () => {
          try {
            const defaultName = params.srcURL.split('/').pop()?.split('?')[0] || 'image.png';
            const result = await dialog.showSaveDialog(mainWindow, {
              defaultPath: defaultName,
              filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] }],
            });
            if (!result.canceled && result.filePath) {
              const resp = await net.fetch(params.srcURL);
              if (resp.ok) {
                const buffer = Buffer.from(await resp.arrayBuffer());
                writeFileSync(result.filePath, buffer);
              }
            }
          } catch { /* ignore save errors */ }
        },
      }));
      if (params.selectionText) {
        menu.append(new MenuItem({ type: 'separator' }));
        menu.append(new MenuItem({ role: 'copy' }));
      }
    } else if (params.isEditable) {
      // Spellcheck suggestions
      if (params.misspelledWord) {
        if (params.dictionarySuggestions.length > 0) {
          for (const suggestion of params.dictionarySuggestions) {
            menu.append(new MenuItem({
              label: suggestion,
              click: () => mainWindow.webContents.replaceMisspelling(suggestion),
            }));
          }
        } else {
          menu.append(new MenuItem({ label: 'No suggestions', enabled: false }));
        }
        menu.append(new MenuItem({ type: 'separator' }));
        menu.append(new MenuItem({
          label: 'Add to Dictionary',
          click: () => mainWindow.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord),
        }));
        menu.append(new MenuItem({ type: 'separator' }));
      }
      // Editable field context menu
      menu.append(new MenuItem({ role: 'undo' }));
      menu.append(new MenuItem({ role: 'redo' }));
      menu.append(new MenuItem({ type: 'separator' }));
      menu.append(new MenuItem({ role: 'cut' }));
      menu.append(new MenuItem({ role: 'copy' }));
      menu.append(new MenuItem({ role: 'paste' }));
      menu.append(new MenuItem({ type: 'separator' }));
      menu.append(new MenuItem({ role: 'selectAll' }));
    } else {
      // Text selection context menu
      if (params.selectionText) {
        menu.append(new MenuItem({ role: 'copy' }));
      }
      menu.append(new MenuItem({ role: 'selectAll' }));
    }

    // Link items (appended to any menu type)
    if (params.linkURL) {
      menu.append(new MenuItem({ type: 'separator' }));
      menu.append(new MenuItem({
        label: 'Open Link',
        click: () => shell.openExternal(params.linkURL),
      }));
      menu.append(new MenuItem({
        label: 'Copy Link',
        click: () => clipboard.writeText(params.linkURL),
      }));
    }

    if (menu.items.length > 0) {
      menu.popup({ window: mainWindow });
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show();
  });

  return mainWindow;
}

function focusPrimaryWindow(): void {
  const win = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
  if (!win) {
    if (app.isReady()) createWindow();
    return;
  }

  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();
  win.focus();
}

// Enable speech recognition API (required for webkitSpeechRecognition in Electron)
app.commandLine.appendSwitch('enable-speech-api');
app.commandLine.appendSwitch('enable-speech-dispatcher');

if (gotSingleInstanceLock) {
  app.on('second-instance', () => {
    focusPrimaryWindow();
  });

  app.whenReady().then(() => {
    ensureLegionHome();
    applyTheme();
    buildMenu();

    // Request microphone permission on macOS (needed for speech-to-text dictation)
    if (process.platform === 'darwin') {
      systemPreferences.askForMediaAccess('microphone').then((granted) => {
        console.info(`[Legion] Microphone permission: ${granted ? 'granted' : 'denied'}`);
      }).catch((err) => {
        console.warn('[Legion] Failed to request microphone permission:', err);
      });
    }

    // Set dock icon (macOS) — needed for dev mode since packager config doesn't apply
    if (process.platform === 'darwin' && app.dock && existsSync(APP_ICON)) {
      app.dock.setIcon(APP_ICON);
    }

    // Config reader (used by tools and OAuth)
    const getConfig = () => readEffectiveConfig(LEGION_HOME);

    // Track last mcpServers fingerprint to detect changes
    let lastMcpFingerprint = JSON.stringify(getConfig().mcpServers ?? []);
    let lastSkillsFingerprint = JSON.stringify(getConfig().skills?.enabled ?? []);
    let lastDisplayFingerprint = JSON.stringify(getConfig().computerUse?.localMacos?.allowedDisplays ?? []);
    const syncRealtimeTools = (): void => {
      updateActiveRealtimeSessionTools(getRegisteredTools());
    };

    const handleConfigChanged = (config: LegionConfig) => {
      // MCP hot-reload
      const newMcpFp = JSON.stringify(config.mcpServers ?? []);
      if (newMcpFp !== lastMcpFingerprint) {
        lastMcpFingerprint = newMcpFp;
        console.info('[Legion] MCP servers changed, rebuilding...');
        rebuildMcpTools(config.mcpServers ?? []).then((mcpTools) => {
          updateMcpTools(mcpTools);
          syncRealtimeTools();
          console.info(`[Legion] MCP hot-reload complete: ${mcpTools.length} MCP tools`);
        }).catch((err) => {
          console.error('[Legion] MCP hot-reload failed:', err);
        });
      }

      // Skills hot-reload
      const newSkillsFp = JSON.stringify(config.skills?.enabled ?? []);
      if (newSkillsFp !== lastSkillsFingerprint) {
        lastSkillsFingerprint = newSkillsFp;
        const skillsDir = config.skills?.directory || join(LEGION_HOME, 'skills');
        const skillTools = loadSkillsAsTools(skillsDir, config.skills?.enabled ?? [], getConfig);
        updateSkillTools(skillTools);
        syncRealtimeTools();
        console.info(`[Legion] Skills hot-reload complete: ${skillTools.length} skill tools`);
      }

      // Display list change detection — auto-update maxDimension when allowed displays change
      const newDisplayFp = JSON.stringify(config.computerUse?.localMacos?.allowedDisplays ?? []);
      if (newDisplayFp !== lastDisplayFingerprint) {
        lastDisplayFingerprint = newDisplayFp;
        const allowedDisplays = config.computerUse?.localMacos?.allowedDisplays ?? [];
        if (allowedDisplays.length > 0 && process.platform === 'darwin') {
          void (async () => {
            try {
              const { getLocalMacDisplayLayout } = await import('./computer-use/permissions.js');
              const layout = await getLocalMacDisplayLayout();
              if (!layout || layout.displays.length === 0) return;
              const allowedLower = new Set(allowedDisplays.map((n: string) => n.toLowerCase()));
              const enabled = layout.displays.filter((d: { name: string; displayId: string }) =>
                allowedLower.has(d.name.toLowerCase()) || allowedLower.has(d.displayId.toLowerCase()),
              );
              if (enabled.length === 0) return;
              const maxDim = Math.max(
                ...enabled.map((d: { pixelWidth: number; pixelHeight: number }) => Math.max(d.pixelWidth, d.pixelHeight)),
              );
              if (maxDim > 0 && maxDim !== config.computerUse?.capture?.maxDimension) {
                setConfig('computerUse.capture.maxDimension', maxDim);
                console.info(`[Legion] Auto-updated maxDimension to ${maxDim} for ${enabled.length} enabled displays`);
              }
            } catch {
              // Non-fatal
            }
          })();
        }
      }

      // Plugin config change forwarding
      pluginManager.onConfigChanged(config);
    };

    // Register IPC handlers
    const { setConfig } = registerConfigHandlers(ipcMain, LEGION_HOME, handleConfigChanged);
    registerAgentHandlers(ipcMain, LEGION_HOME);
    registerConversationHandlers(ipcMain, LEGION_HOME, getConfig);
    registerMcpHandlers(ipcMain);
    registerMemoryHandlers(ipcMain, LEGION_HOME, getConfig);
    registerSkillsHandlers(ipcMain, LEGION_HOME);
    registerDaemonSettingsHandlers(ipcMain, LEGION_HOME, getConfig);
    registerDaemonApiHandlers(ipcMain, LEGION_HOME, getConfig, () => BrowserWindow.getAllWindows());
    registerMicRecorderHandlers(ipcMain);
    registerLiveSttHandlers(ipcMain);
    registerComputerUseHandlers(ipcMain, LEGION_HOME, getConfig);

    // Auto-seed computer use display settings on startup.
    // If allowedDisplays is empty, populate it with all discovered displays
    // and set capture.maxDimension to the largest pixel dimension.
    (async () => {
      try {
        if (process.platform !== 'darwin') return;
        const config = getConfig();
        const currentDisplays = config.computerUse?.localMacos?.allowedDisplays ?? [];
        if (currentDisplays.length > 0) return; // Already seeded

        const { getLocalMacDisplayLayout } = await import('./computer-use/permissions.js');
        const layout = await getLocalMacDisplayLayout();
        if (!layout || layout.displays.length === 0) return;

        const allNames = layout.displays.map((d: { name: string }) => d.name);
        setConfig('computerUse.localMacos.allowedDisplays', allNames);

        const maxDim = Math.max(
          ...layout.displays.map((d: { pixelWidth: number; pixelHeight: number }) => Math.max(d.pixelWidth, d.pixelHeight)),
        );
        if (maxDim > 0) {
          setConfig('computerUse.capture.maxDimension', maxDim);
        }
        console.info(`[Legion] Auto-seeded ${allNames.length} displays, maxDimension=${maxDim}`);
      } catch (err) {
        console.warn('[Legion] Display auto-seed failed (non-fatal):', err);
      }
    })();

    // Plugin system
    const pluginManager = new PluginManager(
      join(LEGION_HOME, 'plugins'),
      LEGION_HOME,
      getConfig,
      setConfig, // Unified setConfig that handles models.* persistence correctly
    );
    registerPluginHandlers(ipcMain, pluginManager);
    pluginManagerRef = pluginManager;

    // Listen for plugin tool changes before plugin activation so early registrations are not missed
    pluginManager.onToolsChanged((pluginTools) => {
      updatePluginTools(pluginTools);
      syncRealtimeTools();
    });

    // Load plugins (async — required plugins will show blocking modals when renderer loads)
    pluginManager.loadAll().then(() => {
      console.info(`[Legion] ${pluginManager.getPluginCount()} plugins loaded`);
    }).catch((err) => {
      console.error('[Legion] Plugin loading failed:', err);
    });

    // File dialog handler
    ipcMain.handle('dialog:open-file', async (_event, options?: { filters?: Array<{ name: string; extensions: string[] }> }) => {
      const win = BrowserWindow.getFocusedWindow();
      if (!win) return { canceled: true, filePaths: [] };
      const result = await dialog.showOpenDialog(win, {
        properties: ['openFile', 'multiSelections'],
        filters: options?.filters ?? [
          { name: 'All Files', extensions: ['*'] },
          { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] },
          { name: 'Documents', extensions: ['pdf', 'txt', 'md', 'json', 'csv'] },
        ],
      });
      if (result.canceled) return { canceled: true, filePaths: [] };

      // Read files and return as base64 data URLs
      const files = result.filePaths.map((filePath) => {
        const data = readFileSync(filePath);
        const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
        const mimeTypes: Record<string, string> = {
          png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
          webp: 'image/webp', svg: 'image/svg+xml', pdf: 'application/pdf',
          txt: 'text/plain', md: 'text/markdown', json: 'application/json', csv: 'text/csv',
        };
        const mime = mimeTypes[ext] ?? 'application/octet-stream';
        const isImage = mime.startsWith('image/');
        return {
          path: filePath,
          name: filePath.split('/').pop() ?? filePath,
          mime,
          isImage,
          size: data.length,
          dataUrl: `data:${mime};base64,${data.toString('base64')}`,
          // For text files, also include raw text
          ...(mime.startsWith('text/') || mime === 'application/json'
            ? { text: data.toString('utf-8') }
            : {}),
        };
      });
      return { canceled: false, files };
    });

    // Fetch image bytes from main process (bypasses CORS)
    ipcMain.handle('image:fetch', async (_event, url: string) => {
      try {
        const resp = await net.fetch(url);
        if (!resp.ok) return { error: `HTTP ${resp.status}` };
        const buffer = Buffer.from(await resp.arrayBuffer());
        const mime = resp.headers.get('content-type') || 'image/png';
        return { data: buffer.toString('base64'), mime };
      } catch (err) {
        return { error: String(err) };
      }
    });

    // Save image to disk via save dialog
    ipcMain.handle('image:save', async (_event, url: string, suggestedName?: string) => {
      const win = BrowserWindow.getFocusedWindow();
      if (!win) return { canceled: true };

      const ext = (suggestedName?.split('.').pop() ?? 'png').toLowerCase();
      const result = await dialog.showSaveDialog(win, {
        defaultPath: suggestedName || 'image.png',
        filters: [
          { name: 'Images', extensions: [ext, 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });
      if (result.canceled || !result.filePath) return { canceled: true };

      try {
        const resp = await net.fetch(url);
        if (!resp.ok) return { error: `HTTP ${resp.status}` };
        const buffer = Buffer.from(await resp.arrayBuffer());
        writeFileSync(result.filePath, buffer);
        return { canceled: false, filePath: result.filePath };
      } catch (err) {
        return { error: String(err) };
      }
    });

    createWindow();

    // Initialize tools asynchronously
    buildToolRegistry(getConfig, LEGION_HOME).then((tools) => {
      const pluginTools = pluginManager.getAllPluginTools();
      const allTools = [...tools, ...pluginTools];
      registerTools(allTools);
      console.info(`[Legion] ${tools.length} tools + ${pluginTools.length} plugin tools registered`);

      // Register realtime handlers (needs tool registry)
      registerRealtimeHandlers(ipcMain, getConfig, getRegisteredTools, LEGION_HOME);
    }).catch((err) => {
      console.error('[Legion] Failed to build tool registry:', err);
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  // Best-effort plugin cleanup (don't block quit on failures)
  pluginManagerRef?.unloadAll().catch((err) => {
    console.error('[Legion] Plugin cleanup error:', err);
  });
  cleanupMicRecorder();
  closeAllOverlayWindows();
});
