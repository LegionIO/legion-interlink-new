import { useEffect } from 'react';

/**
 * Applies the build-time brand hue as `--brand-hue` on <html>.
 * Every OKLCh color in globals.css derives from this single variable,
 * so setting it re-hues the entire UI.
 *
 * The hue comes exclusively from branding.config.ts via Vite define().
 */
export function useThemeInjector(): void {
  useEffect(() => {
    const hue = Number(__BRAND_THEME_HUE) || 292;
    document.documentElement.style.setProperty('--brand-hue', String(hue));
  }, []);
}
