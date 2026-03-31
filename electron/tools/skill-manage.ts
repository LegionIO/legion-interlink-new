import { z } from 'zod';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync, chmodSync } from 'fs';
import { join } from 'path';
import type { ToolDefinition } from './types.js';
import type { AppConfig } from '../config/schema.js';
import { getSkillToolName, loadSkillsFromDisk, type SkillManifest } from './skill-loader.js';
import { readEffectiveConfig, writeDesktopConfig } from '../ipc/config.js';

function readConfig(appHome: string): AppConfig {
  return readEffectiveConfig(appHome);
}

function getSkillsDir(appHome: string, config?: AppConfig): string {
  const cfg = config ?? readConfig(appHome);
  return cfg.skills?.directory || join(appHome, 'skills');
}

export function createSkillManageTool(appHome: string): ToolDefinition {
  return {
    name: 'skills',
    description: [
      'Manage ' + __BRAND_PRODUCT_NAME + ' skills. Skills are reusable tools stored on disk that persist across sessions.',
      'Actions: "list" shows all skills. "get" reads a skill\'s manifest and files. "create" makes a new skill. "edit" updates one. "delete" removes one. "enable"/"disable" toggles availability.',
      'Skill types: "shell" (runs a command), "script" (runs Node.js), "prompt" (template), "http" (calls an endpoint), "composite" (chains tools).',
      `Created skills are immediately available as tools named like "${getSkillToolName('deploy-status')}".`,
    ].join(' '),
    inputSchema: z.object({
      action: z.enum(['list', 'get', 'create', 'edit', 'delete', 'enable', 'disable']).describe('The action to perform'),
      name: z.string().optional().describe('Skill name (required for get/create/edit/delete/enable/disable)'),
      description: z.string().optional().describe('Skill description (for create/edit)'),
      version: z.string().optional().describe('Skill version string (for create/edit)'),
      inputSchema: z.any().optional().describe('JSON Schema for the skill input (for create/edit)'),
      execution: z.object({
        type: z.enum(['shell', 'script', 'prompt', 'http', 'composite']).describe('Execution type'),
        command: z.string().optional().describe('Shell command (for shell type)'),
        scriptFile: z.string().optional().describe('Script filename (for script type, default: index.mjs)'),
        promptTemplate: z.string().optional().describe('Prompt template with {{input.field}} placeholders (for prompt type)'),
        url: z.string().optional().describe('HTTP endpoint URL (for http type)'),
        method: z.string().optional().describe('HTTP method (for http type, default: POST)'),
        headers: z.record(z.string()).optional().describe('HTTP headers (for http type)'),
        bodyTemplate: z.string().optional().describe('HTTP body template (for http type)'),
        steps: z.array(z.object({
          tool: z.string().describe('Tool name to call'),
          args: z.record(z.any()).describe('Arguments to pass'),
        })).optional().describe('Steps for composite type'),
      }).optional().describe('Execution configuration (required for create)'),
      files: z.record(z.string()).optional().describe('Additional files to write in the skill directory, keyed by filename (e.g., {"run.sh": "#!/bin/bash\\necho hello", "index.mjs": "..."})'),
    }),
    execute: async (input) => {
      const { action, name, description, version, inputSchema, execution, files } = input as {
        action: string;
        name?: string;
        description?: string;
        version?: string;
        inputSchema?: Record<string, unknown>;
        execution?: SkillManifest['execution'];
        files?: Record<string, string>;
      };

      const config = readConfig(appHome);
      const skillsDir = getSkillsDir(appHome, config);

      switch (action) {
        case 'list': {
          const skills = loadSkillsFromDisk(skillsDir);
          const enabled = config.skills?.enabled ?? [];
          return {
            skills: skills.map(({ manifest }) => ({
              name: manifest.name,
              description: manifest.description,
              version: manifest.version,
              type: manifest.execution.type,
              enabled: enabled.length === 0 || enabled.includes(manifest.name),
            })),
            skillsDir,
          };
        }

        case 'get': {
          if (!name) return { error: 'Skill name is required.' };
          const skillDir = join(skillsDir, name);
          const manifestPath = join(skillDir, 'skill.json');
          if (!existsSync(manifestPath)) return { error: `Skill "${name}" not found.` };

          const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));

          // Read additional files in the skill directory
          const skillFiles: Record<string, string> = {};
          try {
            const entries = readdirSync(skillDir);
            for (const entry of entries) {
              if (entry === 'skill.json') continue;
              const filePath = join(skillDir, entry);
              try {
                skillFiles[entry] = readFileSync(filePath, 'utf-8');
              } catch { /* skip binary files */ }
            }
          } catch { /* ignore */ }

          return { manifest, files: skillFiles, dir: skillDir };
        }

        case 'create': {
          if (!name) return { error: 'Skill name is required.' };
          if (!execution) return { error: 'Execution configuration is required.' };
          if (!description) return { error: 'Description is required.' };

          // Validate name
          if (!/^[a-z0-9][a-z0-9_-]*$/.test(name)) {
            return { error: 'Skill name must start with a letter/digit and contain only lowercase letters, digits, hyphens, and underscores.' };
          }

          const skillDir = join(skillsDir, name);
          if (existsSync(skillDir)) return { error: `Skill "${name}" already exists. Use "edit" to update it.` };

          // Create skill directory and manifest
          mkdirSync(skillDir, { recursive: true });

          const manifest: SkillManifest = {
            name,
            description,
            version: version ?? '1.0.0',
            ...(inputSchema ? { inputSchema } : {}),
            execution,
          };
          writeFileSync(join(skillDir, 'skill.json'), JSON.stringify(manifest, null, 2));

          // Write additional files
          if (files) {
            for (const [filename, content] of Object.entries(files)) {
              const filePath = join(skillDir, filename);
              writeFileSync(filePath, content);
              // Make shell scripts executable
              if (filename.endsWith('.sh')) {
                try { chmodSync(filePath, 0o755); } catch { /* ignore */ }
              }
            }
          }

          // Add to enabled list
          const enabled = [...(config.skills?.enabled ?? [])];
          if (!enabled.includes(name)) {
            enabled.push(name);
          }
          config.skills = { ...config.skills, enabled, directory: config.skills?.directory ?? join(appHome, 'skills') };
          writeDesktopConfig(appHome, config);

          return {
            success: true,
            created: manifest,
            dir: skillDir,
            note: `Skill "${name}" created. It will be available as tool "${getSkillToolName(name)}" on your next turn.`,
          };
        }

        case 'edit': {
          if (!name) return { error: 'Skill name is required.' };
          const skillDir = join(skillsDir, name);
          const manifestPath = join(skillDir, 'skill.json');
          if (!existsSync(manifestPath)) return { error: `Skill "${name}" not found.` };

          const existing = JSON.parse(readFileSync(manifestPath, 'utf-8')) as SkillManifest;
          const updated: SkillManifest = {
            ...existing,
            ...(description !== undefined ? { description } : {}),
            ...(version !== undefined ? { version } : {}),
            ...(inputSchema !== undefined ? { inputSchema } : {}),
            ...(execution !== undefined ? { execution } : {}),
          };
          writeFileSync(manifestPath, JSON.stringify(updated, null, 2));

          // Write additional files if provided
          if (files) {
            for (const [filename, content] of Object.entries(files)) {
              const filePath = join(skillDir, filename);
              writeFileSync(filePath, content);
              if (filename.endsWith('.sh')) {
                try { chmodSync(filePath, 0o755); } catch { /* ignore */ }
              }
            }
          }

          return {
            success: true,
            updated,
            note: 'Changes take effect on your next turn.',
          };
        }

        case 'delete': {
          if (!name) return { error: 'Skill name is required.' };
          const skillDir = join(skillsDir, name);
          if (!existsSync(skillDir)) return { error: `Skill "${name}" not found.` };

          rmSync(skillDir, { recursive: true, force: true });

          // Remove from enabled list
          const enabled = (config.skills?.enabled ?? []).filter((s: string) => s !== name);
          config.skills = { ...config.skills, enabled, directory: config.skills?.directory ?? join(appHome, 'skills') };
          writeDesktopConfig(appHome, config);

          return { success: true, deleted: name, note: 'Skill removed. Changes take effect on your next turn.' };
        }

        case 'enable': {
          if (!name) return { error: 'Skill name is required.' };
          const skillDir = join(skillsDir, name);
          if (!existsSync(join(skillDir, 'skill.json'))) return { error: `Skill "${name}" not found.` };

          const enabled = [...(config.skills?.enabled ?? [])];
          if (!enabled.includes(name)) {
            enabled.push(name);
          }
          config.skills = { ...config.skills, enabled, directory: config.skills?.directory ?? join(appHome, 'skills') };
          writeDesktopConfig(appHome, config);

          return { success: true, enabled: name, note: 'Skill enabled. Changes take effect on your next turn.' };
        }

        case 'disable': {
          if (!name) return { error: 'Skill name is required.' };
          const enabled = (config.skills?.enabled ?? []).filter((s: string) => s !== name);
          config.skills = { ...config.skills, enabled, directory: config.skills?.directory ?? join(appHome, 'skills') };
          writeDesktopConfig(appHome, config);

          return { success: true, disabled: name, note: 'Skill disabled. Changes take effect on your next turn.' };
        }

        default:
          return { error: `Unknown action: ${action}` };
      }
    },
  };
}
