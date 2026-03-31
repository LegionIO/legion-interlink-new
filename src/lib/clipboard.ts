import { app } from '@/lib/ipc-client';

function getClipboardErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Failed to copy text to the clipboard.';
}

export async function copyTextToClipboard(text: string): Promise<void> {
  if (window.app?.clipboard?.writeText) {
    const result = await app.clipboard.writeText(text);
    if (!result.ok) {
      throw new Error(result.error ?? 'Failed to copy text to the clipboard.');
    }
    return;
  }

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  throw new Error('Clipboard access is not available in this environment.');
}

export function logClipboardError(context: string, error: unknown): void {
  console.warn(`[Clipboard] ${context}: ${getClipboardErrorMessage(error)}`);
}
