import type { IpcMain } from 'electron';
import { readFileSync } from 'fs';
import type { LegionConfig } from '../config/schema.js';
import { daemonGet, daemonPost, daemonDelete } from '../lib/daemon-client.js';

export function registerKnowledgeHandlers(
  ipcMain: IpcMain,
  legionHome: string,
  getConfig: () => LegionConfig,
): void {
  const cfg = () => getConfig();

  ipcMain.handle('knowledge:query', async (_e, query: string, scope?: string, synthesize?: boolean) =>
    daemonPost(cfg(), legionHome, '/api/apollo/query', { query, scope, synthesize }));

  ipcMain.handle('knowledge:retrieve', async (_e, query: string, scope?: string, limit?: number) =>
    daemonPost(cfg(), legionHome, '/api/apollo/retrieve', { query, scope, limit }));

  ipcMain.handle('knowledge:browse', async (_e, filters?: { tag?: string; source?: string; page?: string; per_page?: string }) => {
    const query: Record<string, string> = {};
    if (filters?.tag) query['tag'] = filters.tag;
    if (filters?.source) query['source'] = filters.source;
    if (filters?.page) query['page'] = filters.page;
    if (filters?.per_page) query['per_page'] = filters.per_page;
    return daemonGet(cfg(), legionHome, '/api/apollo/entries', query);
  });

  ipcMain.handle('knowledge:delete', async (_e, id: string) =>
    daemonDelete(cfg(), legionHome, `/api/apollo/entries/${id}`));

  ipcMain.handle('knowledge:ingest', async (_e, content: string, metadata?: Record<string, unknown>) =>
    daemonPost(cfg(), legionHome, '/api/apollo/ingest', { content, ...metadata }));

  ipcMain.handle('knowledge:ingest-file', async (_e, filePath: string) => {
    try {
      const content = readFileSync(filePath, 'utf-8');
      const fileName = filePath.split('/').pop() || filePath;
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
    daemonGet(cfg(), legionHome, '/api/lex/knowledge/monitors'));

  ipcMain.handle('knowledge:monitor-add', async (_e, path: string) =>
    daemonPost(cfg(), legionHome, '/api/lex/knowledge/monitors', { path }));

  ipcMain.handle('knowledge:monitor-remove', async (_e, id: string) =>
    daemonDelete(cfg(), legionHome, `/api/lex/knowledge/monitors/${id}`));

  ipcMain.handle('knowledge:monitor-scan', async (_e, id: string) =>
    daemonPost(cfg(), legionHome, `/api/lex/knowledge/monitors/${id}/scan`, {}));

  ipcMain.handle('knowledge:health', async () =>
    daemonGet(cfg(), legionHome, '/api/lex/knowledge/health'));

  ipcMain.handle('knowledge:maintain', async () =>
    daemonPost(cfg(), legionHome, '/api/lex/knowledge/maintain', {}));

  ipcMain.handle('knowledge:status', async () =>
    daemonGet(cfg(), legionHome, '/api/apollo/status'));
}
