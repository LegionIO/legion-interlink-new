/**
 * Speech adapter factories for assistant-ui runtime.
 * Uses the OS-native Web Speech API for both TTS and dictation.
 * Also provides unified factory functions that delegate to Azure AI adapters.
 */

import {
  createAzureSpeechAdapter,
  createAzureDictationAdapter,
  type AzureTtsConfig,
  type AzureSttConfig,
} from './azure-speech-adapters';

// -- Types matching @assistant-ui/core adapter interfaces --

type Unsubscribe = () => void;

export type SpeechSynthesisStatus =
  | { type: 'starting' | 'running' }
  | { type: 'ended'; reason: 'finished' | 'cancelled' | 'error'; error?: unknown };

export type SpeechSynthesisUtterance = {
  status: SpeechSynthesisStatus;
  cancel: () => void;
  subscribe: (callback: () => void) => Unsubscribe;
};

export type SpeechSynthesisAdapter = {
  speak: (text: string) => SpeechSynthesisUtterance;
};

export type DictationStatus =
  | { type: 'starting' | 'running' }
  | { type: 'ended'; reason: 'stopped' | 'cancelled' | 'error' };

export type DictationResult = {
  transcript: string;
  isFinal?: boolean;
};

export type DictationSession = {
  status: DictationStatus;
  stop: () => Promise<void>;
  cancel: () => void;
  onSpeechStart: (callback: () => void) => Unsubscribe;
  onSpeechEnd: (callback: (result: DictationResult) => void) => Unsubscribe;
  onSpeech: (callback: (result: DictationResult) => void) => Unsubscribe;
};

export type DictationAdapter = {
  listen: () => DictationSession;
  disableInputDuringDictation?: boolean;
};

// -- TTS Config --

type TtsConfig = {
  enabled: boolean;
  voice?: string;
  rate: number;
};

// -- Dictation Config --

type DictationConfig = {
  enabled: boolean;
  language?: string;
  continuous: boolean;
};

// -----------------------------------------------------------------
// TTS Adapter — wraps window.speechSynthesis
// -----------------------------------------------------------------

export function createSpeechAdapter(config: TtsConfig): SpeechSynthesisAdapter {
  return {
    speak(text: string): SpeechSynthesisUtterance {
      const listeners = new Set<() => void>();
      let status: SpeechSynthesisStatus = { type: 'starting' };
      let startedAt: number | null = null;

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = config.rate ?? 1;

      // Try to apply the configured voice
      if (config.voice) {
        const voices = window.speechSynthesis.getVoices();
        const match = voices.find((v) => v.name === config.voice);
        if (match) utterance.voice = match;
      }

      const notify = () => listeners.forEach((cb) => cb());

      utterance.onstart = () => {
        startedAt = Date.now();
        status = { type: 'running' };
        notify();
      };

      utterance.onend = () => {
        status = { type: 'ended', reason: 'finished' };
        notify();
        // Record TTS usage
        const durationSec = startedAt ? (Date.now() - startedAt) / 1000 : 0;
        if (durationSec > 0) {
          try {
            const bridge = (window as { app?: { usage?: { recordEvent: (e: unknown) => Promise<unknown> } } }).app;
            bridge?.usage?.recordEvent({ modality: 'tts', durationSec: Math.round(durationSec * 10) / 10 });
          } catch { /* ignore */ }
        }
      };

      utterance.onerror = (event) => {
        if ((event as SpeechSynthesisErrorEvent).error === 'canceled') {
          status = { type: 'ended', reason: 'cancelled' };
        } else {
          status = { type: 'ended', reason: 'error', error: event };
        }
        notify();
      };

      window.speechSynthesis.speak(utterance);

      return {
        get status() {
          return status;
        },
        cancel() {
          window.speechSynthesis.cancel();
          status = { type: 'ended', reason: 'cancelled' };
          notify();
        },
        subscribe(callback: () => void): Unsubscribe {
          listeners.add(callback);
          return () => listeners.delete(callback);
        },
      };
    },
  };
}

// -----------------------------------------------------------------
// Dictation Adapter — wraps Web Speech Recognition API
// -----------------------------------------------------------------

interface SpeechRecognitionInstance extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
}

interface SpeechRecognitionConstructor {
  new (): SpeechRecognitionInstance;
}

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

export function isDictationSupported(): boolean {
  return typeof window !== 'undefined' &&
    !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

export function createDictationAdapter(config: DictationConfig): DictationAdapter {
  return {
    listen(): DictationSession {
      const SpeechRecognitionClass = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognitionClass) {
        throw new Error('Speech recognition is not supported in this browser.');
      }

      const recognition = new SpeechRecognitionClass();
      recognition.lang = config.language ?? 'en-US';
      recognition.continuous = config.continuous ?? true;
      recognition.interimResults = true;

      let status: DictationStatus = { type: 'starting' };
      const speechStartListeners = new Set<() => void>();
      const speechEndListeners = new Set<(result: DictationResult) => void>();
      const speechListeners = new Set<(result: DictationResult) => void>();
      const errorListeners = new Set<(error: string) => void>();

      recognition.addEventListener('start', () => {
        console.log('[Dictation] Recognition started');
        status = { type: 'running' };
      });

      recognition.addEventListener('audiostart', () => {
        console.log('[Dictation] Audio capture started');
      });

      recognition.addEventListener('soundstart', () => {
        console.log('[Dictation] Sound detected');
      });

      recognition.addEventListener('speechstart', () => {
        console.log('[Dictation] Speech detected');
        speechStartListeners.forEach((cb) => cb());
      });

      recognition.addEventListener('speechend', () => {
        console.log('[Dictation] Speech ended');
      });

      recognition.addEventListener('result', (event: Event) => {
        const e = event as Event & { results: SpeechRecognitionResultList; resultIndex: number };
        console.log('[Dictation] Result event:', e.results.length, 'results, index:', e.resultIndex);
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const result = e.results[i];
          if (!result || !result[0]) continue;
          const transcript = result[0].transcript;
          const isFinal = result.isFinal;
          console.log('[Dictation] Transcript:', JSON.stringify(transcript), 'isFinal:', isFinal);
          speechListeners.forEach((cb) => cb({ transcript, isFinal }));
          if (isFinal) {
            speechEndListeners.forEach((cb) => cb({ transcript, isFinal: true }));
          }
        }
      });

      recognition.addEventListener('nomatch', () => {
        console.log('[Dictation] No speech match detected');
      });

      recognition.addEventListener('end', () => {
        console.log('[Dictation] Recognition ended');
        if (status.type !== 'ended') {
          status = { type: 'ended', reason: 'stopped' };
        }
      });

      recognition.addEventListener('error', (event: Event) => {
        const errorEvent = event as Event & { error?: string; message?: string };
        const errorType = errorEvent.error ?? errorEvent.message ?? 'unknown';
        console.error('[Dictation] Error:', errorType);
        status = { type: 'ended', reason: 'error' };
        errorListeners.forEach((cb) => cb(errorType));
      });

      try {
        recognition.start();
        console.log('[Dictation] Recognition.start() called');
      } catch (err) {
        console.error('[Dictation] Failed to start:', err);
        status = { type: 'ended', reason: 'error' };
        throw err;
      }

      return {
        get status() {
          return status;
        },
        async stop() {
          recognition.stop();
        },
        cancel() {
          recognition.abort();
          status = { type: 'ended', reason: 'cancelled' };
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
        /** Non-standard extension: listen for errors */
        onError(callback: (error: string) => void) {
          errorListeners.add(callback);
          return () => errorListeners.delete(callback);
        },
      } as DictationSession & { onError: (callback: (error: string) => void) => Unsubscribe };
    },
  };
}

// -----------------------------------------------------------------
// Unified factories — delegate to native or Azure adapters
// -----------------------------------------------------------------

export type AudioProvider = 'native' | 'azure';

export { type AzureTtsConfig, type AzureSttConfig } from './azure-speech-adapters';

/**
 * Create a TTS adapter based on the configured provider.
 * Falls back to native if Azure is selected but credentials are missing.
 */
export function createUnifiedSpeechAdapter(opts: {
  provider: AudioProvider;
  enabled: boolean;
  voice?: string;
  rate: number;
  azure?: AzureTtsConfig;
}): SpeechSynthesisAdapter | undefined {
  if (!opts.enabled) return undefined;

  if (opts.provider === 'azure' && opts.azure?.subscriptionKey) {
    return createAzureSpeechAdapter(opts.azure);
  }

  // Fall back to native (also covers azure-selected-but-no-key)
  if (opts.provider === 'azure' && !opts.azure?.subscriptionKey) {
    console.warn('[Audio] Azure TTS selected but no subscription key configured, falling back to native');
  }
  return createSpeechAdapter({ enabled: true, voice: opts.voice, rate: opts.rate });
}

/**
 * Create a dictation adapter based on the configured provider.
 * Falls back to native if Azure is selected but credentials are missing.
 */
export function createUnifiedDictationAdapter(opts: {
  provider: AudioProvider;
  enabled: boolean;
  language?: string;
  continuous: boolean;
  azure?: AzureSttConfig;
}): DictationAdapter | undefined {
  if (!opts.enabled) return undefined;

  if (opts.provider === 'azure' && opts.azure?.subscriptionKey) {
    return createAzureDictationAdapter(opts.azure);
  }

  // Fall back to native (also covers azure-selected-but-no-key)
  if (opts.provider === 'azure' && !opts.azure?.subscriptionKey) {
    console.warn('[Audio] Azure STT selected but no subscription key configured, falling back to native');
  }
  return createDictationAdapter({ enabled: true, language: opts.language, continuous: opts.continuous });
}

/**
 * Check if dictation is supported for the given provider.
 * Azure STT uses WebSocket, so doesn't depend on browser's Web Speech API.
 * Native STT requires window.SpeechRecognition.
 */
export function isDictationSupportedForProvider(provider: AudioProvider, azureKeySet?: boolean): boolean {
  if (provider === 'azure' && azureKeySet) {
    return true; // Azure uses WebSocket — always available
  }
  return isDictationSupported(); // Check native browser support
}
