import { useState, useEffect, useRef, useCallback, useMemo, type FC } from 'react';
import { EyeIcon, EyeOffIcon, Volume2Icon, SquareIcon, SearchIcon, XIcon } from 'lucide-react';
import type { SettingsProps } from './shared';
import { Toggle, SliderField, settingsSelectClass } from './shared';
import { createAzureSpeechAdapter, type AzureTtsConfig } from '@/lib/audio/azure-speech-adapters';
import type { SpeechSynthesisUtterance } from '@/lib/audio/speech-adapters';
import { AZURE_NEURAL_VOICES } from '@/lib/azureNeuralVoices';

const PREVIEW_TEXT = 'Hello! This is a preview of how this voice sounds.';

type AudioProvider = 'native' | 'azure';

type AzureConfig = {
  endpoint?: string;
  region?: string;
  subscriptionKey?: string;
  ttsVoice?: string;
  ttsOutputFormat?: string;
  ttsRate?: number;
  sttLanguage?: string;
};

type AudioConfig = {
  provider?: AudioProvider;
  azure?: AzureConfig;
  tts?: {
    enabled?: boolean;
    voice?: string;
    rate?: number;
  };
  dictation?: {
    enabled?: boolean;
    language?: string;
    continuous?: boolean;
  };
};

// ─── Voice Preview Button ────────────────────────────────────────────────────

type PreviewState = 'idle' | 'loading' | 'playing';

const VoicePreviewButton: FC<{
  provider: AudioProvider;
  nativeVoice?: string;
  nativeRate?: number;
  azure?: AzureConfig;
}> = ({ provider, nativeVoice, nativeRate, azure }) => {
  const [state, setState] = useState<PreviewState>('idle');
  const cancelRef = useRef<(() => void) | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cancelRef.current?.();
      cancelRef.current = null;
    };
  }, []);

  const handleStop = useCallback(() => {
    cancelRef.current?.();
    cancelRef.current = null;
    utteranceRef.current = null;
    setState('idle');
  }, []);

  const handlePreview = useCallback(() => {
    if (state !== 'idle') {
      handleStop();
      return;
    }

    if (provider === 'azure') {
      // Azure TTS preview
      if (!azure?.subscriptionKey) {
        console.warn('[Voice Preview] No Azure subscription key configured');
        return;
      }

      const config: AzureTtsConfig = {
        endpoint: azure.endpoint,
        region: azure.region ?? 'eastus',
        subscriptionKey: azure.subscriptionKey,
        voice: azure.ttsVoice ?? 'en-US-JennyNeural',
        outputFormat: azure.ttsOutputFormat ?? 'audio-24khz-48kbitrate-mono-mp3',
        rate: azure.ttsRate ?? 1,
      };

      const adapter = createAzureSpeechAdapter(config);
      const utterance = adapter.speak(PREVIEW_TEXT);
      utteranceRef.current = utterance;
      cancelRef.current = () => utterance.cancel();
      setState('loading');

      const unsub = utterance.subscribe(() => {
        const s = utterance.status;
        if (s.type === 'running') {
          setState('playing');
        } else if (s.type === 'ended') {
          setState('idle');
          cancelRef.current = null;
          utteranceRef.current = null;
          unsub();
        }
      });
    } else {
      // Native TTS preview
      if (typeof window === 'undefined' || !window.speechSynthesis) {
        console.warn('[Voice Preview] speechSynthesis not available');
        return;
      }

      window.speechSynthesis.cancel(); // stop any current speech

      const utterance = new SpeechSynthesisUtterance(PREVIEW_TEXT);
      utterance.rate = nativeRate ?? 1;

      if (nativeVoice) {
        const voices = window.speechSynthesis.getVoices();
        const match = voices.find((v) => v.name === nativeVoice);
        if (match) utterance.voice = match;
      }

      utterance.onstart = () => setState('playing');
      utterance.onend = () => {
        setState('idle');
        cancelRef.current = null;
      };
      utterance.onerror = () => {
        setState('idle');
        cancelRef.current = null;
      };

      cancelRef.current = () => window.speechSynthesis.cancel();
      setState('loading');
      window.speechSynthesis.speak(utterance);
    }
  }, [state, provider, nativeVoice, nativeRate, azure, handleStop]);

  const disabled = provider === 'azure' && !azure?.subscriptionKey;

  return (
    <button
      type="button"
      onClick={state === 'idle' ? handlePreview : handleStop}
      disabled={disabled}
      className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition-all ${
        disabled
          ? 'border-border/40 text-muted-foreground/40 cursor-not-allowed'
          : state === 'idle'
            ? 'border-border/70 bg-card/70 text-foreground hover:bg-muted/60'
            : state === 'loading'
              ? 'border-primary/40 bg-primary/5 text-primary'
              : 'border-primary/40 bg-primary/10 text-primary'
      }`}
      title={disabled ? 'Set a subscription key first' : state === 'idle' ? 'Preview voice' : 'Stop preview'}
    >
      {state === 'loading' ? (
        <>
          <span className="h-3 w-3 rounded-full border-[1.5px] border-primary border-t-transparent animate-spin" />
          Loading...
        </>
      ) : state === 'playing' ? (
        <>
          <SquareIcon className="h-3 w-3" />
          Stop
        </>
      ) : (
        <>
          <Volume2Icon className="h-3 w-3" />
          Preview Voice
        </>
      )}
    </button>
  );
};

// ─── Main Component ──────────────────────────────────────────────────────────

export const AudioSettings: FC<SettingsProps> = ({ config, updateConfig }) => {
  const audio = (config as Record<string, unknown>).audio as AudioConfig | undefined;
  const provider: AudioProvider = audio?.provider ?? 'native';
  const azure = audio?.azure;
  const tts = audio?.tts;
  const dictation = audio?.dictation;
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  // Load available OS voices (only needed for native provider)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;

    const loadVoices = () => {
      const available = window.speechSynthesis.getVoices();
      if (available.length > 0) setVoices(available);
    };

    loadVoices();
    window.speechSynthesis.addEventListener('voiceschanged', loadVoices);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', loadVoices);
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold">Audio</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Configure text-to-speech and voice dictation. Choose between your OS&apos;s
          built-in speech services or Azure AI Speech Service.
        </p>
      </div>

      {/* ── Provider Selector ── */}
      <div>
        <label className="text-[10px] text-muted-foreground block mb-0.5">Speech Provider</label>
        <select
          className={settingsSelectClass}
          value={provider}
          onChange={(e) => updateConfig('audio.provider', e.target.value)}
        >
          <option value="native">OS Native (Web Speech API)</option>
          <option value="azure">Azure AI Speech Service</option>
        </select>
      </div>

      {/* ── Azure Configuration ── */}
      {provider === 'azure' && (
        <AzureConfigPanel azure={azure} updateConfig={updateConfig} />
      )}

      {/* ── Text-to-Speech ── */}
      <div className="space-y-3 border-t border-border/50 pt-4">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Text-to-Speech</h4>

        <Toggle
          label="Enable text-to-speech"
          checked={tts?.enabled ?? true}
          onChange={(v) => updateConfig('audio.tts.enabled', v)}
        />

        {(tts?.enabled ?? true) && provider === 'native' && (
          <div className="space-y-3 pl-1">
            {/* Voice Selection */}
            <div>
              <label className="text-[10px] text-muted-foreground block mb-0.5">Voice</label>
              <select
                className={settingsSelectClass}
                value={tts?.voice ?? ''}
                onChange={(e) => updateConfig('audio.tts.voice', e.target.value || undefined)}
              >
                <option value="">System Default</option>
                {voices.map((v) => (
                  <option key={v.name} value={v.name}>
                    {v.name} ({v.lang})
                  </option>
                ))}
              </select>
              {voices.length === 0 && (
                <span className="text-[10px] text-muted-foreground/60 mt-0.5 block">
                  No voices available — your OS may still be loading them.
                </span>
              )}
            </div>

            {/* Rate Slider */}
            <SliderField
              label={`Speed: ${(tts?.rate ?? 1).toFixed(1)}x`}
              value={tts?.rate ?? 1}
              min={0.5}
              max={3}
              step={0.1}
              onChange={(v) => updateConfig('audio.tts.rate', v)}
            />

            {/* Native Voice Preview */}
            <VoicePreviewButton
              provider="native"
              nativeVoice={tts?.voice}
              nativeRate={tts?.rate}
            />
          </div>
        )}
      </div>

      {/* ── Dictation ── */}
      <div className="space-y-3 border-t border-border/50 pt-4">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Dictation</h4>

        <Toggle
          label="Enable voice dictation"
          checked={dictation?.enabled ?? true}
          onChange={(v) => updateConfig('audio.dictation.enabled', v)}
        />

        {(dictation?.enabled ?? true) && provider === 'native' && (
          <div className="space-y-3 pl-1">
            {/* Language */}
            <div>
              <label className="text-[10px] text-muted-foreground block mb-0.5">Language (BCP-47)</label>
              <input
                type="text"
                className="w-full rounded-xl border border-border/70 bg-card/80 px-3 py-2 text-xs outline-none"
                value={dictation?.language ?? 'en-US'}
                onChange={(e) => updateConfig('audio.dictation.language', e.target.value)}
                placeholder="en-US"
              />
              <span className="text-[10px] text-muted-foreground/60 mt-0.5 block">
                e.g. en-US, en-GB, es-ES, fr-FR, de-DE, ja-JP
              </span>
            </div>

            {/* Continuous */}
            <Toggle
              label="Continuous listening"
              checked={dictation?.continuous ?? true}
              onChange={(v) => updateConfig('audio.dictation.continuous', v)}
            />
            <span className="text-[10px] text-muted-foreground/60 block -mt-2 pl-1">
              Keep the microphone active between pauses instead of stopping after each phrase.
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Azure Configuration Panel ───────────────────────────────────────────────

const PasswordField: FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}> = ({ label, value, onChange, placeholder }) => {
  const [visible, setVisible] = useState(false);

  return (
    <div>
      <label className="text-[10px] text-muted-foreground block mb-0.5">{label}</label>
      <div className="flex items-center gap-2 rounded-xl border border-border/70 bg-card/80 pr-2">
        <input
          type={visible ? 'text' : 'password'}
          className="min-w-0 flex-1 bg-transparent px-3 py-2 text-xs font-mono outline-none"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title={visible ? 'Hide value' : 'Show value'}
        >
          {visible ? <EyeOffIcon className="h-3.5 w-3.5" /> : <EyeIcon className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  );
};

const AzureConfigPanel: FC<{
  azure?: AzureConfig;
  updateConfig: SettingsProps['updateConfig'];
}> = ({ azure, updateConfig }) => {
  const hasKey = Boolean(azure?.subscriptionKey);

  return (
    <div className="space-y-3 rounded-xl border border-border/50 bg-card/40 p-3">
      <div className="flex items-center gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Azure AI Configuration</h4>
        <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${
          hasKey
            ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
            : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
        }`}>
          {hasKey ? '✓ Key set' : '⚠ Key missing'}
        </span>
      </div>

      {!hasKey && (
        <p className="text-[10px] text-amber-600/80 dark:text-amber-400/80">
          Enter a subscription key to enable Azure AI Speech. Without one, TTS and dictation will fall back to native.
        </p>
      )}

      {/* Subscription Key */}
      <PasswordField
        label="Subscription Key"
        value={azure?.subscriptionKey ?? ''}
        onChange={(v) => updateConfig('audio.azure.subscriptionKey', v)}
        placeholder="Enter your Azure Speech subscription key"
      />

      {/* Region */}
      <div>
        <label className="text-[10px] text-muted-foreground block mb-0.5">Region</label>
        <input
          type="text"
          className="w-full rounded-xl border border-border/70 bg-card/80 px-3 py-2 text-xs outline-none"
          value={azure?.region ?? 'eastus'}
          onChange={(e) => updateConfig('audio.azure.region', e.target.value)}
          placeholder="eastus"
        />
        <span className="text-[10px] text-muted-foreground/60 mt-0.5 block">
          e.g. eastus, westus2, westeurope, southeastasia
        </span>
      </div>

      {/* Custom Endpoint */}
      <div>
        <label className="text-[10px] text-muted-foreground block mb-0.5">Endpoint (optional)</label>
        <input
          type="text"
          className="w-full rounded-xl border border-border/70 bg-card/80 px-3 py-2 text-xs font-mono outline-none"
          value={azure?.endpoint ?? ''}
          onChange={(e) => updateConfig('audio.azure.endpoint', e.target.value || undefined)}
          placeholder="https://your-resource.cognitiveservices.azure.com"
        />
        <span className="text-[10px] text-muted-foreground/60 mt-0.5 block">
          Base URL for your Azure AI Speech resource. If blank, the standard regional endpoint is used.
        </span>
      </div>

      <div className="flex items-center gap-2 pt-1 pb-1">
        <div className="flex-1 h-px bg-border/40" />
        <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/60">TTS Options</span>
        <div className="flex-1 h-px bg-border/40" />
      </div>

      {/* TTS Voice */}
      <AzureVoiceCombobox
        value={azure?.ttsVoice ?? 'en-US-JennyNeural'}
        onChange={(v) => updateConfig('audio.azure.ttsVoice', v)}
      />

      {/* TTS Output Format */}
      <div>
        <label className="text-[10px] text-muted-foreground block mb-0.5">Output Format</label>
        <select
          className={settingsSelectClass}
          value={azure?.ttsOutputFormat ?? 'audio-24khz-48kbitrate-mono-mp3'}
          onChange={(e) => updateConfig('audio.azure.ttsOutputFormat', e.target.value)}
        >
          <option value="audio-16khz-32kbitrate-mono-mp3">MP3 16kHz 32kbps</option>
          <option value="audio-24khz-48kbitrate-mono-mp3">MP3 24kHz 48kbps</option>
          <option value="audio-24khz-96kbitrate-mono-mp3">MP3 24kHz 96kbps</option>
          <option value="audio-48khz-96kbitrate-mono-mp3">MP3 48kHz 96kbps</option>
          <option value="riff-24khz-16bit-mono-pcm">WAV 24kHz 16-bit PCM</option>
        </select>
      </div>

      {/* TTS Rate */}
      <SliderField
        label={`TTS Speed: ${(azure?.ttsRate ?? 1).toFixed(1)}x`}
        value={azure?.ttsRate ?? 1}
        min={0.5}
        max={3}
        step={0.1}
        onChange={(v) => updateConfig('audio.azure.ttsRate', v)}
      />

      {/* Azure Voice Preview */}
      <VoicePreviewButton provider="azure" azure={azure} />

      <div className="flex items-center gap-2 pt-1 pb-1">
        <div className="flex-1 h-px bg-border/40" />
        <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/60">STT Options</span>
        <div className="flex-1 h-px bg-border/40" />
      </div>

      {/* STT Language */}
      <div>
        <label className="text-[10px] text-muted-foreground block mb-0.5">STT Language (BCP-47)</label>
        <input
          type="text"
          className="w-full rounded-xl border border-border/70 bg-card/80 px-3 py-2 text-xs outline-none"
          value={azure?.sttLanguage ?? 'en-US'}
          onChange={(e) => updateConfig('audio.azure.sttLanguage', e.target.value)}
          placeholder="en-US"
        />
        <span className="text-[10px] text-muted-foreground/60 mt-0.5 block">
          e.g. en-US, en-GB, es-ES, fr-FR, de-DE, ja-JP, zh-CN
        </span>
      </div>
    </div>
  );
};

// ─── Azure Voice Combobox ────────────────────────────────────────────────────
// Searchable dropdown with the pre-built list of 560+ Azure Neural voices.
// Also supports free-typing for new voices not yet in the list.

const AzureVoiceCombobox: FC<{
  value: string;
  onChange: (value: string) => void;
}> = ({ value, onChange }) => {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Find the current voice in the catalog
  const currentVoice = useMemo(
    () => AZURE_NEURAL_VOICES.find((v) => v.name === value),
    [value],
  );

  // Filter voices by query (matches on name, displayName, or locale)
  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return AZURE_NEURAL_VOICES;
    return AZURE_NEURAL_VOICES.filter(
      (v) =>
        v.name.toLowerCase().includes(q) ||
        v.displayName.toLowerCase().includes(q) ||
        v.locale.toLowerCase().includes(q),
    );
  }, [query]);

  // Check if query matches a voice not in the list (for free-typing)
  const isCustomValue = query.trim() && !AZURE_NEURAL_VOICES.some((v) => v.name === query.trim());

  // Reset highlight when filtered list changes
  useEffect(() => {
    setHighlightIdx(0);
  }, [filtered.length]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (!open || !listRef.current) return;
    const items = listRef.current.querySelectorAll('[data-voice-item]');
    items[highlightIdx]?.scrollIntoView({ block: 'nearest' });
  }, [highlightIdx, open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!inputRef.current?.parentElement?.parentElement?.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [open]);

  const selectVoice = (name: string) => {
    onChange(name);
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const totalItems = Math.min(filtered.length, 1000) + (isCustomValue ? 1 : 0);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIdx((i) => Math.min(i + 1, totalItems - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (isCustomValue && highlightIdx === 0) {
        selectVoice(query.trim());
      } else {
        const idx = isCustomValue ? highlightIdx - 1 : highlightIdx;
        if (filtered[idx]) {
          selectVoice(filtered[idx].name);
        }
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
      setQuery('');
      inputRef.current?.blur();
    }
  };

  // Display label for the current value
  const displayLabel = currentVoice
    ? `${currentVoice.displayName} (${currentVoice.locale}) — ${currentVoice.gender}`
    : value;

  return (
    <div className="relative">
      <label className="text-[10px] text-muted-foreground block mb-0.5">Voice</label>

      {/* Input row */}
      <div className="flex items-center gap-1.5 rounded-xl border border-border/70 bg-card/80 px-3 py-2">
        <SearchIcon className="h-3 w-3 text-muted-foreground/50 shrink-0" />
        <input
          ref={inputRef}
          type="text"
          className="min-w-0 flex-1 bg-transparent text-xs outline-none"
          value={open ? query : displayLabel}
          placeholder="Search voices or type a custom name..."
          onChange={(e) => {
            setQuery(e.target.value);
            if (!open) setOpen(true);
          }}
          onFocus={() => {
            setOpen(true);
            setQuery('');
          }}
          onKeyDown={handleKeyDown}
        />
        {open && query && (
          <button
            type="button"
            className="p-0.5 rounded text-muted-foreground/60 hover:text-foreground transition-colors"
            onClick={() => { setQuery(''); inputRef.current?.focus(); }}
            tabIndex={-1}
          >
            <XIcon className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Current value chip (shown below input when closed) */}
      {!open && (
        <span className="text-[10px] text-muted-foreground/60 mt-0.5 block font-mono">
          {value}
        </span>
      )}

      {/* Dropdown */}
      {open && (
        <div
          ref={listRef}
          className="absolute z-50 left-0 right-0 mt-1 max-h-[240px] overflow-y-auto rounded-xl border border-border/70 bg-card shadow-lg"
        >
          {/* Custom free-type option */}
          {isCustomValue && (
            <button
              type="button"
              data-voice-item
              className={`flex w-full items-center gap-2 px-3 py-2 text-xs text-left transition-colors ${
                highlightIdx === 0 ? 'bg-primary/10 text-primary' : 'hover:bg-muted/60'
              }`}
              onPointerDown={(e) => { e.preventDefault(); selectVoice(query.trim()); }}
            >
              <span className="font-mono font-medium">{query.trim()}</span>
              <span className="text-muted-foreground/60 text-[10px]">Custom voice name</span>
            </button>
          )}

          {/* Voice list */}
          {filtered.length > 0 ? (
            filtered.slice(0, 1000).map((v, i) => {
              const idx = isCustomValue ? i + 1 : i;
              return (
                <button
                  key={v.name}
                  type="button"
                  data-voice-item
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors ${
                    idx === highlightIdx ? 'bg-primary/10 text-primary' : 'hover:bg-muted/60'
                  } ${v.name === value ? 'font-medium' : ''}`}
                  onPointerDown={(e) => { e.preventDefault(); selectVoice(v.name); }}
                >
                  <span className="min-w-0 truncate">
                    <span className="font-medium">{v.displayName}</span>
                    <span className="text-muted-foreground/70"> ({v.locale})</span>
                  </span>
                  <span className={`shrink-0 text-[9px] px-1 py-0.5 rounded ${
                    v.gender === 'Female' ? 'bg-pink-500/10 text-pink-500' :
                    v.gender === 'Male' ? 'bg-blue-500/10 text-blue-500' :
                    'bg-gray-500/10 text-gray-500'
                  }`}>
                    {v.gender}
                  </span>
                  {v.name === value && (
                    <span className="shrink-0 text-[9px] text-primary">✓</span>
                  )}
                </button>
              );
            })
          ) : (
            <div className="px-3 py-3 text-xs text-muted-foreground text-center">
              No voices match &ldquo;{query}&rdquo;
            </div>
          )}

          {filtered.length > 1000 && (
            <div className="px-3 py-2 text-[10px] text-muted-foreground/60 text-center border-t border-border/30">
              Showing first 1000 of {filtered.length} results — type to narrow down
            </div>
          )}
        </div>
      )}
    </div>
  );
};
