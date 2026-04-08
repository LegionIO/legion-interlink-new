import { existsSync, cpSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';

/**
 * Resolve the path to the bundled-plugins directory.
 *
 * In development (`electron-vite dev`) the source tree is used directly.
 * In packaged builds, `extraResources` places the folder alongside the asar.
 */
function getBundledPluginsDir(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'bundled-plugins');
  }
  // Dev mode — bundled-plugins/ lives at the project root
  return join(__dirname, '../../bundled-plugins');
}

/**
 * Copy brand-required plugins from the bundled resources into the user's
 * plugins directory (`~/.{appSlug}/plugins/`).
 *
 * Skips any plugin whose target directory already exists (idempotent).
 * This runs synchronously during startup, before plugin discovery.
 */
export function bootstrapBundledPlugins(pluginsDir: string): void {
  const bundledDir = getBundledPluginsDir();
  if (!existsSync(bundledDir)) return;

  let entries: string[];
  try {
    entries = readdirSync(bundledDir);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry === '.gitkeep') continue;

    const srcDir = join(bundledDir, entry);
    const destDir = join(pluginsDir, entry);

    if (existsSync(destDir)) continue;

    try {
      cpSync(srcDir, destDir, { recursive: true });
      console.info(`[PluginBootstrap] Installed bundled plugin "${entry}"`);
    } catch (err) {
      console.warn(`[PluginBootstrap] Failed to install bundled plugin "${entry}":`, err);
    }
  }
}

/**
 * Returns the set of plugin names that the current brand mandates.
 */
export function getBrandRequiredPluginNames(): Set<string> {
  try {
    return new Set(__BRAND_REQUIRED_PLUGINS);
  } catch {
    return new Set();
  }
}
