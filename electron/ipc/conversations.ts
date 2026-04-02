import type { IpcMain } from 'electron';
import { BrowserWindow } from 'electron';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { AppConfig } from '../config/schema.js';
import { getComputerUseManager } from '../computer-use/service.js';

type ConversationRecord = {
  id: string;
  title: string | null;
  fallbackTitle: string | null;
  messages: unknown[];
  conversationCompaction: unknown | null;
  lastContextUsage: unknown | null;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string | null;
  titleStatus: 'idle' | 'generating' | 'ready' | 'error';
  titleUpdatedAt: string | null;
  messageCount: number;
  userMessageCount: number;
  runStatus: 'idle' | 'running' | 'error';
  hasUnread: boolean;
  lastAssistantUpdateAt: string | null;
  selectedModelKey: string | null;
  selectedProfileKey?: string | null;
  fallbackEnabled?: boolean;
  profilePrimaryModelKey?: string | null;
};

type ConversationsStore = {
  conversations: Record<string, ConversationRecord>;
  activeConversationId: string | null;
  settings: Record<string, unknown>;
};

function getStorePath(appHome: string): string {
  return join(appHome, 'data', 'conversations.json');
}

export function readConversationStore(appHome: string): ConversationsStore {
  const storePath = getStorePath(appHome);
  if (!existsSync(storePath)) {
    return { conversations: {}, activeConversationId: null, settings: {} };
  }
  try {
    return JSON.parse(readFileSync(storePath, 'utf-8'));
  } catch {
    return { conversations: {}, activeConversationId: null, settings: {} };
  }
}

export function writeConversationStore(appHome: string, store: ConversationsStore): void {
  const storePath = getStorePath(appHome);
  const dir = join(appHome, 'data');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(storePath, JSON.stringify(store, null, 2), 'utf-8');
}

export function broadcastConversationChange(store: ConversationsStore): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('conversations:changed', store);
  }
}

export function registerConversationHandlers(ipcMain: IpcMain, appHome: string, getConfig?: () => AppConfig): void {
  ipcMain.handle('conversations:list', () => {
    const store = readConversationStore(appHome);
    const conversations = Object.values(store.conversations);
    // Sort by most recent activity
    conversations.sort((a, b) => {
      const aAt = a.lastAssistantUpdateAt ?? a.lastMessageAt ?? a.updatedAt ?? a.createdAt;
      const bAt = b.lastAssistantUpdateAt ?? b.lastMessageAt ?? b.updatedAt ?? b.createdAt;
      return bAt.localeCompare(aAt);
    });
    // Add computed metadata for client-side filtering
    return conversations.map((conv) => ({
      ...conv,
      hasToolCalls: Array.isArray(conv.messages) && conv.messages.some(
        (msg: unknown) => {
          const m = msg as Record<string, unknown>;
          return Array.isArray(m.content) && (m.content as Array<Record<string, unknown>>).some(
            (part) => part?.type === 'tool-call',
          );
        },
      ),
    }));
  });

  ipcMain.handle('conversations:get', (_event, id: string) => {
    const store = readConversationStore(appHome);
    return store.conversations[id] ?? null;
  });

  ipcMain.handle('conversations:put', (_event, conversation: ConversationRecord) => {
    const store = readConversationStore(appHome);
    store.conversations[conversation.id] = conversation;
    writeConversationStore(appHome, store);
    broadcastConversationChange(store);
    return { ok: true };
  });

  ipcMain.handle('conversations:delete', (_event, id: string) => {
    const store = readConversationStore(appHome);
    delete store.conversations[id];
    if (store.activeConversationId === id) {
      store.activeConversationId = null;
    }
    writeConversationStore(appHome, store);
    broadcastConversationChange(store);

    // Clean up associated computer-use sessions
    if (getConfig) {
      try {
        const manager = getComputerUseManager(appHome, getConfig);
        manager.removeSessionsByConversation(id);
      } catch {
        // Computer-use module may not be initialized yet — safe to ignore
      }
    }

    return { ok: true };
  });

  ipcMain.handle('conversations:clear', () => {
    const store = readConversationStore(appHome);

    // Clean up all computer-use sessions
    if (getConfig) {
      try {
        const manager = getComputerUseManager(appHome, getConfig);
        for (const conversationId of Object.keys(store.conversations)) {
          manager.removeSessionsByConversation(conversationId);
        }
      } catch {
        // Safe to ignore
      }
    }

    store.conversations = {};
    store.activeConversationId = null;
    writeConversationStore(appHome, store);
    broadcastConversationChange(store);
    return { ok: true };
  });

  ipcMain.handle('conversations:get-active-id', () => {
    const store = readConversationStore(appHome);
    return store.activeConversationId;
  });

  ipcMain.handle('conversations:set-active-id', (_event, id: string) => {
    const store = readConversationStore(appHome);
    store.activeConversationId = id;
    writeConversationStore(appHome, store);
    broadcastConversationChange(store);
    return { ok: true };
  });
}
