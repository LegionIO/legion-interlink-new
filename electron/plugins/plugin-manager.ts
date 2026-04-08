import { createHash } from 'crypto';
import { BrowserWindow, dialog } from 'electron';
import { readdirSync, readFileSync, existsSync, statSync } from 'fs';
import { join, relative } from 'path';
import { pathToFileURL } from 'url';
import type {
  PluginManifest,
  PluginInstance,
  PluginModule,
  PluginUIState,
  PluginRendererScript,
  PluginBannerDescriptor,
  PluginModalDescriptor,
  PluginSettingsSectionDescriptor,
  PluginActionPayload,
  PreSendHookArgs,
  PreSendHookResult,
  PostReceiveHookArgs,
  PostReceiveHookResult,
  PluginAPI,
  PluginPermission,
} from './types.js';
import { createPluginAPI, cleanupPluginAPI } from './plugin-api.js';
import type { AppConfig } from '../config/schema.js';
import type { ToolDefinition } from '../tools/types.js';
import { broadcastToAllWindows } from '../utils/window-send.js';

const PLUGIN_PERMISSION_LABELS: Record<PluginPermission, string> = {
  'config:read': 'Read app configuration',
  'config:write': 'Write app configuration',
  'tools:register': 'Register tools the assistant can call',
  'ui:banner': 'Show banner UI in the app',
  'ui:modal': 'Show modal UI in the app',
  'ui:settings': 'Add plugin settings screens',
  'messages:hook': 'Inspect or modify model messages',
};

export class PluginManager {
  private plugins: Map<string, PluginInstance> = new Map();
  private pluginAPIs: Map<string, PluginAPI> = new Map();
  private toolChangeCallback: ((tools: ToolDefinition[]) => void) | null = null;
  private actionHandlers: Map<string, Map<string, (action: string, data?: unknown) => void | Promise<void>>> = new Map();

  constructor(
    private pluginsDir: string,
    private _appHome: string,
    private getConfig: () => AppConfig,
    private setConfig: (path: string, value: unknown) => void,
    private brandRequiredPluginNames: Set<string> = new Set(),
  ) {}

  /* ── Discovery ── */

  private discoverPlugins(): Array<{ manifest: PluginManifest; dir: string }> {
    if (!existsSync(this.pluginsDir)) return [];

    const results: Array<{ manifest: PluginManifest; dir: string }> = [];
    let entries: string[];

    try {
      entries = readdirSync(this.pluginsDir);
    } catch {
      return [];
    }

    for (const entry of entries) {
      const pluginDir = join(this.pluginsDir, entry);
      try {
        if (!statSync(pluginDir).isDirectory()) continue;
      } catch {
        continue;
      }

      const manifestPath = join(pluginDir, 'plugin.json');
      if (!existsSync(manifestPath)) continue;

      try {
        const raw = JSON.parse(readFileSync(manifestPath, 'utf-8'));
        const manifest: PluginManifest = {
          name: raw.name ?? entry,
          displayName: raw.displayName ?? raw.name ?? entry,
          version: raw.version ?? '0.0.0',
          description: raw.description ?? '',
          main: raw.main ?? 'main.js',
          renderer: typeof raw.renderer === 'string' ? raw.renderer : undefined,
          permissions: Array.isArray(raw.permissions) ? raw.permissions : [],
          priority: typeof raw.priority === 'number' ? raw.priority : 100,
          required: raw.required === true || this.brandRequiredPluginNames.has(raw.name ?? entry),
          configSchema: raw.configSchema,
        };
        results.push({ manifest, dir: pluginDir });
      } catch (err) {
        console.warn(`[PluginManager] Failed to read plugin manifest at ${manifestPath}:`, err);
      }
    }

    // Sort by priority (lower = first)
    results.sort((a, b) => a.manifest.priority - b.manifest.priority);
    return results;
  }

  /* ── Loading ── */

  private collectPluginFiles(rootDir: string, currentDir = rootDir): string[] {
    const entries = readdirSync(currentDir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    const files: string[] = [];

    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        files.push(...this.collectPluginFiles(rootDir, fullPath));
        continue;
      }
      if (entry.isFile()) {
        files.push(fullPath);
      }
    }

    return files;
  }

  private computePluginFileHash(dir: string): string {
    const hash = createHash('sha256');
    const files = this.collectPluginFiles(dir);

    for (const filePath of files) {
      const relativePath = relative(dir, filePath).replace(/\\/g, '/');
      hash.update(relativePath);
      hash.update('\0');
      hash.update(readFileSync(filePath));
      hash.update('\0');
    }

    return hash.digest('hex');
  }

  private getPluginApprovals(): AppConfig['pluginApprovals'] {
    return this.getConfig().pluginApprovals ?? {};
  }

  private isPluginApproved(pluginName: string, fileHash: string): boolean {
    return this.getPluginApprovals()[pluginName]?.hash === fileHash;
  }

  private persistPluginApproval(pluginName: string, fileHash: string): void {
    this.setConfig('pluginApprovals', {
      ...this.getPluginApprovals(),
      [pluginName]: {
        hash: fileHash,
        approvedAt: new Date().toISOString(),
      },
    });
  }

  private async ensurePluginApproved(manifest: PluginManifest, fileHash: string): Promise<boolean> {
    if (this.isPluginApproved(manifest.name, fileHash)) {
      return true;
    }

    // Brand-required plugins are auto-approved — no user dialog needed
    if (this.brandRequiredPluginNames.has(manifest.name)) {
      this.persistPluginApproval(manifest.name, fileHash);
      return true;
    }

    const declaredPermissions = manifest.permissions.length > 0
      ? manifest.permissions.map((permission) => `• ${PLUGIN_PERMISSION_LABELS[permission]}`).join('\n')
      : '• This plugin did not declare any permissions in plugin.json.';
    const detail = [
      `Plugin: ${manifest.displayName} (${manifest.name})`,
      `Version: ${manifest.version}`,
      '',
      manifest.description || 'No description provided.',
      '',
      'Declared permissions:',
      declaredPermissions,
      '',
      `Approval fingerprint: ${fileHash.slice(0, 16)}`,
      'This approval is tied to the current plugin files. If the plugin changes, ' + __BRAND_PRODUCT_NAME + ' will ask again before loading it.',
    ].join('\n');

    const messageBoxOptions: Electron.MessageBoxOptions = {
      type: 'warning',
      buttons: ['Allow Plugin', 'Not Now'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
      message: `Allow "${manifest.displayName}" to load?`,
      detail,
    };
    const parentWindow = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const result = parentWindow
      ? await dialog.showMessageBox(parentWindow, messageBoxOptions)
      : await dialog.showMessageBox(messageBoxOptions);

    if (result.response !== 0) {
      return false;
    }

    this.persistPluginApproval(manifest.name, fileHash);
    return true;
  }

  async loadAll(): Promise<void> {
    const discovered = this.discoverPlugins();
    console.info(`[PluginManager] Discovered ${discovered.length} plugins`);

    for (const { manifest, dir } of discovered) {
      await this.loadPlugin(manifest, dir);
    }
  }

  private async loadPlugin(manifest: PluginManifest, dir: string): Promise<void> {
    const instance: PluginInstance = {
      manifest,
      dir,
      fileHash: '',
      state: 'loading',
      module: null,
      registeredTools: [],
      preSendHooks: [],
      postReceiveHooks: [],
      uiBanners: [],
      uiModals: [],
      uiSettingsSections: [],
      configChangeListeners: [],
    };

    this.plugins.set(manifest.name, instance);

    try {
      instance.fileHash = this.computePluginFileHash(dir);
      if (!(await this.ensurePluginApproved(manifest, instance.fileHash))) {
        instance.state = 'disabled';
        instance.error = 'Plugin permission approval is required before it can be loaded.';
        this.broadcastUIState();
        this.notifyToolsChanged();
        console.info(`[PluginManager] Plugin "${manifest.name}" is awaiting approval and was not loaded`);
        return;
      }

      const mainPath = join(dir, manifest.main);
      if (!existsSync(mainPath)) {
        throw new Error(`Plugin entry point not found: ${mainPath}`);
      }

      // Dynamic import the plugin module
      const moduleUrl = pathToFileURL(mainPath).href;
      const mod = await import(moduleUrl) as PluginModule;
      instance.module = mod;

      // Create scoped API
      const api = createPluginAPI(instance, {
        getConfig: () => this.getConfig(),
        setConfig: (path, value) => this.setConfig(path, value),
        onUIStateChanged: () => this.broadcastUIState(),
        onToolsChanged: () => this.notifyToolsChanged(),
        registerActionHandler: (targetId, handler) => {
          this.registerActionHandler(manifest.name, targetId, handler);
        },
      });
      this.pluginAPIs.set(manifest.name, api);

      // Activate
      if (typeof mod.activate === 'function') {
        await mod.activate(api);
      }

      instance.state = 'active';
      instance.error = undefined;
      this.broadcastUIState();
      this.notifyToolsChanged();
      console.info(`[PluginManager] Plugin "${manifest.name}" activated (priority=${manifest.priority}, required=${manifest.required})`);
    } catch (err) {
      instance.state = 'error';
      instance.error = err instanceof Error ? err.message : String(err);
      this.broadcastUIState();
      this.notifyToolsChanged();
      console.error(`[PluginManager] Failed to load plugin "${manifest.name}":`, err);
    }
  }

  /* ── Unloading ── */

  async unloadAll(): Promise<void> {
    // Reverse priority order for cleanup
    const sorted = [...this.plugins.entries()].sort(
      ([, a], [, b]) => b.manifest.priority - a.manifest.priority,
    );

    for (const [name, instance] of sorted) {
      try {
        if (instance.module?.deactivate) {
          await instance.module.deactivate();
        }
        const api = this.pluginAPIs.get(name);
        if (api) {
          await cleanupPluginAPI(api);
        }
      } catch (err) {
        console.error(`[PluginManager] Error deactivating plugin "${name}":`, err);
      }
    }

    this.plugins.clear();
    this.pluginAPIs.clear();
    this.actionHandlers.clear();
    this.notifyToolsChanged();
  }

  /* ── Config Change Forwarding ── */

  onConfigChanged(config: AppConfig): void {
    for (const [name, instance] of this.plugins) {
      if (instance.state !== 'active') continue;

      // Call module's onConfigChanged
      try {
        instance.module?.onConfigChanged?.(config);
      } catch (err) {
        console.error(`[PluginManager] Error in plugin "${name}" onConfigChanged:`, err);
      }

      // Call registered listeners
      for (const listener of instance.configChangeListeners) {
        try {
          listener(config);
        } catch (err) {
          console.error(`[PluginManager] Error in plugin "${name}" config listener:`, err);
        }
      }
    }
  }

  /* ── Tool Aggregation ── */

  getAllPluginTools(): ToolDefinition[] {
    const tools: ToolDefinition[] = [];
    for (const instance of this.plugins.values()) {
      if (instance.state !== 'active') continue;
      tools.push(...instance.registeredTools);
    }
    return tools;
  }

  onToolsChanged(callback: (tools: ToolDefinition[]) => void): void {
    this.toolChangeCallback = callback;
    callback(this.getAllPluginTools());
  }

  private notifyToolsChanged(): void {
    this.toolChangeCallback?.(this.getAllPluginTools());
  }

  /* ── Message Hooks ── */

  async runPreSendHooks(args: PreSendHookArgs): Promise<PreSendHookResult> {
    let result: PreSendHookResult = { messages: args.messages };

    for (const instance of this.plugins.values()) {
      if (instance.state !== 'active') continue;
      for (const hook of instance.preSendHooks) {
        try {
          result = await hook({ ...args, messages: result.messages });
          if (result.abort) return result;
        } catch (err) {
          console.error(`[PluginManager] Pre-send hook error in "${instance.manifest.name}":`, err);
        }
      }
    }

    return result;
  }

  async runPostReceiveHooks(args: PostReceiveHookArgs): Promise<PostReceiveHookResult> {
    let result: PostReceiveHookResult = { response: args.response };

    for (const instance of this.plugins.values()) {
      if (instance.state !== 'active') continue;
      for (const hook of instance.postReceiveHooks) {
        try {
          result = await hook({ ...args, response: result.response });
        } catch (err) {
          console.error(`[PluginManager] Post-receive hook error in "${instance.manifest.name}":`, err);
        }
      }
    }

    return result;
  }

  /* ── UI State ── */

  getUIState(): PluginUIState {
    const banners: PluginBannerDescriptor[] = [];
    const modals: PluginModalDescriptor[] = [];
    const settingsSections: PluginSettingsSectionDescriptor[] = [];
    const rendererScripts: PluginRendererScript[] = [];
    let requiredPluginsReady = true;

    for (const instance of this.plugins.values()) {
      if ((instance.state === 'error' || instance.state === 'disabled') && instance.manifest.required) {
        requiredPluginsReady = false;
      }

      banners.push(...instance.uiBanners);
      modals.push(...instance.uiModals);
      settingsSections.push(...instance.uiSettingsSections);

      // Collect renderer scripts only for plugins that are allowed to run.
      // Loading plugins are included so the renderer can register components before activate() completes.
      if (instance.state !== 'disabled' && instance.state !== 'error' && instance.manifest.renderer) {
        const scriptPath = join(instance.dir, instance.manifest.renderer);
        if (existsSync(scriptPath)) {
          try {
            const scriptContent = readFileSync(scriptPath, 'utf-8');
            rendererScripts.push({
              pluginName: instance.manifest.name,
              scriptPath,
              scriptContent,
            });
          } catch (err) {
            console.warn(`[PluginManager] Failed to read renderer for "${instance.manifest.name}":`, err);
          }
        }
      }

      // A required plugin with a visible uncloseable modal means it's not ready
      if (instance.manifest.required) {
        const hasBlockingModal = instance.uiModals.some((m) => m.visible && !m.closeable);
        if (hasBlockingModal) {
          requiredPluginsReady = false;
        }
      }
    }

    // Sort settings sections by priority
    settingsSections.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));

    // A brand-required plugin that wasn't even discovered means it's not installed
    for (const requiredName of this.brandRequiredPluginNames) {
      if (!this.plugins.has(requiredName)) {
        requiredPluginsReady = false;
        break;
      }
    }

    return { banners, modals, settingsSections, rendererScripts, requiredPluginsReady, brandRequiredPluginNames: [...this.brandRequiredPluginNames] };
  }

  private broadcastUIState(): void {
    const state = this.getUIState();
    broadcastToAllWindows('plugin:ui-state-changed', state);
  }

  /* ── Actions (renderer → main) ── */

  registerActionHandler(
    pluginName: string,
    targetId: string,
    handler: (action: string, data?: unknown) => void | Promise<void>,
  ): void {
    let pluginHandlers = this.actionHandlers.get(pluginName);
    if (!pluginHandlers) {
      pluginHandlers = new Map();
      this.actionHandlers.set(pluginName, pluginHandlers);
    }
    pluginHandlers.set(targetId, handler);
  }

  async handleAction(payload: PluginActionPayload): Promise<unknown> {
    const handler = this.actionHandlers.get(payload.pluginName)?.get(payload.targetId);
    if (handler) {
      return handler(payload.action, payload.data);
    }
    console.warn(`[PluginManager] No action handler for ${payload.pluginName}:${payload.targetId}`);
    return { error: 'No handler registered' };
  }

  /* ── Send callback data to renderer modal ── */

  sendModalCallback(pluginName: string, modalId: string, data: unknown): void {
    broadcastToAllWindows('plugin:modal-callback', { pluginName, modalId, data });
  }

  /* ── Queries ── */

  getPluginCount(): number {
    return this.plugins.size;
  }

  listPlugins(): Array<{
    name: string;
    displayName: string;
    version: string;
    description: string;
    state: string;
    required: boolean;
    brandRequired: boolean;
    error?: string;
  }> {
    return [...this.plugins.values()].map((instance) => ({
      name: instance.manifest.name,
      displayName: instance.manifest.displayName,
      version: instance.manifest.version,
      description: instance.manifest.description,
      state: instance.state,
      required: instance.manifest.required,
      brandRequired: this.brandRequiredPluginNames.has(instance.manifest.name),
      error: instance.error,
    }));
  }

  getPluginConfig(pluginName: string): Record<string, unknown> {
    const config = this.getConfig();
    const plugins = (config as Record<string, unknown>).plugins as Record<string, Record<string, unknown>> | undefined;
    return plugins?.[pluginName] ?? {};
  }

  setPluginConfig(pluginName: string, path: string, value: unknown): void {
    this.setConfig(`plugins.${pluginName}.${path}`, value);
  }
}
