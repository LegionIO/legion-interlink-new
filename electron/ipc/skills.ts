import type { IpcMain } from 'electron';
import { readFileSync, existsSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';
import type { AppConfig } from '../config/schema.js';
import { loadSkillsFromDisk } from '../tools/skill-loader.js';
import { readEffectiveConfig, writeDesktopConfig } from './config.js';

function readConfig(appHome: string): AppConfig {
  return readEffectiveConfig(appHome);
}

export function registerSkillsHandlers(ipcMain: IpcMain, appHome: string): void {
  ipcMain.handle('skills:list', async () => {
    const config = readConfig(appHome);
    const skillsDir = config.skills?.directory || join(appHome, 'skills');
    const skills = loadSkillsFromDisk(skillsDir);
    const enabled = config.skills?.enabled ?? [];

    return skills.map(({ manifest, dir }) => ({
      name: manifest.name,
      description: manifest.description,
      version: manifest.version,
      type: manifest.execution.type,
      enabled: enabled.length === 0 || enabled.includes(manifest.name),
      dir,
    }));
  });

  ipcMain.handle('skills:get', async (_event, name: string) => {
    const config = readConfig(appHome);
    const skillsDir = config.skills?.directory || join(appHome, 'skills');
    const skillDir = join(skillsDir, name);
    const manifestPath = join(skillDir, 'skill.json');

    if (!existsSync(manifestPath)) return { error: `Skill "${name}" not found.` };

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    const files: Record<string, string> = {};

    try {
      const entries = readdirSync(skillDir);
      for (const entry of entries) {
        if (entry === 'skill.json') continue;
        try {
          files[entry] = readFileSync(join(skillDir, entry), 'utf-8');
        } catch { /* skip binary files */ }
      }
    } catch { /* ignore */ }

    return { manifest, files, dir: skillDir };
  });

  ipcMain.handle('skills:delete', async (_event, name: string) => {
    const config = readConfig(appHome);
    const skillsDir = config.skills?.directory || join(appHome, 'skills');
    const skillDir = join(skillsDir, name);

    if (!existsSync(skillDir)) return { error: `Skill "${name}" not found.` };

    rmSync(skillDir, { recursive: true, force: true });

    // Remove from enabled list
    const enabled = (config.skills?.enabled ?? []).filter((s: string) => s !== name);
    config.skills = { ...config.skills, enabled, directory: config.skills?.directory ?? join(appHome, 'skills') };
    writeDesktopConfig(appHome, config);

    return { success: true };
  });

  ipcMain.handle('skills:toggle', async (_event, name: string, enable: boolean) => {
    const config = readConfig(appHome);
    let enabled = [...(config.skills?.enabled ?? [])];

    if (enable && !enabled.includes(name)) {
      enabled.push(name);
    } else if (!enable) {
      enabled = enabled.filter((s: string) => s !== name);
    }

    config.skills = { ...config.skills, enabled, directory: config.skills?.directory ?? join(appHome, 'skills') };
    writeDesktopConfig(appHome, config);

    return { success: true, enabled: enable };
  });
}
