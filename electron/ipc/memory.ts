import type { IpcMain } from 'electron';
import { join } from 'path';
import type { AppConfig } from '../config/schema.js';
import { getSharedMemory, getResourceId, testEmbeddingConnection } from '../agent/memory.js';

export function registerMemoryHandlers(
  ipcMain: IpcMain,
  appHome: string,
  getConfig: () => AppConfig,
): void {
  const dbPath = join(appHome, 'data', 'memory.db');

  ipcMain.handle('memory:clear', async (_event, options: {
    working?: boolean;
    observational?: boolean;
    semantic?: boolean;
    all?: boolean;
  }) => {
    const config = getConfig();
    const memory = getSharedMemory(config, dbPath);
    if (!memory) {
      return { error: 'Memory is not initialized. Enable memory in settings first.' };
    }

    const resourceId = getResourceId();
    const cleared: string[] = [];

    try {
      if (options.all) {
        // Nuclear option — clear everything
        const store = await (memory as unknown as { storage: { getStore(name: string): Promise<unknown> } }).storage.getStore('memory');
        const memStore = store as { dangerouslyClearAll(): Promise<void> };
        await memStore.dangerouslyClearAll();
        cleared.push('all memory stores');

        // Also clear vector indexes
        try {
          const vector = (memory as unknown as { vector?: { listIndexes(): Promise<string[]>; truncateIndex(opts: { indexName: string }): Promise<void> } }).vector;
          if (vector) {
            const indexes = await vector.listIndexes();
            for (const idx of indexes) {
              await vector.truncateIndex({ indexName: idx });
            }
            if (indexes.length > 0) cleared.push(`${indexes.length} vector index(es)`);
          }
        } catch { /* vector might not be configured */ }

        return { success: true, cleared };
      }

      // Selective clearing
      if (options.working) {
        try {
          // Clear resource-scoped working memory
          const store = await (memory as unknown as { storage: { getStore(name: string): Promise<unknown> } }).storage.getStore('memory');
          const memStore = store as { updateResource(opts: { resourceId: string; workingMemory: string }): Promise<void> };
          await memStore.updateResource({ resourceId, workingMemory: '' });
          cleared.push('working memory');
        } catch (err) {
          console.error('[Memory] Failed to clear working memory:', err);
        }
      }

      if (options.observational) {
        try {
          const store = await (memory as unknown as { storage: { getStore(name: string): Promise<unknown> } }).storage.getStore('memory');
          const memStore = store as { clearObservationalMemory(threadId: string | null, resourceId: string): Promise<void> };
          await memStore.clearObservationalMemory(null, resourceId);
          cleared.push('observational memory');
        } catch (err) {
          console.error('[Memory] Failed to clear observational memory:', err);
        }
      }

      if (options.semantic) {
        try {
          const vector = (memory as unknown as { vector?: { listIndexes(): Promise<string[]>; truncateIndex(opts: { indexName: string }): Promise<void> } }).vector;
          if (vector) {
            const indexes = await vector.listIndexes();
            for (const idx of indexes) {
              await vector.truncateIndex({ indexName: idx });
            }
            cleared.push(`semantic recall (${indexes.length} index(es))`);
          } else {
            cleared.push('semantic recall (no vector store configured)');
          }
        } catch (err) {
          console.error('[Memory] Failed to clear semantic recall:', err);
        }
      }

      return { success: true, cleared };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('memory:test-embedding', async () => {
    const config = getConfig();
    return testEmbeddingConnection(config);
  });
}
