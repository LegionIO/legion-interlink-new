import type { IpcMain } from 'electron';
import { readFileSync } from 'fs';
import type { LegionConfig } from '../config/schema.js';
import { daemonGet, daemonPost, daemonDelete } from '../lib/daemon-client.js';
import type { DaemonResult } from '../lib/daemon-client.js';

async function daemonGetWithFallback<T = unknown>(
  config: LegionConfig,
  legionHome: string,
  v3Path: string,
  v2Path: string,
  query?: Record<string, string>,
): Promise<DaemonResult<T>> {
  const result = await daemonGet<T>(config, legionHome, v3Path, query);
  if (result.ok || result.error !== 'HTTP 404') return result;
  console.info(`[Knowledge] v3 route ${v3Path} unavailable, using v2: ${v2Path}`);
  return daemonGet<T>(config, legionHome, v2Path, query);
}

async function daemonPostWithFallback<T = unknown>(
  config: LegionConfig,
  legionHome: string,
  v3Path: string,
  v2Path: string,
  body: unknown,
): Promise<DaemonResult<T>> {
  const result = await daemonPost<T>(config, legionHome, v3Path, body);
  if (result.ok || result.error !== 'HTTP 404') return result;
  console.info(`[Knowledge] v3 route ${v3Path} unavailable, using v2: ${v2Path}`);
  return daemonPost<T>(config, legionHome, v2Path, body);
}

async function daemonDeleteWithFallback(
  config: LegionConfig,
  legionHome: string,
  v3Path: string,
  v2Path: string,
): Promise<DaemonResult> {
  const result = await daemonDelete(config, legionHome, v3Path);
  if (result.ok || result.error !== 'HTTP 404') return result;
  console.info(`[Knowledge] v3 route ${v3Path} unavailable, using v2: ${v2Path}`);
  return daemonDelete(config, legionHome, v2Path);
}

export function registerKnowledgeHandlers(
  ipcMain: IpcMain,
  legionHome: string,
  getConfig: () => LegionConfig,
): void {
  const cfg = () => getConfig();

  ipcMain.handle('knowledge:query', async (_e, query: string, _scope?: string, _synthesize?: boolean) =>
    daemonPost(cfg(), legionHome, '/api/apollo/query', { query, agent_id: 'legion-interlink' }));

  ipcMain.handle('knowledge:retrieve', async (_e, query: string, _scope?: string, limit?: number) =>
    daemonPost(cfg(), legionHome, '/api/apollo/query', { query, limit: limit || 20, agent_id: 'legion-interlink' }));

  ipcMain.handle('knowledge:browse', async (_e, filters?: { tag?: string; source?: string; page?: string; per_page?: string }) => {
    const body: Record<string, unknown> = {
      query: filters?.tag || filters?.source || '*',
      limit: parseInt(filters?.per_page || '50', 10),
      agent_id: 'legion-interlink',
    };
    if (filters?.tag) body.tags = [filters.tag];
    return daemonPost(cfg(), legionHome, '/api/apollo/query', body);
  });

  // NOTE: DELETE /api/apollo/entries/{id} does not exist in the daemon OpenAPI spec — this will 404 until the daemon implements it
  ipcMain.handle('knowledge:delete', async (_e, id: string) =>
    daemonDelete(cfg(), legionHome, `/api/apollo/entries/${id}`));

  ipcMain.handle('knowledge:ingest', async (_e, content: string, metadata?: Record<string, unknown>) =>
    daemonPost(cfg(), legionHome, '/api/apollo/ingest', { content, ...metadata }));

  ipcMain.handle('knowledge:ingest-file', async (_e, filePath: string) => {
    try {
      const fileName = filePath.split('/').pop() || filePath;
      const ext = fileName.split('.').pop()?.toLowerCase() || '';
      const binaryTypes = ['pdf', 'docx', 'xlsx', 'pptx', 'doc', 'xls', 'ppt', 'zip', 'gz', 'tar', 'png', 'jpg', 'jpeg', 'gif', 'webp'];
      if (binaryTypes.includes(ext)) {
        return { ok: false, error: `Binary file type .${ext} requires daemon-side extraction. Use the daemon absorber pipeline for this file type.` };
      }
      const content = readFileSync(filePath, 'utf-8');
      return daemonPost(cfg(), legionHome, '/api/apollo/ingest', {
        content,
        source_channel: 'desktop',
        source_agent: 'legion-interlink',
        source_provider: fileName,
        tags: ['uploaded-file'],
      });
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('knowledge:monitors-list', async () =>
    daemonGetWithFallback(cfg(), legionHome,
      '/api/extensions/knowledge/runners/monitors/list',
      '/api/lex/knowledge/monitors'));

  ipcMain.handle('knowledge:monitor-add', async (_e, path: string) =>
    daemonPostWithFallback(cfg(), legionHome,
      '/api/extensions/knowledge/runners/monitors/create',
      '/api/lex/knowledge/monitors',
      { path }));

  ipcMain.handle('knowledge:monitor-remove', async (_e, id: string) =>
    daemonDeleteWithFallback(cfg(), legionHome,
      `/api/extensions/knowledge/runners/monitors/delete?id=${id}`,
      `/api/lex/knowledge/monitors/${id}`));

  ipcMain.handle('knowledge:monitor-scan', async (_e, id: string) =>
    daemonPostWithFallback(cfg(), legionHome,
      `/api/extensions/knowledge/runners/monitors/scan?id=${id}`,
      `/api/lex/knowledge/monitors/${id}/scan`,
      {}));

  ipcMain.handle('knowledge:health', async () =>
    daemonGet(cfg(), legionHome, '/api/apollo/stats'));

  ipcMain.handle('knowledge:maintain', async () =>
    daemonPost(cfg(), legionHome, '/api/apollo/maintenance', { action: 'decay_cycle' }));

  ipcMain.handle('knowledge:status', async () =>
    daemonGet(cfg(), legionHome, '/api/apollo/status'));
}
