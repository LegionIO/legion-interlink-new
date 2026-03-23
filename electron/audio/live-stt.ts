/**
 * Live streaming STT using the Azure Speech SDK.
 *
 * Architecture:
 * - The renderer starts/stops live STT via IPC
 * - The main process manages the Speech SDK recognizer with a PushAudioInputStream
 * - The renderer polls audio chunks from the hidden mic window (stt:live-mic-drain)
 *   and pushes them to the main process (stt:live-audio)
 * - The main process broadcasts partial/final transcript events to the renderer
 *
 * Renderer-side flow:
 *   1. Call stt:live-mic-start to start mic capture in hidden window
 *   2. Call stt:live-start to start the SDK recognizer
 *   3. Poll stt:live-mic-drain every ~50ms, forward chunks via stt:live-audio
 *   4. Listen for stt:partial / stt:final events from main
 *   5. Call stt:live-stop then stt:live-mic-stop to tear down
 */

import * as sdk from 'microsoft-cognitiveservices-speech-sdk';
import { BrowserWindow, type IpcMain } from 'electron';

let recognizer: sdk.SpeechRecognizer | null = null;
let pushStream: sdk.PushAudioInputStream | null = null;
let isRunning = false;

export function registerLiveSttHandlers(ipc: IpcMain): void {

  ipc.handle('stt:live-start', async (_event, config: {
    subscriptionKey: string;
    region?: string;
    endpoint?: string;
    language: string;
  }) => {
    console.log('[LiveSTT] Starting, endpoint=%s, region=%s, language=%s',
      config.endpoint ?? 'none', config.region ?? 'none', config.language);

    if (isRunning) return { error: 'Already running' };

    try {
      // Speech config
      let speechConfig: sdk.SpeechConfig;
      if (config.endpoint) {
        const endpointUrl = new URL(config.endpoint.replace(/\/+$/, ''));
        speechConfig = sdk.SpeechConfig.fromEndpoint(endpointUrl, config.subscriptionKey);
      } else {
        speechConfig = sdk.SpeechConfig.fromSubscription(config.subscriptionKey, config.region ?? 'eastus');
      }
      speechConfig.speechRecognitionLanguage = config.language;

      // Push stream (16kHz, 16-bit, mono)
      const format = sdk.AudioStreamFormat.getWaveFormatPCM(16000, 16, 1);
      pushStream = sdk.AudioInputStream.createPushStream(format);
      const audioConfig = sdk.AudioConfig.fromStreamInput(pushStream);

      // Recognizer
      recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);

      recognizer.recognizing = (_sender, e) => {
        if (e.result.text) {
          broadcast('stt:partial', e.result.text);
        }
      };

      recognizer.recognized = (_sender, e) => {
        if (e.result.reason === sdk.ResultReason.RecognizedSpeech && e.result.text) {
          console.log('[LiveSTT] Final: "%s"', e.result.text);
          broadcast('stt:final', e.result.text);
        }
      };

      recognizer.canceled = (_sender, e) => {
        console.log('[LiveSTT] Canceled: %s — %s', sdk.CancellationReason[e.reason], e.errorDetails);
        if (e.reason === sdk.CancellationReason.Error) {
          broadcast('stt:error', e.errorDetails ?? 'Recognition error');
        }
      };

      recognizer.sessionStopped = () => {
        console.log('[LiveSTT] Session stopped');
      };

      // Start continuous recognition
      await new Promise<void>((resolve, reject) => {
        recognizer!.startContinuousRecognitionAsync(
          () => { console.log('[LiveSTT] Started'); resolve(); },
          (err) => { reject(new Error(err)); },
        );
      });

      isRunning = true;
      return { ok: true };

    } catch (err) {
      cleanup();
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[LiveSTT] Start error:', msg);
      return { error: msg };
    }
  });

  // Receive PCM16 audio chunks from the renderer (which polls the hidden window)
  ipc.on('stt:live-audio', (_event, pcmBase64: string) => {
    if (!pushStream || !isRunning) return;
    try {
      const buf = Buffer.from(pcmBase64, 'base64');
      pushStream.write(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    } catch { /* ignore */ }
  });

  ipc.handle('stt:live-stop', async () => {
    console.log('[LiveSTT] Stopping...');
    if (!isRunning || !recognizer) {
      cleanup();
      return { ok: true };
    }

    // Signal end of audio
    if (pushStream) {
      try { pushStream.close(); } catch { /* ignore */ }
      pushStream = null;
    }

    try {
      await new Promise<void>((resolve) => {
        recognizer!.stopContinuousRecognitionAsync(
          () => resolve(),
          () => resolve(),
        );
      });
    } catch { /* ignore */ }

    cleanup();
    return { ok: true };
  });
}

function broadcast(channel: string, data: string) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      try { win.webContents.send(channel, data); } catch { /* ignore */ }
    }
  }
}

function cleanup() {
  isRunning = false;
  if (pushStream) { try { pushStream.close(); } catch { /* ignore */ } pushStream = null; }
  if (recognizer) { try { recognizer.close(); } catch { /* ignore */ } recognizer = null; }
}
