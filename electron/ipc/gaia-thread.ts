import type { IpcMain } from 'electron';
import { BrowserWindow } from 'electron';
import { readConversationStore, writeConversationStore } from './conversations.js';

const GAIA_THREAD_ID = '__gaia_proactive__';

interface ProactiveMessage {
  id: string;
  intent: string;
  content: string;
  source: string;
  metadata: Record<string, unknown>;
  timestamp: string;
}

export function registerGaiaThreadHandlers(ipcMain: IpcMain, appHome: string): void {
  // Ensure the GAIA thread exists
  ipcMain.handle('gaia-thread:ensure', () => {
    const store = readConversationStore(appHome);
    if (!store.conversations[GAIA_THREAD_ID]) {
      store.conversations[GAIA_THREAD_ID] = {
        id: GAIA_THREAD_ID,
        title: 'GAIA',
        fallbackTitle: 'GAIA Activity',
        messages: [],
        conversationCompaction: null,
        lastContextUsage: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastMessageAt: null,
        titleStatus: 'ready',
        titleUpdatedAt: new Date().toISOString(),
        messageCount: 0,
        userMessageCount: 0,
        runStatus: 'idle',
        hasUnread: false,
        lastAssistantUpdateAt: null,
        selectedModelKey: null,
        selectedProfileKey: null,
        fallbackEnabled: false,
        profilePrimaryModelKey: null,
      };
      writeConversationStore(appHome, store);
    }
    return { ok: true, id: GAIA_THREAD_ID };
  });

  // Append a proactive message to the GAIA thread
  ipcMain.handle('gaia-thread:append', (_event, msg: ProactiveMessage) => {
    const store = readConversationStore(appHome);
    if (!store.conversations[GAIA_THREAD_ID]) return { ok: false };

    const conv = store.conversations[GAIA_THREAD_ID];
    const storedMsg = {
      id: msg.id,
      role: 'assistant' as const,
      content: [{ type: 'text' as const, text: msg.content, source: 'unspoken' as const }],
      parentId: conv.messages.length > 0 ? (conv.messages[conv.messages.length - 1] as { id: string }).id : null,
      createdAt: msg.timestamp,
      metadata: { intent: msg.intent, source: msg.source, ...msg.metadata },
    };

    conv.messages.push(storedMsg);
    conv.messageCount = conv.messages.length;
    conv.lastMessageAt = msg.timestamp;
    conv.lastAssistantUpdateAt = msg.timestamp;
    conv.updatedAt = msg.timestamp;
    conv.hasUnread = true;

    writeConversationStore(appHome, store);

    // Notify renderer
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('conversations:changed');
      win.webContents.send('gaia-thread:new-message', msg);
    }

    return { ok: true };
  });

  // Get the GAIA thread ID constant
  ipcMain.handle('gaia-thread:id', () => GAIA_THREAD_ID);
}
