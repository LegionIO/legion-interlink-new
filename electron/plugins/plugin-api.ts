import { shell, BrowserWindow } from 'electron';
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'http';
import { URL } from 'url';
import { z } from 'zod';
import type {
  PluginAPI,
  PluginInstance,
  PluginBannerDescriptor,
  PluginModalDescriptor,
  PluginSettingsSectionDescriptor,
  PluginAuthWindowOptions,
  PluginAuthResult,
  PreSendHook,
  PostReceiveHook,
  PluginHttpRequest,
  PluginHttpResponse,
} from './types.js';
import type { AppConfig } from '../config/schema.js';
import type { ToolDefinition } from '../tools/types.js';
import { buildScopedToolName, getScopedToolPrefix } from '../tools/naming.js';
import { convertJsonSchemaToZod } from '../tools/skill-loader.js';

type PluginAPICallbacks = {
  getConfig: () => AppConfig;
  setConfig: (path: string, value: unknown) => void;
  onUIStateChanged: () => void;
  onToolsChanged: () => void;
  registerActionHandler: (targetId: string, handler: (action: string, data?: unknown) => void | Promise<void>) => void;
};

function isZodSchema(schema: unknown): schema is z.ZodTypeAny {
  return Boolean(
    schema
    && typeof schema === 'object'
    && typeof (schema as { safeParse?: unknown }).safeParse === 'function',
  );
}

function normalizePluginTool(tool: ToolDefinition): ToolDefinition {
  const rawSchema = tool.inputSchema as unknown;
  const inputSchema = isZodSchema(rawSchema)
    ? rawSchema
    : rawSchema && typeof rawSchema === 'object'
      ? convertJsonSchemaToZod(rawSchema as Record<string, unknown>)
      : z.object({}).passthrough();

  return {
    ...tool,
    inputSchema,
  };
}

function resolvePluginToolOriginalName(pluginName: string, tool: ToolDefinition): string {
  if (tool.source === 'plugin' && tool.sourceId === pluginName && tool.originalName) {
    return tool.originalName;
  }

  const legacyPrefix = `plugin:${pluginName}:`;
  if (tool.name.startsWith(legacyPrefix)) {
    return tool.name.slice(legacyPrefix.length);
  }

  const safePrefix = getScopedToolPrefix('plugin', pluginName);
  if (tool.name.startsWith(safePrefix)) {
    return tool.name.slice(safePrefix.length);
  }

  return tool.originalName ?? tool.name;
}

export function createPluginAPI(
  instance: PluginInstance,
  callbacks: PluginAPICallbacks,
): PluginAPI {
  const { manifest } = instance;
  let httpServer: Server | null = null;

  const api: PluginAPI = {
    pluginName: manifest.name,
    pluginDir: instance.dir,

    /* ── Config ── */

    config: {
      get: () => callbacks.getConfig(),

      set: (path: string, value: unknown) => {
        callbacks.setConfig(path, value);
      },

      getPluginData: () => {
        const config = callbacks.getConfig();
        const plugins = (config as Record<string, unknown>).plugins as Record<string, Record<string, unknown>> | undefined;
        return plugins?.[manifest.name] ?? {};
      },

      setPluginData: (path: string, value: unknown) => {
        callbacks.setConfig(`plugins.${manifest.name}.${path}`, value);
      },

      onChanged: (callback: (config: AppConfig) => void) => {
        instance.configChangeListeners.push(callback);
        return () => {
          const idx = instance.configChangeListeners.indexOf(callback);
          if (idx >= 0) instance.configChangeListeners.splice(idx, 1);
        };
      },
    },

    /* ── Tools ── */

    tools: {
      register: (tools: ToolDefinition[]) => {
        const prefixed = tools.map((tool) => normalizePluginTool(tool)).map((tool) => {
          const originalName = resolvePluginToolOriginalName(manifest.name, tool);

          return {
            ...tool,
            name: buildScopedToolName('plugin', manifest.name, originalName),
            source: 'plugin' as const,
            sourceId: manifest.name,
            originalName,
            aliases: Array.from(new Set([
              ...(tool.aliases ?? []),
              tool.name,
              `plugin:${manifest.name}:${originalName}`,
            ])),
          };
        });
        const newNames = new Set(prefixed.map((tool) => tool.name));
        instance.registeredTools = instance.registeredTools.filter((tool) => !newNames.has(tool.name));
        instance.registeredTools.push(...prefixed);
        callbacks.onToolsChanged();
      },

      unregister: (toolNames: string[]) => {
        const fullNames = new Set(
          toolNames.flatMap((name) => {
            const originalName = name.startsWith(`plugin:${manifest.name}:`)
              ? name.slice(`plugin:${manifest.name}:`.length)
              : name;

            return [
              name,
              `plugin:${manifest.name}:${originalName}`,
              buildScopedToolName('plugin', manifest.name, originalName),
            ];
          }),
        );
        instance.registeredTools = instance.registeredTools.filter(
          (t) => !fullNames.has(t.name) && !(t.aliases?.some((alias) => fullNames.has(alias))),
        );
        callbacks.onToolsChanged();
      },
    },

    /* ── Message Hooks ── */

    messages: {
      registerPreSendHook: (hook: PreSendHook) => {
        instance.preSendHooks.push(hook);
      },

      registerPostReceiveHook: (hook: PostReceiveHook) => {
        instance.postReceiveHooks.push(hook);
      },
    },

    /* ── UI ── */

    ui: {
      showBanner: (descriptor: Omit<PluginBannerDescriptor, 'pluginName'>) => {
        const full: PluginBannerDescriptor = { ...descriptor, pluginName: manifest.name };
        const idx = instance.uiBanners.findIndex((b) => b.id === descriptor.id);
        if (idx >= 0) {
          instance.uiBanners[idx] = full;
        } else {
          instance.uiBanners.push(full);
        }
        callbacks.onUIStateChanged();
      },

      hideBanner: (id: string) => {
        const idx = instance.uiBanners.findIndex((b) => b.id === id);
        if (idx >= 0) {
          instance.uiBanners[idx] = { ...instance.uiBanners[idx], visible: false };
          callbacks.onUIStateChanged();
        }
      },

      showModal: (descriptor: Omit<PluginModalDescriptor, 'pluginName'>) => {
        const full: PluginModalDescriptor = { ...descriptor, pluginName: manifest.name };
        const idx = instance.uiModals.findIndex((m) => m.id === descriptor.id);
        if (idx >= 0) {
          instance.uiModals[idx] = full;
        } else {
          instance.uiModals.push(full);
        }
        callbacks.onUIStateChanged();
      },

      hideModal: (id: string) => {
        const idx = instance.uiModals.findIndex((m) => m.id === id);
        if (idx >= 0) {
          instance.uiModals[idx] = { ...instance.uiModals[idx], visible: false };
          callbacks.onUIStateChanged();
        }
      },

      updateModal: (id: string, updates: Partial<Omit<PluginModalDescriptor, 'id' | 'pluginName'>>) => {
        const idx = instance.uiModals.findIndex((m) => m.id === id);
        if (idx >= 0) {
          instance.uiModals[idx] = { ...instance.uiModals[idx], ...updates };
          callbacks.onUIStateChanged();
        }
      },

      registerSettingsSection: (descriptor: Omit<PluginSettingsSectionDescriptor, 'pluginName'>) => {
        const full: PluginSettingsSectionDescriptor = { ...descriptor, pluginName: manifest.name };
        const idx = instance.uiSettingsSections.findIndex((s) => s.id === descriptor.id);
        if (idx >= 0) {
          instance.uiSettingsSections[idx] = full;
        } else {
          instance.uiSettingsSections.push(full);
        }
        callbacks.onUIStateChanged();
      },
    },

    /* ── Logging ── */

    log: {
      info: (...args: unknown[]) => console.info(`[Plugin:${manifest.name}]`, ...args),
      warn: (...args: unknown[]) => console.warn(`[Plugin:${manifest.name}]`, ...args),
      error: (...args: unknown[]) => console.error(`[Plugin:${manifest.name}]`, ...args),
    },

    /* ── Shell ── */

    shell: {
      openExternal: (url: string) => shell.openExternal(url),
    },

    /* ── Auth (in-app browser for OAuth flows) ── */

    auth: {
      openAuthWindow: (options: PluginAuthWindowOptions): Promise<PluginAuthResult> => {
        const {
          url,
          callbackMatch,
          title = 'Sign In',
          width = 620,
          height = 720,
          timeoutMs = 300_000,
          successMessage,
          extractParams,
        } = options;

        return new Promise((resolve) => {
          let settled = false;

          const authWin = new BrowserWindow({
            width,
            height,
            show: true,
            title,
            webPreferences: {
              nodeIntegration: false,
              contextIsolation: true,
            },
          });

          const timeout = setTimeout(() => {
            if (!settled) {
              settled = true;
              try { authWin.close(); } catch { /* ignore */ }
              resolve({ success: false, error: 'Authentication timed out' });
            }
          }, timeoutMs);

          const handleRedirect = (_event: Electron.Event, redirectUrl: string) => {
            if (settled || !redirectUrl.includes(callbackMatch)) return;
            settled = true;
            clearTimeout(timeout);

            try {
              const parsed = new URL(redirectUrl);
              const params: Record<string, string> = {};
              parsed.searchParams.forEach((value, key) => {
                if (!extractParams || extractParams.includes(key)) {
                  params[key] = value;
                }
              });

              // Show success confirmation page in the auth window
              const successHtml = successMessage || `
                <html>
                <body style="font-family: system-ui; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #1a1a2e; color: #e0e0e0;">
                  <div style="text-align: center;">
                    <h2 style="color: #4ade80;">&#10003; Authentication Successful</h2>
                    <p>You can close this window and return to the application.</p>
                  </div>
                </body>
                </html>
              `;
              authWin.loadURL(`data:text/html,${encodeURIComponent(successHtml)}`);
              setTimeout(() => {
                try { authWin.close(); } catch { /* ignore */ }
              }, 2000);

              resolve({ success: true, params });
            } catch (err) {
              try { authWin.close(); } catch { /* ignore */ }
              resolve({ success: false, error: err instanceof Error ? err.message : String(err) });
            }
          };

          authWin.webContents.on('will-redirect', handleRedirect);
          authWin.webContents.on('will-navigate', handleRedirect);

          authWin.loadURL(url).catch((err) => {
            if (!settled) {
              settled = true;
              clearTimeout(timeout);
              try { authWin.close(); } catch { /* ignore */ }
              resolve({ success: false, error: `Failed to load auth URL: ${err.message}` });
            }
          });

          authWin.once('close', () => {
            if (!settled) {
              settled = true;
              clearTimeout(timeout);
              resolve({ success: false, error: 'Auth window closed by user' });
            }
          });
        });
      },
    },

    /* ── HTTP (for OAuth callback servers) ── */

    http: {
      listen: (port: number, handler) => {
        return new Promise<void>((resolve, reject) => {
          if (httpServer) {
            reject(new Error('HTTP server already running for this plugin'));
            return;
          }

          httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
            try {
              const parsedUrl = new URL(req.url ?? '/', `http://localhost:${port}`);
              const query: Record<string, string> = {};
              parsedUrl.searchParams.forEach((value, key) => {
                query[key] = value;
              });

              const headers: Record<string, string> = {};
              for (const [key, value] of Object.entries(req.headers)) {
                if (typeof value === 'string') headers[key] = value;
              }

              // Read body
              let body = '';
              if (req.method !== 'GET' && req.method !== 'HEAD') {
                body = await new Promise<string>((resolveBody) => {
                  const chunks: Buffer[] = [];
                  req.on('data', (chunk: Buffer) => chunks.push(chunk));
                  req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf-8')));
                });
              }

              const pluginReq: PluginHttpRequest = {
                method: req.method ?? 'GET',
                url: parsedUrl.pathname,
                headers,
                query,
                body: body || undefined,
              };

              const pluginRes: PluginHttpResponse = await handler(pluginReq);

              res.writeHead(pluginRes.status ?? 200, {
                'Content-Type': 'text/html',
                ...pluginRes.headers,
              });
              res.end(pluginRes.body ?? '');
            } catch (err) {
              console.error(`[Plugin:${manifest.name}] HTTP handler error:`, err);
              res.writeHead(500);
              res.end('Internal plugin error');
            }
          });

          httpServer.listen(port, '127.0.0.1', () => {
            console.info(`[Plugin:${manifest.name}] HTTP server listening on 127.0.0.1:${port}`);
            resolve();
          });

          httpServer.on('error', reject);
        });
      },

      close: () => {
        return new Promise<void>((resolve) => {
          if (!httpServer) {
            resolve();
            return;
          }
          httpServer.close(() => {
            httpServer = null;
            resolve();
          });
        });
      },
    },

    /* ── Action handlers ── */

    onAction: (targetId: string, handler: (action: string, data?: unknown) => void | Promise<void>) => {
      callbacks.registerActionHandler(targetId, handler);
    },

    /* ── Fetch ── */

    fetch: globalThis.fetch,
  };

  return api;
}

/** Cleanup HTTP server when plugin is deactivated */
export async function cleanupPluginAPI(api: PluginAPI): Promise<void> {
  try {
    await api.http.close();
  } catch {
    // Ignore cleanup errors
  }
}
