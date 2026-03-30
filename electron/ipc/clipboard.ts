import { clipboard, type IpcMain } from 'electron';

export function registerClipboardHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('clipboard:write-text', async (_event, text: string) => {
    try {
      clipboard.writeText(String(text ?? ''));
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to write text to the clipboard.',
      };
    }
  });
}
