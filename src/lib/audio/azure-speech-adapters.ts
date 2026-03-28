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
  SpeechSynthesisStatus,
  SpeechSynthesisUtterance,
  DictationAdapter,
  DictationResult,
  DictationSession,
  DictationStatus,
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
    speak(text: string): SpeechSynthesisUtterance {
      const listeners = new Set<() => void>();
      let status: SpeechSynthesisStatus = { type: 'starting' };
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
              'User-Agent': 'LegionInterlink',
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

// ─── Azure STT Adapter (Live Streaming via Speech SDK) ──────────────────────
//
// Uses the Azure Speech SDK running in the main process for real-time
// streaming recognition. Audio is captured by the hidden mic-recorder window,
// piped as PCM16 chunks to the SDK, and partial/final results are broadcast
// to the renderer in real-time.
//
// Flow:
//   1. Start mic capture in hidden window (stt:live-mic-start)
//   2. Start SDK recognizer (stt:live-start)
//   3. Poll audio chunks (stt:live-mic-drain) and push to SDK (stt:live-audio) at ~50ms
//   4. Receive partial (stt:partial) and final (stt:final) transcripts via events
//   5. On stop: tear down mic + SDK (stt:live-mic-stop, stt:live-stop)

export function createAzureDictationAdapter(config: AzureSttConfig): DictationAdapter {
  return {
    listen(): DictationSession {
      if (!config.subscriptionKey) {
        throw new Error('Azure subscription key not configured for STT');
      }

      let status: DictationStatus = { type: 'starting' };
      const speechStartListeners = new Set<() => void>();
      const speechEndListeners = new Set<(result: DictationResult) => void>();
      const speechListeners = new Set<(result: DictationResult) => void>();
      const errorListeners = new Set<(error: string) => void>();

      let stopRequested = false;
      let drainTimer: ReturnType<typeof setInterval> | null = null;
      let unsubPartial: (() => void) | null = null;
      let unsubFinal: (() => void) | null = null;
      let unsubError: (() => void) | null = null;
      // Track committed (final) text so partials can be shown as preview
      let committedText = '';

      console.log('[Azure STT] listen() — live mode, language=%s', config.language);

      const setEnded = (reason: 'stopped' | 'cancelled' | 'error', errorMsg?: string) => {
        if (status.type === 'ended') return;
        console.log('[Azure STT] setEnded: reason=%s, error=%s', reason, errorMsg ?? 'none');
        status = { type: 'ended', reason };
        // Cleanup
        if (drainTimer) { clearInterval(drainTimer); drainTimer = null; }
        unsubPartial?.(); unsubFinal?.(); unsubError?.();
        if (errorMsg) {
          errorListeners.forEach((cb) => cb(errorMsg));
        }
      };

      const teardown = async () => {
        if (drainTimer) { clearInterval(drainTimer); drainTimer = null; }
        const mic = window.legion?.mic;
        if (mic) {
          await mic.liveMicStop().catch(() => {});
          await mic.liveStop().catch(() => {});
        }
      };

      // Start everything
      (async () => {
        try {
          const mic = window.legion?.mic;
          if (!mic) throw new Error('Mic IPC not available');

          // 1. Start mic capture in hidden window
          console.log('[Azure STT] Starting mic capture, deviceId=%s', config.inputDeviceId ?? 'default');
          const micResult = await mic.liveMicStart(config.inputDeviceId);
          if (micResult.error) throw new Error(`Mic start failed: ${micResult.error}`);

          // 2. Start SDK recognizer in main process
          console.log('[Azure STT] Starting SDK recognizer...');
          const sttResult = await mic.liveStart({
            subscriptionKey: config.subscriptionKey,
            region: config.region,
            endpoint: config.endpoint,
            language: config.language,
          });
          if (sttResult.error) throw new Error(`SDK start failed: ${sttResult.error}`);

          // 3. Subscribe to partial/final/error events from main process
          unsubPartial = mic.onPartial((text) => {
            // Partial = in-progress hypothesis. Send as non-final for live preview.
            speechListeners.forEach((cb) => cb({ transcript: text, isFinal: false }));
          });

          unsubFinal = mic.onFinal((text) => {
            // Final = committed segment. Append to committed text.
            console.log('[Azure STT] Final segment: "%s"', text);
            committedText += (committedText ? ' ' : '') + text;
            speechListeners.forEach((cb) => cb({ transcript: committedText, isFinal: true }));
            speechEndListeners.forEach((cb) => cb({ transcript: committedText, isFinal: true }));
          });

          unsubError = mic.onSttError((err) => {
            console.error('[Azure STT] SDK error:', err);
            teardown();
            setEnded('error', err);
          });

          // 4. Start audio drain pump: poll PCM chunks from hidden window → push to SDK
          drainTimer = setInterval(async () => {
            if (stopRequested) return;
            try {
              const chunks = await mic.liveMicDrain();
              for (const chunk of chunks) {
                mic.liveAudio(chunk);
              }
            } catch { /* ignore */ }
          }, 50);

          status = { type: 'running' };
          speechStartListeners.forEach((cb) => cb());
          console.log('[Azure STT] Live STT active');

        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error('[Azure STT] Start error:', msg);
          await teardown();
          setEnded('error', msg);
        }
      })();

      return {
        get status() { return status; },

        async stop() {
          console.log('[Azure STT] stop()');
          if (stopRequested) return;
          stopRequested = true;
          await teardown();
          setEnded('stopped');
        },

        cancel() {
          console.log('[Azure STT] cancel()');
          stopRequested = true;
          teardown();
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
      } as DictationSession & {
        onError: (callback: (error: string) => void) => Unsubscribe;
      };
    },
  };
}
