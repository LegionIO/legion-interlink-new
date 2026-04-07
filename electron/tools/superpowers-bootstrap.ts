import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync, statSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SUPERPOWERS_REPO = 'https://github.com/obra/superpowers.git';
const SUPERPOWERS_DIR_NAME = 'superpowers';

function parseSkillMdFrontmatter(content: string): { name?: string; description?: string } {
  const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};

  const frontmatter = match[1];
  const result: Record<string, string> = {};

  for (const line of frontmatter.split(/\r?\n/)) {
    const colonIndex = line.indexOf(':');
    if (colonIndex < 0) continue;
    const key = line.slice(0, colonIndex).trim();
    let value = line.slice(colonIndex + 1).trim();
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }

  return result;
}

function getSkillMdBody(content: string): string {
  const match = content.match(/^---\s*\r?\n[\s\S]*?\r?\n---\s*\r?\n([\s\S]*)$/);
  return match ? match[1].trim() : content.trim();
}

function generateSkillJson(sourceDir: string, outputDir: string, skillName: string): boolean {
  const skillMdPath = join(sourceDir, 'SKILL.md');
  const skillJsonPath = join(outputDir, 'skill.json');

  // Don't overwrite if skill.json already exists (user may have customized)
  if (existsSync(skillJsonPath)) return false;
  if (!existsSync(skillMdPath)) return false;

  const content = readFileSync(skillMdPath, 'utf-8');
  const frontmatter = parseSkillMdFrontmatter(content);
  const body = getSkillMdBody(content);

  const manifest = {
    name: frontmatter.name || skillName,
    description: frontmatter.description || `Superpowers skill: ${skillName}`,
    version: '1.0.0',
    execution: {
      type: 'prompt',
      promptTemplate: body,
    },
  };

  writeFileSync(skillJsonPath, JSON.stringify(manifest, null, 2));
  return true;
}

export function bootstrapSuperpowers(skillsDir: string): void {
  const superpowersRoot = join(skillsDir, SUPERPOWERS_DIR_NAME);

  // Clone if not present
  if (!existsSync(superpowersRoot)) {
    try {
      console.info('[Superpowers] Cloning superpowers skills...');
      execFileSync('git', ['clone', '--depth', '1', SUPERPOWERS_REPO, superpowersRoot], {
        stdio: 'ignore',
        timeout: 30000,
      });
      console.info('[Superpowers] Clone complete.');
    } catch (err) {
      console.warn('[Superpowers] Failed to clone superpowers repo:', err);
      return;
    }
  }

  // Find skill directories inside the cloned repo's skills/ folder
  const repoSkillsDir = join(superpowersRoot, 'skills');
  if (!existsSync(repoSkillsDir)) {
    console.warn('[Superpowers] No skills/ directory found in cloned repo.');
    return;
  }

  // For each skill, create a symlink or copy into the top-level skills dir
  // so the skill loader can find them, and generate skill.json wrappers
  let generated = 0;
  let entries: string[];
  try {
    entries = readdirSync(repoSkillsDir);
  } catch {
    return;
  }

  for (const entry of entries) {
    const skillSubDir = join(repoSkillsDir, entry);
    try {
      if (!statSync(skillSubDir).isDirectory()) continue;
    } catch {
      continue;
    }

    // Create a wrapper directory in the main skills dir that the loader can find
    const wrapperDir = join(skillsDir, `superpowers-${entry}`);
    if (!existsSync(wrapperDir)) {
      mkdirSync(wrapperDir, { recursive: true });
    }

    // Read SKILL.md from the repo and generate skill.json in the wrapper dir
    if (generateSkillJson(skillSubDir, wrapperDir, `superpowers-${entry}`)) {
      generated++;
    }
  }

  if (generated > 0) {
    console.info(`[Superpowers] Generated ${generated} skill.json wrappers.`);
  }
}

export function updateSuperpowers(skillsDir: string): void {
  const superpowersRoot = join(skillsDir, SUPERPOWERS_DIR_NAME);
  if (!existsSync(join(superpowersRoot, '.git'))) return;

  try {
    execFileSync('git', ['pull', '--ff-only'], {
      cwd: superpowersRoot,
      stdio: 'ignore',
      timeout: 15000,
    });

    // Re-generate any missing skill.json wrappers after update
    const repoSkillsDir = join(superpowersRoot, 'skills');
    if (!existsSync(repoSkillsDir)) return;

    for (const entry of readdirSync(repoSkillsDir)) {
      const skillSubDir = join(repoSkillsDir, entry);
      try {
        if (!statSync(skillSubDir).isDirectory()) continue;
      } catch {
        continue;
      }
      const wrapperDir = join(skillsDir, `superpowers-${entry}`);
      if (!existsSync(wrapperDir)) mkdirSync(wrapperDir, { recursive: true });
      generateSkillJson(skillSubDir, wrapperDir, `superpowers-${entry}`);
    }
  } catch (err) {
    console.warn('[Superpowers] Failed to update superpowers:', err);
  }
}
