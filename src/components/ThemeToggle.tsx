import { useState, useEffect, useCallback, type FC } from 'react';
import { MonitorIcon, SunIcon, MoonIcon } from 'lucide-react';
import { Tooltip } from '@/components/ui/Tooltip';
import { app } from '@/lib/ipc-client';

type ThemeMode = 'system' | 'light' | 'dark';

const STORAGE_KEY = __BRAND_APP_SLUG + '-theme';

function getStoredTheme(): ThemeMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch { /* ignore */ }
  return 'system';
}

function applyTheme(mode: ThemeMode): void {
  const isDark =
    mode === 'dark' ||
    (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  if (isDark) {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
}

const icons: Record<ThemeMode, FC<{ className?: string }>> = {
  system: MonitorIcon,
  light: SunIcon,
  dark: MoonIcon,
};

const titles: Record<ThemeMode, string> = {
  system: 'Theme: System',
  light: 'Theme: Light',
  dark: 'Theme: Dark',
};

const cycle: ThemeMode[] = ['system', 'light', 'dark'];

export const ThemeToggle: FC = () => {
  const [mode, setMode] = useState<ThemeMode>(getStoredTheme);

  // Apply theme on mode change + persist to both localStorage and config
  useEffect(() => {
    applyTheme(mode);
    try { localStorage.setItem(STORAGE_KEY, mode); } catch { /* ignore */ }
    try { app.config.set('ui.theme', mode); } catch { /* ignore */ }
  }, [mode]);

  // On mount, sync from config if localStorage is empty
  useEffect(() => {
    app.config.get().then((cfg) => {
      const configTheme = (cfg as { ui?: { theme?: string } })?.ui?.theme;
      if (configTheme === 'light' || configTheme === 'dark' || configTheme === 'system') {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (!stored) {
          setMode(configTheme);
        }
      }
    }).catch(() => {});
  }, []);

  // Subscribe to system theme changes when in system mode
  useEffect(() => {
    if (mode !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => applyTheme('system');
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [mode]);

  const toggle = useCallback(() => {
    setMode((prev) => {
      const idx = cycle.indexOf(prev);
      return cycle[(idx + 1) % cycle.length];
    });
  }, []);

  const Icon = icons[mode];

  return (
    <Tooltip content={titles[mode]} side="top" sideOffset={6}>
      <button
        type="button"
        onClick={toggle}
        className="titlebar-no-drag rounded-xl p-1.5 transition-colors hover:bg-sidebar-accent"
      >
        <Icon className="h-[18px] w-[18px] text-muted-foreground" />
      </button>
    </Tooltip>
  );
};
