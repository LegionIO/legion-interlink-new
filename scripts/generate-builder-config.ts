/**
 * Pre-build script that generates `electron-builder.yml` from the template
 * and branding config.
 *
 * Usage:  node --import tsx scripts/generate-builder-config.ts
 *         (automatically called by `pnpm build:mac`)
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { branding } from '../branding.config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const templatePath = resolve(root, 'electron-builder.template.yml');
const outputPath = resolve(root, 'electron-builder.yml');

let content = readFileSync(templatePath, 'utf-8');

// Replace all {{key}} placeholders with values from branding config
for (const [key, value] of Object.entries(branding)) {
  content = content.replaceAll(`{{${key}}}`, String(value));
}

// Warn about any remaining un-replaced placeholders
const remaining = content.match(/\{\{[a-zA-Z]+\}\}/g);
if (remaining) {
  console.warn(`[generate-builder-config] Warning: un-replaced placeholders: ${remaining.join(', ')}`);
}

writeFileSync(outputPath, content, 'utf-8');
console.info(`[generate-builder-config] Generated ${outputPath} from template.`);
