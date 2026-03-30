import { useState, type FC } from 'react';
import { EyeIcon, EyeOffIcon } from 'lucide-react';
import type { SettingsProps } from './shared';
import { Toggle, settingsSelectClass } from './shared';

type MediaProvider = 'openai' | 'azure' | 'custom';

type MediaTab = 'image' | 'video';

type MediaGenConfig = {
  enabled?: boolean;
  provider?: MediaProvider;
  openai?: { apiKey?: string };
  azure?: { endpoint?: string; apiKey?: string; deploymentName?: string; apiVersion?: string };
  custom?: { baseUrl?: string; apiKey?: string };
  model?: string;
  // Image-specific
  size?: string;
  quality?: string;
  style?: string;
  outputFormat?: string;
  // Video-specific
  duration?: string;
  // Audio-specific (reserved for future use)
  voice?: string;
};

// ─── Password Field ──────────────────────────────────────────────────────────

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

// ─── Provider Config Section ─────────────────────────────────────────────────

const ProviderConfigSection: FC<{
  prefix: string;
  config: MediaGenConfig;
  updateConfig: (path: string, value: unknown) => void;
}> = ({ prefix, config, updateConfig }) => {
  const provider: MediaProvider = config?.provider ?? 'azure';

  return (
    <>
      {/* Provider Selector */}
      <div>
        <label className="text-[10px] text-muted-foreground block mb-0.5">Provider</label>
        <select
          className={settingsSelectClass}
          value={provider}
          onChange={(e) => updateConfig(`${prefix}.provider`, e.target.value)}
        >
          <option value="openai">OpenAI</option>
          <option value="azure">Azure OpenAI</option>
          <option value="custom">Custom</option>
        </select>
      </div>

      {/* OpenAI Configuration */}
      {provider === 'openai' && (
        <div className="space-y-3 rounded-xl border border-border/50 bg-card/40 p-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">OpenAI Configuration</h4>
          <PasswordField
            label="API Key"
            value={config?.openai?.apiKey ?? ''}
            onChange={(v) => updateConfig(`${prefix}.openai.apiKey`, v)}
            placeholder="sk-..."
          />
        </div>
      )}

      {/* Azure Configuration */}
      {provider === 'azure' && (
        <div className="space-y-3 rounded-xl border border-border/50 bg-card/40 p-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Azure OpenAI Configuration</h4>

          <div>
            <label className="text-[10px] text-muted-foreground block mb-0.5">Endpoint</label>
            <input
              type="text"
              className="w-full rounded-xl border border-border/70 bg-card/80 px-3 py-2 text-xs font-mono outline-none"
              value={config?.azure?.endpoint ?? ''}
              onChange={(e) => updateConfig(`${prefix}.azure.endpoint`, e.target.value || undefined)}
              placeholder="https://your-resource.openai.azure.com"
            />
            <span className="text-[10px] text-muted-foreground/60 mt-0.5 block">
              Your Azure OpenAI resource base URL.
            </span>
          </div>

          <PasswordField
            label="API Key"
            value={config?.azure?.apiKey ?? ''}
            onChange={(v) => updateConfig(`${prefix}.azure.apiKey`, v)}
            placeholder="Enter your Azure OpenAI API key"
          />

          <div>
            <label className="text-[10px] text-muted-foreground block mb-0.5">Deployment Name</label>
            <input
              type="text"
              className="w-full rounded-xl border border-border/70 bg-card/80 px-3 py-2 text-xs outline-none"
              value={config?.azure?.deploymentName ?? ''}
              onChange={(e) => updateConfig(`${prefix}.azure.deploymentName`, e.target.value)}
              placeholder={prefix.includes('image') ? 'gpt-image-1.5' : 'sora-2'}
            />
          </div>

          <div>
            <label className="text-[10px] text-muted-foreground block mb-0.5">API Version</label>
            <input
              type="text"
              className="w-full rounded-xl border border-border/70 bg-card/80 px-3 py-2 text-xs outline-none"
              value={config?.azure?.apiVersion ?? ''}
              onChange={(e) => updateConfig(`${prefix}.azure.apiVersion`, e.target.value)}
              placeholder="2024-02-15-preview"
            />
          </div>
        </div>
      )}

      {/* Custom Configuration */}
      {provider === 'custom' && (
        <div className="space-y-3 rounded-xl border border-border/50 bg-card/40 p-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Custom Provider Configuration</h4>

          <div>
            <label className="text-[10px] text-muted-foreground block mb-0.5">Base URL</label>
            <input
              type="text"
              className="w-full rounded-xl border border-border/70 bg-card/80 px-3 py-2 text-xs font-mono outline-none"
              value={config?.custom?.baseUrl ?? ''}
              onChange={(e) => updateConfig(`${prefix}.custom.baseUrl`, e.target.value || undefined)}
              placeholder="https://your-proxy.example.com/v1"
            />
            <span className="text-[10px] text-muted-foreground/60 mt-0.5 block">
              Your ai-gateway or proxy base URL. The generation API path will be appended automatically.
            </span>
          </div>

          <PasswordField
            label="API Key"
            value={config?.custom?.apiKey ?? ''}
            onChange={(v) => updateConfig(`${prefix}.custom.apiKey`, v)}
            placeholder="Enter your API key (optional)"
          />
        </div>
      )}

      {/* Model */}
      <div>
        <label className="text-[10px] text-muted-foreground block mb-0.5">Model</label>
        <input
          type="text"
          className="w-full rounded-xl border border-border/70 bg-card/80 px-3 py-2 text-xs outline-none"
          value={config?.model ?? ''}
          onChange={(e) => updateConfig(`${prefix}.model`, e.target.value)}
          placeholder={prefix.includes('image') ? 'gpt-image-1.5' : 'sora-2'}
        />
      </div>
    </>
  );
};

// ─── Image Options ───────────────────────────────────────────────────────────

const ImageOptions: FC<{
  config: MediaGenConfig;
  updateConfig: (path: string, value: unknown) => void;
}> = ({ config, updateConfig }) => (
  <div className="space-y-3 border-t border-border/50 pt-4">
    <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Image Options</h4>

    <div className="grid grid-cols-2 gap-3">
      <div>
        <label className="text-[10px] text-muted-foreground block mb-0.5">Size</label>
        <select
          className={settingsSelectClass}
          value={config?.size ?? '1024x1024'}
          onChange={(e) => updateConfig('imageGeneration.size', e.target.value)}
        >
          <option value="1024x1024">1024 x 1024</option>
          <option value="1536x1024">1536 x 1024 (landscape)</option>
          <option value="1024x1536">1024 x 1536 (portrait)</option>
          <option value="auto">Auto</option>
        </select>
      </div>

      <div>
        <label className="text-[10px] text-muted-foreground block mb-0.5">Quality</label>
        <select
          className={settingsSelectClass}
          value={config?.quality ?? 'auto'}
          onChange={(e) => updateConfig('imageGeneration.quality', e.target.value)}
        >
          <option value="auto">Auto</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
      </div>

      <div>
        <label className="text-[10px] text-muted-foreground block mb-0.5">Output Format</label>
        <select
          className={settingsSelectClass}
          value={config?.outputFormat ?? 'png'}
          onChange={(e) => updateConfig('imageGeneration.outputFormat', e.target.value)}
        >
          <option value="png">PNG</option>
          <option value="jpeg">JPEG</option>
          <option value="webp">WebP</option>
        </select>
      </div>
    </div>
  </div>
);

// ─── Video Options ───────────────────────────────────────────────────────────

const VideoOptions: FC<{
  config: MediaGenConfig;
  updateConfig: (path: string, value: unknown) => void;
}> = ({ config, updateConfig }) => (
  <div className="space-y-3 border-t border-border/50 pt-4">
    <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Video Options</h4>

    <div className="grid grid-cols-2 gap-3">
      <div>
        <label className="text-[10px] text-muted-foreground block mb-0.5">Size</label>
        <select
          className={settingsSelectClass}
          value={config?.size ?? '1280x720'}
          onChange={(e) => updateConfig('videoGeneration.size', e.target.value)}
        >
          <option value="1280x720">1280 x 720 (landscape)</option>
          <option value="720x1280">720 x 1280 (portrait)</option>
          <option value="1792x1024">1792 x 1024 (wide)</option>
          <option value="1024x1792">1024 x 1792 (tall)</option>
        </select>
      </div>

      <div>
        <label className="text-[10px] text-muted-foreground block mb-0.5">Duration</label>
        <select
          className={settingsSelectClass}
          value={config?.duration ?? '4'}
          onChange={(e) => updateConfig('videoGeneration.duration', e.target.value)}
        >
          <option value="4">4 seconds</option>
          <option value="8">8 seconds</option>
          <option value="12">12 seconds</option>
        </select>
      </div>
    </div>
  </div>
);

// ─── Main Component ──────────────────────────────────────────────────────────

const tabs: Array<{ key: MediaTab; label: string; description: string }> = [
  { key: 'image', label: 'Image', description: 'Generate images using models like gpt-image-1.5.' },
  { key: 'video', label: 'Video', description: 'Generate videos using models like Sora 2.' },
];

const configKeys: Record<MediaTab, string> = {
  image: 'imageGeneration',
  video: 'videoGeneration',
};

export const MediaGenerationSettings: FC<SettingsProps> = ({ config, updateConfig }) => {
  const [activeTab, setActiveTab] = useState<MediaTab>('image');
  const tab = tabs.find((t) => t.key === activeTab)!;
  const prefix = configKeys[activeTab];
  const mediaConfig = (config as Record<string, unknown>)[prefix] as MediaGenConfig | undefined;
  const enabled = mediaConfig?.enabled ?? false;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h3 className="text-sm font-semibold">Media Generation</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Configure AI-powered image and video generation. Supports OpenAI, Azure OpenAI, and custom providers (e.g. ai-gateway proxy).
        </p>
      </div>

      {/* Tab Bar */}
      <div className="flex gap-1 rounded-xl border border-border/60 bg-muted/30 p-1">
        {tabs.map((t) => {
          const tabConfig = (config as Record<string, unknown>)[configKeys[t.key]] as MediaGenConfig | undefined;
          const isEnabled = tabConfig?.enabled ?? false;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setActiveTab(t.key)}
              className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                activeTab === t.key
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
              }`}
            >
              {t.label}
              {isEnabled && (
                <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
              )}
            </button>
          );
        })}
      </div>

      {/* Tab Description */}
      <p className="text-xs text-muted-foreground">{tab.description}</p>

      {/* Enable Toggle */}
      <Toggle
        label={`Enable ${tab.label.toLowerCase()} generation`}
        checked={enabled}
        onChange={(v) => updateConfig(`${prefix}.enabled`, v)}
      />

      {/* Provider Config */}
      <ProviderConfigSection
        prefix={prefix}
        config={mediaConfig ?? {}}
        updateConfig={updateConfig}
      />

      {/* Type-specific options */}
      {activeTab === 'image' && <ImageOptions config={mediaConfig ?? {}} updateConfig={updateConfig} />}
      {activeTab === 'video' && <VideoOptions config={mediaConfig ?? {}} updateConfig={updateConfig} />}
    </div>
  );
};
