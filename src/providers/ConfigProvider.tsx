import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { app } from '@/lib/ipc-client';

type AppConfig = Record<string, unknown>;

type ConfigContextValue = {
  config: AppConfig | null;
  updateConfig: (path: string, value: unknown) => Promise<void>;
};

const ConfigContext = createContext<ConfigContextValue>({
  config: null,
  updateConfig: async () => {},
});

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<AppConfig | null>(null);

  useEffect(() => {
    try {
      // Load initial config
      app.config.get()
        .then((cfg) => setConfig(cfg as AppConfig))
        .catch((err) => console.error('[Config] Failed to load:', err));

      // Listen for config changes
      const unsubscribe = app.config.onChanged((cfg) => {
        setConfig(cfg as AppConfig);
      });

      return unsubscribe;
    } catch (err) {
      console.error('[Config] IPC bridge not available:', err);
    }
  }, []);

  const updateConfig = async (path: string, value: unknown) => {
    try {
      const updated = await app.config.set(path, value);
      setConfig(updated as AppConfig);
    } catch (err) {
      console.error('[Config] Failed to update:', err);
    }
  };

  return (
    <ConfigContext.Provider value={{ config, updateConfig }}>
      {children}
    </ConfigContext.Provider>
  );
}

export function useConfig() {
  return useContext(ConfigContext);
}
