/**
 * Azure AI Speech Service adapters for TTS and STT.
 *
 * TTS uses the REST API (POST /cognitiveservices/v1 with SSML body).
 * STT uses the REST API for short audio (POST to /speech/recognition/conversation/cognitiveservices/v1).
 *
 * Both support:
 *  - Standard Azure endpoints (constructed from region)
 *  - Custom/enterprise endpoints (same REST protocol, user-provided URL)
 */

import type {
  SpeechSynthesisAdapter,
  SpeechSynthesisAdapterTypes,
  DictationAdapter,
  DictationAdapterTypes,
} from './speech-adapters';

// ─── Types ───────────────────────────────────────────────────────────────────

export type AzureTtsConfig = {
  endpoint?: string;        // Custom base URL (overrides region)
  region?: string;          // e.g. "eastus"
  subscriptionKey: string;  // Ocp-Apim-Subscription-Key
  voice: string;            // e.g. "en-US-JennyNeural"
  outputFormat: string;     // e.g. "audio-24khz-48kbitrate-mono-mp3"
  rate: number;             // SSML prosody rate multiplier (0.5–3)
};

export type AzureSttConfig = {
  endpoint?: string;        // Custom endpoint base URL
  region?: string;          // e.g. "eastus"
  subscriptionKey: string;  // Ocp-Apim-Subscription-Key
  language: string;         // e.g. "en-US"
  continuous: boolean;
  inputDeviceId?: string;   // specific mic device ID
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

type Unsubscribe = () => void;

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildTtsEndpoint(config: AzureTtsConfig): string {
  const base = config.endpoint
    ? config.endpoint.replace(/\/+$/, '')
    : `https://${config.region ?? 'eastus'}.tts.speech.microsoft.com`;
  return `${base}/tts/cognitiveservices/v1`;
}

function buildSttEndpoint(config: AzureSttConfig): string {
  const base = config.endpoint
    ? config.endpoint.replace(/\/+$/, '')
    : `https://${config.region ?? 'eastus'}.stt.speech.microsoft.com`;
  return `${base}/stt/speech/recognition/conversation/cognitiveservices/v1?language=${encodeURIComponent(config.language)}&format=detailed`;
}

function buildSsml(voice: string, rate: number, text: string): string {
  // SSML prosody rate: percentage relative to 1x, e.g. 1.5 → "+50%", 0.5 → "-50%"
  const pctDelta = Math.round((rate - 1) * 100);
  const rateStr = pctDelta >= 0 ? `+${pctDelta}%` : `${pctDelta}%`;
  return [
    `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>`,
    `  <voice name='${escapeXml(voice)}'>`,
    `    <prosody rate='${rateStr}'>${escapeXml(text)}</prosody>`,
    `  </voice>`,
    `</speak>`,
  ].join('\n');
}

/** Map from output format to the MIME type for Audio element playback. */
function mimeForOutputFormat(fmt: string): string {
  if (fmt.includes('mp3')) return 'audio/mpeg';
  if (fmt.includes('opus') && fmt.includes('ogg')) return 'audio/ogg; codecs=opus';
  if (fmt.includes('opus') && fmt.includes('webm')) return 'audio/webm; codecs=opus';
  if (fmt.includes('pcm') || fmt.includes('riff')) return 'audio/wav';
  return 'audio/mpeg'; // safe fallback
}

// ─── Azure TTS Adapter ──────────────────────────────────────────────────────

export function createAzureSpeechAdapter(config: AzureTtsConfig): SpeechSynthesisAdapter {
  return {
    speak(text: string): SpeechSynthesisAdapterTypes.Utterance {
      const listeners = new Set<() => void>();
      let status: SpeechSynthesisAdapterTypes.Status = { type: 'starting' };
      const notify = () => listeners.forEach((cb) => cb());

      // Validate credentials
      if (!config.subscriptionKey) {
        console.error('[Azure TTS] No subscription key configured');
        status = { type: 'ended', reason: 'error', error: 'Azure subscription key not configured' };
        queueMicrotask(notify);
        return {
          get status() { return status; },
          cancel() {},
          subscribe(cb) { listeners.add(cb); return () => listeners.delete(cb); },
        };
      }

      const abortController = new AbortController();
      let audioElement: HTMLAudioElement | null = null;
      let blobUrl: string | null = null;

      const endpoint = buildTtsEndpoint(config);
      const ssml = buildSsml(config.voice, config.rate, text);

      console.log('[Azure TTS] Speaking text (%d chars), endpoint: %s, voice: %s, format: %s', text.length, endpoint, config.voice, config.outputFormat);

      (async () => {
        try {
          console.log('[Azure TTS] Sending request...');
          const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Ocp-Apim-Subscription-Key': config.subscriptionKey,
              'Content-Type': 'application/ssml+xml',
              'X-Microsoft-OutputFormat': config.outputFormat,
              'User-Agent': 'LegionAithena',
            },
            body: ssml,
            signal: abortController.signal,
          });

          console.log('[Azure TTS] Response: HTTP %d, content-type: %s', response.status, response.headers.get('content-type'));

          if (!response.ok) {
            const body = await response.text().catch(() => '');
            throw new Error(`Azure TTS HTTP ${response.status}: ${body || response.statusText}`);
          }

          const arrayBuffer = await response.arrayBuffer();
          console.log('[Azure TTS] Received %d bytes of audio', arrayBuffer.byteLength);

          // Use HTMLAudioElement with Blob URL — reliable across all formats
          // (decodeAudioData can fail on certain MP3/Opus formats in some Electron builds)
          const mime = mimeForOutputFormat(config.outputFormat);
          const blob = new Blob([arrayBuffer], { type: mime });
          blobUrl = URL.createObjectURL(blob);

          audioElement = new Audio(blobUrl);

          audioElement.onplay = () => {
            console.log('[Azure TTS] Audio playback started');
            status = { type: 'running' };
            notify();
          };

          audioElement.onended = () => {
            if (status.type !== 'ended') {
              console.log('[Azure TTS] Audio playback ended');
              status = { type: 'ended', reason: 'finished' };
              notify();
            }
            cleanupBlob();
          };

          audioElement.onerror = (e) => {
            if (status.type !== 'ended') {
              console.error('[Azure TTS] Audio playback error:', audioElement?.error?.message ?? e);
              status = { type: 'ended', reason: 'error', error: `Audio playback failed: ${audioElement?.error?.message ?? 'unknown'}` };
              notify();
            }
            cleanupBlob();
          };

          console.log('[Azure TTS] Calling audio.play()...');
          await audioElement.play();
          console.log('[Azure TTS] audio.play() resolved');
        } catch (err) {
          if ((err as Error).name === 'AbortError') {
            status = { type: 'ended', reason: 'cancelled' };
          } else {
            console.error('[Azure TTS] Error:', err);
            status = { type: 'ended', reason: 'error', error: err };
          }
          notify();
          cleanupBlob();
        }
      })();

      function cleanupBlob() {
        if (blobUrl) {
          URL.revokeObjectURL(blobUrl);
          blobUrl = null;
        }
      }

      return {
        get status() { return status; },
        cancel() {
          abortController.abort();
          if (audioElement) {
            audioElement.pause();
            audioElement.src = '';
            audioElement = null;
          }
          cleanupBlob();
          if (status.type !== 'ended') {
            status = { type: 'ended', reason: 'cancelled' };
            notify();
          }
        },
        subscribe(callback: () => void): Unsubscribe {
          listeners.add(callback);
          return () => listeners.delete(callback);
        },
      };
    },
  };
}

// ─── Azure STT Adapter (via main-process mic recording) ─────────────────────
//
// Recording happens in a hidden BrowserWindow in the main process (which has
// proper macOS microphone permissions). The renderer communicates via IPC:
//   legion.mic.startRecording()  → starts mic capture
//   legion.mic.stopRecording()   → stops capture, returns WAV as base64
// The WAV is then sent to the Azure STT REST API from the renderer.

export function createAzureDictationAdapter(config: AzureSttConfig): DictationAdapter {
  return {
    listen(): DictationAdapterTypes.Session {
      if (!config.subscriptionKey) {
        throw new Error('Azure subscription key not configured for STT');
      }

      let status: DictationAdapterTypes.Status = { type: 'starting' };
      const speechStartListeners = new Set<() => void>();
      const speechEndListeners = new Set<(result: DictationAdapterTypes.Result) => void>();
      const speechListeners = new Set<(result: DictationAdapterTypes.Result) => void>();
      const errorListeners = new Set<(error: string) => void>();
      const recognizingListeners = new Set<(recognizing: boolean) => void>();

      let stopRequested = false;
      let recording = false;

      const sttEndpoint = buildSttEndpoint(config);
      console.log('[Azure STT] listen() — endpoint: %s, language: %s, continuous: %s', sttEndpoint, config.language, config.continuous);

      const setEnded = (reason: 'stopped' | 'cancelled' | 'error', errorMsg?: string) => {
        if (status.type === 'ended') return;
        console.log('[Azure STT] setEnded: reason=%s, error=%s', reason, errorMsg ?? 'none');
        status = { type: 'ended', reason };
        if (errorMsg) {
          errorListeners.forEach((cb) => cb(errorMsg));
        }
      };

      async function recognizeWav(wavBase64: string): Promise<string | null> {
        console.log('[Azure STT] recognizeWav: %d base64 chars', wavBase64.length);
        recognizingListeners.forEach((cb) => cb(true));
        try {
          // Decode base64 to binary
          const binary = atob(wavBase64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          const wavBlob = new Blob([bytes], { type: 'audio/wav' });
          console.log('[Azure STT] WAV blob: %d bytes', wavBlob.size);

          const response = await fetch(sttEndpoint, {
            method: 'POST',
            headers: {
              'Ocp-Apim-Subscription-Key': config.subscriptionKey,
              'Content-Type': 'audio/wav; codecs=audio/pcm; samplerate=16000',
              'Accept': 'application/json',
            },
            body: wavBlob,
          });

          console.log('[Azure STT] HTTP %d', response.status);
          if (!response.ok) {
            const body = await response.text().catch(() => '');
            throw new Error(`Azure STT HTTP ${response.status}: ${body || response.statusText}`);
          }

          const result = await response.json();
          console.log('[Azure STT] Result:', JSON.stringify(result));

          if (result.RecognitionStatus === 'Success') {
            return (result.NBest?.[0]?.Display ?? result.NBest?.[0]?.Lexical ?? result.DisplayText ?? '') || null;
          }
          if (result.RecognitionStatus === 'NoMatch') { console.log('[Azure STT] No match'); return null; }
          if (result.RecognitionStatus === 'InitialSilenceTimeout') { console.log('[Azure STT] Silence'); return null; }
          console.log('[Azure STT] Unhandled status:', result.RecognitionStatus);
          return null;
        } finally {
          recognizingListeners.forEach((cb) => cb(false));
        }
      }

      // Start recording via main process
      (async () => {
        try {
          const mic = window.legion?.mic;
          if (!mic) {
            throw new Error('Mic recorder IPC not available');
          }

          // List available devices for debugging
          const devices = await mic.listDevices();
          console.log('[Azure STT] Available input devices:', JSON.stringify(devices));

          console.log('[Azure STT] Starting main-process recording, deviceId=%s...', config.inputDeviceId ?? 'default');
          const startResult = await mic.startRecording(config.inputDeviceId);
          console.log('[Azure STT] Start result:', JSON.stringify(startResult));
          if (startResult.error) {
            throw new Error(startResult.error);
          }
          if (startResult.silent) {
            console.warn('[Azure STT] ⚠️ Mic reports SILENT — recording may not capture audio');
          }

          recording = true;
          status = { type: 'running' };
          speechStartListeners.forEach((cb) => cb());
          console.log('[Azure STT] Recording active');

        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          console.error('[Azure STT] Start error:', errorMsg);
          setEnded('error', errorMsg);
        }
      })();

      return {
        get status() { return status; },

        async stop() {
          console.log('[Azure STT] stop() called, recording=%s', recording);
          if (stopRequested) return;
          stopRequested = true;

          const mic = window.legion?.mic;
          if (!mic || !recording) {
            setEnded('stopped');
            return;
          }

          try {
            recording = false;
            console.log('[Azure STT] Stopping main-process recording...');
            const result = await mic.stopRecording();

            if (result.error) {
              console.error('[Azure STT] Stop error:', result.error);
              setEnded('error', result.error);
              return;
            }

            if (!result.wavBase64) {
              console.log('[Azure STT] No audio data returned');
              setEnded('stopped');
              return;
            }

            console.log('[Azure STT] Got WAV: %d b64 chars, %.2fs, amplitude=%.6f',
              result.wavBase64.length, result.durationSec ?? 0, result.maxAmplitude ?? 0);

            // Check if recording was silent
            if ((result.maxAmplitude ?? 0) < 0.001) {
              console.warn('[Azure STT] ⚠️ Recording was SILENT (amplitude %.6f). Skipping Azure API call.', result.maxAmplitude);
              console.warn('[Azure STT] Check: System Settings > Sound > Input — is the correct mic selected?');
              setEnded('stopped');
              return;
            }

            // Send to Azure for recognition
            const transcript = await recognizeWav(result.wavBase64);
            if (transcript) {
              console.log('[Azure STT] TRANSCRIPT: "%s"', transcript);
              speechListeners.forEach((cb) => cb({ transcript, isFinal: true }));
              speechEndListeners.forEach((cb) => cb({ transcript, isFinal: true }));
            } else {
              console.log('[Azure STT] No transcript from audio (speech not recognized)');
            }
          } catch (err) {
            console.error('[Azure STT] Recognition error:', err);
          }

          setEnded('stopped');
        },

        cancel() {
          console.log('[Azure STT] cancel()');
          stopRequested = true;
          recording = false;
          window.legion?.mic?.cancelRecording();
          setEnded('cancelled');
        },

        onSpeechStart(callback) {
          speechStartListeners.add(callback);
          return () => speechStartListeners.delete(callback);
        },
        onSpeechEnd(callback) {
          speechEndListeners.add(callback);
          return () => speechEndListeners.delete(callback);
        },
        onSpeech(callback) {
          speechListeners.add(callback);
          return () => speechListeners.delete(callback);
        },
        onError(callback: (error: string) => void) {
          errorListeners.add(callback);
          return () => errorListeners.delete(callback);
        },
        onRecognizing(callback: (recognizing: boolean) => void) {
          recognizingListeners.add(callback);
          return () => recognizingListeners.delete(callback);
        },
      } as DictationAdapterTypes.Session & {
        onError: (callback: (error: string) => void) => Unsubscribe;
        onRecognizing: (callback: (recognizing: boolean) => void) => Unsubscribe;
      };
    },
  };
}
