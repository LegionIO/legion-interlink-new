/**
 * RealtimeProvider — React context managing realtime audio call state.
 *
 * Handles mic capture, audio playback, call lifecycle, and auto-end-call on silence.
 * Events are broadcast on both realtime:event (for this provider) and
 * agent:stream-event (for RuntimeProvider/thread integration).
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  type FC,
  type PropsWithChildren,
} from 'react';
import { app } from '@/lib/ipc-client';
import { useConfig } from './ConfigProvider';
import { RealtimeAudioPlayer } from '@/lib/audio/realtime-playback';
import { Ringtone } from '@/lib/audio/ringtone';

/* ── Disconnect Tone ── */

/** Play a short descending two-tone to signal call disconnection. */
function playDisconnectTone(outputDeviceId?: string): void {
  try {
    const ctx = new AudioContext();
    if (outputDeviceId) {
      const ctxWithSink = ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> };
      if (typeof ctxWithSink.setSinkId === 'function') {
        void ctxWithSink.setSinkId(outputDeviceId);
      }
    }
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    gain.connect(ctx.destination);

    // First tone: 480Hz for 200ms
    const osc1 = ctx.createOscillator();
    osc1.frequency.value = 480;
    osc1.type = 'sine';
    osc1.connect(gain);
    osc1.start(ctx.currentTime);
    osc1.stop(ctx.currentTime + 0.2);

    // Second tone: 380Hz for 300ms (lower pitch = "hanging up" feel)
    const osc2 = ctx.createOscillator();
    osc2.frequency.value = 380;
    osc2.type = 'sine';
    osc2.connect(gain);
    osc2.start(ctx.currentTime + 0.22);
    osc2.stop(ctx.currentTime + 0.52);

    // Auto-close context after tones finish
    setTimeout(() => { void ctx.close(); }, 700);
  } catch {
    // Audio context may fail in some environments — ignore silently
  }
}

/* ── Types ── */

export type RealtimeCallStatus = 'idle' | 'preparing' | 'connecting' | 'connected' | 'disconnected' | 'error';

export type RealtimeCallState = {
  isInCall: boolean;
  status: RealtimeCallStatus;
  isSpeaking: boolean;       // User is speaking (VAD)
  isResponding: boolean;     // AI is generating a response
  duration: number;          // Seconds since call started
  error?: string;
  silenceCountdown?: number; // Seconds until auto-end (shown when >75% of timeout elapsed)
};

type RealtimeContextValue = {
  callState: RealtimeCallState;
  startCall: (conversationId: string) => Promise<void>;
  endCall: () => Promise<void>;
  inputLevel: number;        // 0-1, current mic input level
  outputLevel: number;       // 0-1, current playback audio level
};

const defaultState: RealtimeCallState = {
  isInCall: false,
  status: 'idle',
  isSpeaking: false,
  isResponding: false,
  duration: 0,
};

const RealtimeContext = createContext<RealtimeContextValue>({
  callState: defaultState,
  startCall: async () => {},
  endCall: async () => {},
  inputLevel: 0,
  outputLevel: 0,
});

export const useRealtime = () => useContext(RealtimeContext);

/* ── Provider ── */

export const RealtimeProvider: FC<PropsWithChildren> = ({ children }) => {
  const { config } = useConfig();
  const [callState, setCallState] = useState<RealtimeCallState>(defaultState);
  const [inputLevel, setInputLevel] = useState(0);
  const [outputLevel, setOutputLevel] = useState(0);

  const playerRef = useRef<RealtimeAudioPlayer | null>(null);
  const ringtoneRef = useRef<Ringtone | null>(null);
  const ringDelayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const micDrainTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const durationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const levelTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const lastUserSpeechRef = useRef<number>(0);
  const callActiveRef = useRef(false);

  const realtimeConfig = (config as Record<string, unknown> | null)?.realtime as {
    enabled?: boolean;
    inputDeviceId?: string;
    outputDeviceId?: string;
    autoEndCall?: { enabled?: boolean; silenceTimeoutSec?: number };
  } | undefined;

  // Cleanup function for ending a call
  const cleanup = useCallback(() => {
    callActiveRef.current = false;

    // Play disconnect tone before tearing everything down
    playDisconnectTone(realtimeConfig?.outputDeviceId);

    // Stop ringtone
    if (ringDelayTimerRef.current) {
      clearTimeout(ringDelayTimerRef.current);
      ringDelayTimerRef.current = null;
    }
    if (ringtoneRef.current) {
      ringtoneRef.current.destroy();
      ringtoneRef.current = null;
    }

    // Stop mic drain polling
    if (micDrainTimerRef.current) {
      clearInterval(micDrainTimerRef.current);
      micDrainTimerRef.current = null;
    }

    // Stop duration timer
    if (durationTimerRef.current) {
      clearInterval(durationTimerRef.current);
      durationTimerRef.current = null;
    }

    // Stop silence timer
    if (silenceTimerRef.current) {
      clearInterval(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }

    // Stop level timer
    if (levelTimerRef.current) {
      clearInterval(levelTimerRef.current);
      levelTimerRef.current = null;
    }

    // Stop mic
    void app.mic?.liveMicStop?.();

    // Stop player
    if (playerRef.current) {
      void playerRef.current.destroy();
      playerRef.current = null;
    }

    setInputLevel(0);
    setOutputLevel(0);
  }, []);

  const startCall = useCallback(async (conversationId: string) => {
    if (callActiveRef.current) return;

    // Start in "preparing" (ringing) state — memory is being gathered
    setCallState({
      isInCall: true,
      status: 'preparing',
      isSpeaking: false,
      isResponding: false,
      duration: 0,
    });

    try {
      // Initialize audio player
      const player = new RealtimeAudioPlayer();
      await player.init(realtimeConfig?.outputDeviceId);
      playerRef.current = player;

      // Start ringtone after 1 second if still preparing
      ringDelayTimerRef.current = setTimeout(() => {
        const tone = new Ringtone();
        ringtoneRef.current = tone;
        void tone.start(realtimeConfig?.outputDeviceId);
      }, 1000);

      // Start the realtime session (includes memory gathering — the "ringing" phase)
      const result = await app.realtime.startSession(conversationId);

      // Stop the ringtone
      if (ringDelayTimerRef.current) {
        clearTimeout(ringDelayTimerRef.current);
        ringDelayTimerRef.current = null;
      }
      if (ringtoneRef.current) {
        ringtoneRef.current.destroy();
        ringtoneRef.current = null;
      }

      if (result.error) {
        throw new Error(result.error);
      }

      callActiveRef.current = true;
      startTimeRef.current = Date.now();
      lastUserSpeechRef.current = Date.now();

      // Start mic capture
      const inputDeviceId = realtimeConfig?.inputDeviceId;
      await app.mic.liveMicStart(inputDeviceId);

      // Poll mic for PCM chunks and send to realtime session
      let totalChunksSent = 0;
      let lastLogTime = Date.now();
      micDrainTimerRef.current = setInterval(async () => {
        if (!callActiveRef.current) return;
        try {
          const chunks = await app.mic.liveMicDrain();
          if (chunks.length > 0) {
            // Compute input level from the latest chunk's PCM16 data
            const lastChunk = chunks[chunks.length - 1];
            setInputLevel(computePcmLevel(lastChunk));

            for (const chunk of chunks) {
              app.realtime.sendAudio(chunk);
              totalChunksSent++;
            }
            // Log every 2 seconds
            const now = Date.now();
            if (now - lastLogTime > 2000) {
              console.log(`[RealtimeProvider] Audio: ${chunks.length} chunks drained, total sent: ${totalChunksSent}, latest chunk size: ${chunks[0]?.length ?? 0} chars`);
              lastLogTime = now;
            }
          } else {
            setInputLevel(0);
          }
        } catch (err) {
          console.warn('[RealtimeProvider] Mic drain error:', err);
        }
      }, 50); // ~20fps, low latency

      // Duration timer
      durationTimerRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
        setCallState((prev) => ({ ...prev, duration: elapsed }));
      }, 1000);

      // Output level polling
      levelTimerRef.current = setInterval(() => {
        if (playerRef.current) {
          setOutputLevel(playerRef.current.getLevel());
        }
      }, 66); // ~15fps

      // Auto-end-call silence detection
      const autoEndEnabled = realtimeConfig?.autoEndCall?.enabled !== false;
      const silenceTimeoutSec = realtimeConfig?.autoEndCall?.silenceTimeoutSec ?? 60;

      if (autoEndEnabled) {
        silenceTimerRef.current = setInterval(() => {
          if (!callActiveRef.current) return;

          // Don't count silence while the AI is actively speaking or generating
          const isPlaying = playerRef.current?.playing ?? false;
          if (isPlaying) {
            // Reset the speech timer — there's active audio, not silence
            lastUserSpeechRef.current = Date.now();
            setCallState((prev) => prev.silenceCountdown ? { ...prev, silenceCountdown: undefined } : prev);
            return;
          }

          const silenceSec = (Date.now() - lastUserSpeechRef.current) / 1000;
          const threshold75 = silenceTimeoutSec * 0.75;

          if (silenceSec >= silenceTimeoutSec) {
            // Auto-end the call
            void endCallInner();
          } else if (silenceSec >= threshold75) {
            // Show countdown
            const remaining = Math.ceil(silenceTimeoutSec - silenceSec);
            setCallState((prev) => ({ ...prev, silenceCountdown: remaining }));
          } else {
            setCallState((prev) => prev.silenceCountdown ? { ...prev, silenceCountdown: undefined } : prev);
          }
        }, 1000);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      cleanup();
      setCallState({
        isInCall: false,
        status: 'error',
        isSpeaking: false,
        isResponding: false,
        duration: 0,
        error: msg,
      });
    }
  }, [realtimeConfig, cleanup]);

  const endCallInner = useCallback(async () => {
    cleanup();
    try {
      await app.realtime.endSession();
    } catch {
      // Ignore
    }
    setCallState({
      isInCall: false,
      status: 'idle',
      isSpeaking: false,
      isResponding: false,
      duration: 0,
    });
  }, [cleanup]);

  const endCall = useCallback(async () => {
    await endCallInner();
  }, [endCallInner]);

  // Hot-swap output device when config changes mid-call
  useEffect(() => {
    if (!callActiveRef.current || !playerRef.current) return;
    const deviceId = realtimeConfig?.outputDeviceId;
    console.info('[RealtimeProvider] Output device changed mid-call, switching to:', deviceId ?? '(default)');
    void playerRef.current.setOutputDevice(deviceId ?? '').then(() => {
      console.info('[RealtimeProvider] Output device switch completed');
    });
  }, [realtimeConfig?.outputDeviceId]);

  // Hot-swap input device when config changes mid-call
  useEffect(() => {
    if (!callActiveRef.current) return;
    const deviceId = realtimeConfig?.inputDeviceId;
    console.log('[RealtimeProvider] Input device changed mid-call:', deviceId ?? 'default');
    // Restart mic capture with the new device
    void (async () => {
      try {
        await app.mic.liveMicStop();
        await app.mic.liveMicStart(deviceId);
      } catch (err) {
        console.warn('[RealtimeProvider] Failed to swap input device:', err);
      }
    })();
  }, [realtimeConfig?.inputDeviceId]);

  // Subscribe to realtime events
  useEffect(() => {
    const unsubscribe = app.realtime?.onEvent?.((event: unknown) => {
      const e = event as Record<string, unknown>;
      const eventType = e.type as string;

      switch (eventType) {
        case 'status': {
          const status = e.status as RealtimeCallStatus;
          const error = e.error as string | undefined;
          setCallState((prev) => ({
            ...prev,
            status,
            error,
            isInCall: status === 'connected' || status === 'connecting' || prev.status === 'preparing',
          }));
          if (status === 'disconnected' || status === 'error') {
            cleanup();
          }
          break;
        }

        case 'input-speech': {
          const speaking = e.speaking as boolean;
          if (speaking) {
            lastUserSpeechRef.current = Date.now();
            // Barge-in: stop AI audio playback immediately when user starts speaking
            playerRef.current?.stop();
          }
          setCallState((prev) => ({
            ...prev,
            isSpeaking: speaking,
            silenceCountdown: speaking ? undefined : prev.silenceCountdown,
          }));
          break;
        }

        case 'response-started':
          setCallState((prev) => ({ ...prev, isResponding: true }));
          break;

        case 'response-done':
          setCallState((prev) => ({ ...prev, isResponding: false }));
          break;

        case 'audio': {
          const audioBase64 = e.audioBase64 as string;
          if (audioBase64 && playerRef.current) {
            playerRef.current.appendChunk(audioBase64);
          }
          break;
        }

        case 'end-call-pending': {
          // AI called end_call. The tool result has been sent back, which triggers
          // a new response (the goodbye). We need to wait until:
          //   1. The goodbye audio has been received and fully played
          //   2. No new audio chunks have arrived for a grace period
          //
          // IMPORTANT: The goodbye audio hasn't started arriving yet at this point,
          // so we must reset the player's chunk timer and wait for audio to start
          // flowing before we start checking if it's finished.
          console.info('[RealtimeProvider] end-call-pending received — waiting for goodbye audio to play');

          // Reset the chunk timer so isFinished() doesn't trigger from old chunks
          if (playerRef.current) {
            playerRef.current.resetChunkTimer();
          }

          // Wait a minimum of 2s before even starting to check, giving the API
          // time to generate and start streaming the goodbye audio
          const startCheckDelay = setTimeout(() => {
            const pollEndCall = setInterval(() => {
              const player = playerRef.current;
              // Use 2s grace period — no chunks for 2 full seconds after last one
              if (!player || player.isFinished(2000)) {
                clearInterval(pollEndCall);
                console.info('[RealtimeProvider] All audio finished playing — ending call');
                setTimeout(() => {
                  void endCallInner();
                }, 300);
              }
            }, 200);

            // Safety timeout: end after 60s max
            setTimeout(() => {
              clearInterval(pollEndCall);
              if (callActiveRef.current) {
                console.info('[RealtimeProvider] end-call safety timeout — forcing end');
                void endCallInner();
              }
            }, 60000);
          }, 2000);

          // If the call ends externally before the delay, clean up
          const checkCleanup = setInterval(() => {
            if (!callActiveRef.current) {
              clearTimeout(startCheckDelay);
              clearInterval(checkCleanup);
            }
          }, 500);
          break;
        }
      }
    });

    return () => {
      unsubscribe?.();
    };
  }, [cleanup]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (callActiveRef.current) {
        cleanup();
        void app.realtime?.endSession?.();
      }
    };
  }, [cleanup]);

  const value: RealtimeContextValue = {
    callState,
    startCall,
    endCall,
    inputLevel,
    outputLevel,
  };

  return (
    <RealtimeContext.Provider value={value}>
      {children}
    </RealtimeContext.Provider>
  );
};

/**
 * Compute audio level (0-1) from a base64-encoded PCM16 chunk.
 * Returns the peak amplitude normalized to 0-1 range.
 */
function computePcmLevel(pcmBase64: string): number {
  try {
    const binaryString = atob(pcmBase64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const int16 = new Int16Array(bytes.buffer);
    let max = 0;
    // Sample every 16th value for performance
    for (let i = 0; i < int16.length; i += 16) {
      const abs = Math.abs(int16[i]);
      if (abs > max) max = abs;
    }
    return Math.min(1, max / 32768);
  } catch {
    return 0;
  }
}
