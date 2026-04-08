/**
 * IPC handlers for the Realtime Audio session.
 * Bridges the renderer process to the RealtimeSession in the main process.
 */

import { join } from 'path';
import type { IpcMain } from 'electron';
import { RealtimeSession } from '../realtime/realtime-session.js';
import { buildRealtimeMemoryContext } from '../realtime/realtime-context.js';
import type { AppConfig } from '../config/schema.js';
import type { ToolDefinition } from '../tools/types.js';
import { recordUsageEvent } from './usage.js';

let activeSession: RealtimeSession | null = null;
let sessionStartTime: string | null = null;
let sessionConversationId: string | null = null;

export function updateActiveRealtimeSessionTools(tools: ToolDefinition[]): void {
  activeSession?.updateTools(tools);
}

export function registerRealtimeHandlers(
  ipcMain: IpcMain,
  getConfig: () => AppConfig,
  getTools: () => ToolDefinition[],
  appHome: string,
): void {
  const dbPath = join(appHome, 'data', 'memory.db');

  ipcMain.handle('realtime:start-session', async (_event, conversationId: string) => {
    try {
      console.info(`[Realtime IPC] start-session called for conversationId="${conversationId}"`);

      // End any existing session
      if (activeSession) {
        activeSession.close();
        activeSession = null;
      }

      sessionStartTime = new Date().toISOString();
      sessionConversationId = conversationId;

      const config = getConfig();
      console.info(`[Realtime IPC] memoryContext config: ${JSON.stringify(config.realtime.memoryContext)}`);

      // Build memory context (the "ringing" phase — may take a moment)
      let memoryContext = '';
      if (config.realtime.memoryContext?.enabled) {
        try {
          const startTime = Date.now();
          memoryContext = await buildRealtimeMemoryContext(conversationId, config, dbPath);
          console.info(`[Realtime IPC] Memory context built in ${Date.now() - startTime}ms: ${memoryContext.length} chars`);
        } catch (err) {
          console.warn('[Realtime IPC] Memory context build failed (continuing without):', err);
        }
      }

      const tools = getTools();
      activeSession = new RealtimeSession(getConfig, tools);
      await activeSession.start(conversationId, memoryContext);
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[Realtime IPC] Failed to start session:', msg);
      return { error: msg };
    }
  });

  ipcMain.handle('realtime:end-session', async () => {
    if (activeSession) {
      // Record usage event before closing
      if (sessionStartTime) {
        const durationSec = (Date.now() - new Date(sessionStartTime).getTime()) / 1000;
        recordUsageEvent({
          modality: 'realtime',
          conversationId: sessionConversationId ?? undefined,
          durationSec: Math.round(durationSec),
        });
      }
      activeSession.close();
      activeSession = null;
      sessionStartTime = null;
      sessionConversationId = null;
    }
    return { ok: true };
  });

  // Fire-and-forget audio sending (use ipcMain.on, not handle)
  ipcMain.on('realtime:send-audio', (_event, pcmBase64: string) => {
    activeSession?.sendAudio(pcmBase64);
  });

  ipcMain.handle('realtime:get-status', () => {
    return {
      status: activeSession?.status ?? 'idle',
    };
  });
}
