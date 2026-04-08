import React, { createContext, useContext, useEffect, useState, useCallback, useRef, type ReactNode } from 'react';
import { app } from '@/lib/ipc-client';
import { registerPluginComponents, type PluginComponent } from '@/components/plugins/PluginComponentRegistry';

type PluginBannerDescriptor = {
  id: string;
  pluginName: string;
  component?: string;
  text?: string;
  variant?: 'info' | 'warning' | 'error';
  dismissible?: boolean;
  visible: boolean;
  props?: Record<string, unknown>;
};

type PluginModalDescriptor = {
  id: string;
  pluginName: string;
  component: string;
  title?: string;
  closeable: boolean;
  visible: boolean;
  props?: Record<string, unknown>;
};

type PluginSettingsSectionDescriptor = {
  id: string;
  pluginName: string;
  label: string;
  component: string;
  priority?: number;
};

type PluginRendererScript = {
  pluginName: string;
  scriptPath: string;
  scriptContent?: string;
};

export type PluginUIState = {
  banners: PluginBannerDescriptor[];
  modals: PluginModalDescriptor[];
  settingsSections: PluginSettingsSectionDescriptor[];
  rendererScripts: PluginRendererScript[];
  requiredPluginsReady: boolean;
  brandRequiredPluginNames: string[];
};

type ModalCallbackData = {
  pluginName: string;
  modalId: string;
  data: unknown;
};

type PluginContextValue = {
  uiState: PluginUIState | null;
  modalCallbacks: ModalCallbackData[];
  rendererLoadCount: number;
  sendModalAction: (pluginName: string, modalId: string, action: string, data?: unknown) => Promise<unknown>;
  sendBannerAction: (pluginName: string, bannerId: string, action: string, data?: unknown) => Promise<unknown>;
  sendAction: (pluginName: string, targetId: string, action: string, data?: unknown) => Promise<unknown>;
  getPluginConfig: (pluginName: string) => Promise<Record<string, unknown>>;
  setPluginConfig: (pluginName: string, path: string, value: unknown) => Promise<void>;
  consumeModalCallback: (pluginName: string, modalId: string) => ModalCallbackData | null;
};

const PluginContext = createContext<PluginContextValue>({
  uiState: null,
  modalCallbacks: [],
  rendererLoadCount: 0,
  sendModalAction: async () => null,
  sendBannerAction: async () => null,
  sendAction: async () => null,
  getPluginConfig: async () => ({}),
  setPluginConfig: async () => {},
  consumeModalCallback: () => null,
});

/**
 * Dynamically loads renderer scripts declared by plugins.
 * Each script is expected to export a `register` function:
 *
 *   export function register(api) {
 *     const { React, registerComponents } = api;
 *     const h = React.createElement;
 *     registerComponents('pluginName', { ComponentName: (props) => h('div', null, 'Hello') });
 *   }
 *
 * Scripts are loaded once per unique pluginName.
 * The script content is delivered from the main process (avoiding file:// import issues).
 * Calls `onLoaded()` after each successful load so the UI can re-render.
 */
function loadPluginRendererScripts(
  scripts: PluginRendererScript[],
  loadedRef: Set<string>,
  onLoaded: () => void,
): void {
  for (const { pluginName, scriptContent } of scripts) {
    if (loadedRef.has(pluginName) || !scriptContent) continue;
    loadedRef.add(pluginName);

    try {
      // Create a Blob URL from the script content and import it as a module
      const blob = new Blob([scriptContent], { type: 'text/javascript' });
      const url = URL.createObjectURL(blob);

      import(/* @vite-ignore */ url)
        .then((mod) => {
          URL.revokeObjectURL(url);
          if (typeof mod.register === 'function') {
            mod.register({
              React,
              registerComponents: (name: string, components: Record<string, unknown>) => {
                registerPluginComponents(name, components as Record<string, PluginComponent>);
              },
            });
            console.info(`[PluginProvider] Loaded renderer for plugin "${pluginName}"`);
            // Trigger re-render so modals/settings pick up the newly registered components
            onLoaded();
          } else {
            console.warn(`[PluginProvider] Renderer for "${pluginName}" has no register() export`);
          }
        })
        .catch((err) => {
          URL.revokeObjectURL(url);
          console.error(`[PluginProvider] Failed to import renderer for "${pluginName}":`, err);
        });
    } catch (err) {
      console.error(`[PluginProvider] Failed to load renderer for "${pluginName}":`, err);
    }
  }
}

export function PluginProvider({ children }: { children: ReactNode }) {
  const [uiState, setUIState] = useState<PluginUIState | null>(null);
  const [modalCallbacks, setModalCallbacks] = useState<ModalCallbackData[]>([]);
  const [rendererLoadCount, setRendererLoadCount] = useState(0);
  const loadedRenderers = useRef(new Set<string>());

  // Callback to force re-render when a renderer script finishes loading
  const onRendererLoaded = useCallback(() => {
    setRendererLoadCount((c) => c + 1);
  }, []);

  useEffect(() => {
    // Fetch initial UI state
    app.plugins.getUIState()
      .then((state) => {
        const typed = state as PluginUIState;
        setUIState(typed);
        // Load renderer scripts from initial state
        if (typed.rendererScripts?.length) {
          loadPluginRendererScripts(typed.rendererScripts, loadedRenderers.current, onRendererLoaded);
        }
      })
      .catch((err) => console.error('[PluginProvider] Failed to get UI state:', err));

    // Subscribe to changes
    const unsubUI = app.plugins.onUIStateChanged((state) => {
      const typed = state as PluginUIState;
      setUIState(typed);
      // Load any new renderer scripts
      if (typed.rendererScripts?.length) {
        loadPluginRendererScripts(typed.rendererScripts, loadedRenderers.current, onRendererLoaded);
      }
    });

    const unsubCallback = app.plugins.onModalCallback((data) => {
      setModalCallbacks((prev) => [...prev, data as ModalCallbackData]);
    });

    return () => {
      unsubUI();
      unsubCallback();
    };
  }, []);

  const sendModalAction = useCallback(
    (pluginName: string, modalId: string, action: string, data?: unknown) =>
      app.plugins.modalAction(pluginName, modalId, action, data),
    [],
  );

  const sendBannerAction = useCallback(
    (pluginName: string, bannerId: string, action: string, data?: unknown) =>
      app.plugins.bannerAction(pluginName, bannerId, action, data),
    [],
  );

  const sendAction = useCallback(
    (pluginName: string, targetId: string, action: string, data?: unknown) =>
      app.plugins.action(pluginName, targetId, action, data),
    [],
  );

  const getPluginConfig = useCallback(
    (pluginName: string) => app.plugins.getConfig(pluginName),
    [],
  );

  const setPluginConfig = useCallback(
    async (pluginName: string, path: string, value: unknown) => {
      await app.plugins.setConfig(pluginName, path, value);
    },
    [],
  );

  const consumeModalCallback = useCallback(
    (pluginName: string, modalId: string): ModalCallbackData | null => {
      let found: ModalCallbackData | null = null;
      setModalCallbacks((prev) => {
        const idx = prev.findIndex(
          (cb) => cb.pluginName === pluginName && cb.modalId === modalId,
        );
        if (idx >= 0) {
          found = prev[idx];
          return [...prev.slice(0, idx), ...prev.slice(idx + 1)];
        }
        return prev;
      });
      return found;
    },
    [],
  );

  return (
    <PluginContext.Provider
      value={{
        uiState,
        modalCallbacks,
        rendererLoadCount,
        sendModalAction,
        sendBannerAction,
        sendAction,
        getPluginConfig,
        setPluginConfig,
        consumeModalCallback,
      }}
    >
      {children}
    </PluginContext.Provider>
  );
}

export function usePlugins() {
  return useContext(PluginContext);
}
