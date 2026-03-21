import { useEffect, useState, type FC } from 'react';
import { PlusIcon, Trash2Icon, PencilIcon, XIcon, CheckIcon, EyeIcon, EyeOffIcon } from 'lucide-react';
import { highlightBrandText } from '@/components/BrandText';
import { EditableInput } from '@/components/EditableInput';
import { formatModelDisplayName } from '@/lib/model-display';
import { legion } from '@/lib/ipc-client';
import { Toggle, settingsSelectClass, type SettingsProps } from './shared';

type Provider = {
  type: string;
  enabled?: boolean;
  endpoint?: string;
  apiKey?: string;
  apiVersion?: string;
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  awsProfile?: string;
  roleArn?: string;
  useDefaultCredentials?: boolean;
};

type CatalogEntry = {
  key: string;
  displayName: string;
  provider: string;
  modelName: string;
  deploymentName?: string;
  maxInputTokens?: number;
  useResponsesApi?: boolean;
};

type AgentBackend = 'mastra' | 'legion-embedded' | 'legion-daemon';

type RuntimeConfig = {
  agentBackend: AgentBackend;
  legion: {
    configDir: string;
    daemonUrl: string;
    rubyPath: string;
  };
};

type DetectedRuntime = {
  configDir: string;
  daemonUrl: string;
  rubyPath: string;
};

type LegionStatus = {
  backend: AgentBackend;
  embedded: {
    ok: boolean;
    status: string;
    error?: string;
    rubyPath?: string;
    rootPath?: string;
    configDir?: string;
  };
  daemon: {
    ok: boolean;
    status: string;
    error?: string;
    url: string;
  };
};

export const ModelSettings: FC<SettingsProps> = ({ config, updateConfig }) => {
  const models = config.models as {
    defaultModelKey: string;
    providers: Record<string, Provider>;
    catalog: CatalogEntry[];
  };
  const runtime = ((config.runtime as RuntimeConfig | undefined) ?? {
    agentBackend: 'legion-embedded',
    legion: {
      configDir: '',
      daemonUrl: 'http://127.0.0.1:4567',
      rubyPath: '',
    },
  });

  const providerKeys = Object.keys(models.providers);

  const updateCatalog = (newCatalog: CatalogEntry[]) => updateConfig('models.catalog', newCatalog);

  const addModel = (entry: CatalogEntry) => {
    updateCatalog([...models.catalog, entry]);
  };

  const updateModel = (index: number, entry: CatalogEntry) => {
    const next = [...models.catalog];
    next[index] = entry;
    updateCatalog(next);
  };

  const deleteModel = (index: number) => {
    updateCatalog(models.catalog.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-6">
      <h3 className="text-sm font-semibold">Models</h3>

      <RuntimeCard runtime={runtime} updateConfig={updateConfig} />

      {/* Default model */}
      <div>
        <label className="text-xs text-muted-foreground block mb-1">Default Model</label>
        <select
          className={settingsSelectClass}
          value={models.defaultModelKey}
          onChange={(e) => updateConfig('models.defaultModelKey', e.target.value)}
        >
          {models.catalog.map((m) => (
            <option key={m.key} value={m.key}>{formatModelDisplayName(m.displayName)}</option>
          ))}
        </select>
      </div>

      {/* Providers */}
      <div className="space-y-3">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Providers</h4>
        {Object.entries(models.providers).map(([key, provider]) => (
          <ProviderCard key={key} name={key} provider={provider} updateConfig={updateConfig} />
        ))}
      </div>

      {/* Model catalog */}
      <ModelCatalog
        catalog={models.catalog}
        providerKeys={providerKeys}
        providers={models.providers}
        onAdd={addModel}
        onUpdate={updateModel}
        onDelete={deleteModel}
      />
    </div>
  );
};

const RuntimeCard: FC<{
  runtime: RuntimeConfig;
  updateConfig: (path: string, value: unknown) => Promise<void>;
}> = ({ runtime, updateConfig }) => {
  const [status, setStatus] = useState<LegionStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const isMastra = runtime.agentBackend === 'mastra';
  const isEmbedded = runtime.agentBackend === 'legion-embedded';
  const isDaemon = runtime.agentBackend === 'legion-daemon';

  const loadStatus = async () => {
    setLoading(true);
    try {
      setStatus(await legion.agent.legionStatus() as LegionStatus);
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadStatus();
  }, [runtime.agentBackend, runtime.legion.configDir, runtime.legion.daemonUrl, runtime.legion.rubyPath]);

  const applyDetectedRuntime = async () => {
    setDetecting(true);
    try {
      const detected = await legion.config.autoDetectRuntime() as DetectedRuntime;
      await updateConfig('runtime.legion.configDir', detected.configDir);
      await updateConfig('runtime.legion.daemonUrl', detected.daemonUrl);
      await updateConfig('runtime.legion.rubyPath', detected.rubyPath);
      await loadStatus();
    } finally {
      setDetecting(false);
    }
  };

  return (
    <div className="rounded-lg border p-3 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Agent Runtime</h4>
          <p className="mt-1 text-xs text-muted-foreground">
            Choose whether Legion Aithena uses Mastra directly or routes chat through LegionIO.
          </p>
        </div>
        <button
          type="button"
          onClick={() => { void loadStatus(); }}
          className="rounded-md border px-2.5 py-1 text-xs transition-colors hover:bg-muted"
        >
          {loading ? 'Checking...' : 'Refresh Status'}
        </button>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => { void applyDetectedRuntime(); }}
          className="rounded-md bg-primary px-2.5 py-1 text-xs text-primary-foreground transition-colors hover:bg-primary/90"
        >
          {detecting ? 'Detecting...' : 'Use Detected Setup'}
        </button>
        <p className="text-[10px] text-muted-foreground">
          Auto-fills LegionIO root, config dir, daemon URL, and common Ruby shim paths.
        </p>
      </div>

      <div>
        <label className="text-[10px] text-muted-foreground block mb-0.5">Backend</label>
        <select
          className={settingsSelectClass}
          value={runtime.agentBackend}
          onChange={(e) => updateConfig('runtime.agentBackend', e.target.value as AgentBackend)}
        >
          <option value="legion-embedded">Legion Embedded</option>
          <option value="legion-daemon">Legion Daemon</option>
          <option value="mastra">Mastra Direct</option>
        </select>
      </div>

      {isMastra ? (
        <div className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
          Mastra Direct runs inside the desktop app, so Legion-specific config fields are hidden for this backend.
        </div>
      ) : null}

      {(isEmbedded || isDaemon) ? (
        <div>
          <label className="text-[10px] text-muted-foreground block mb-0.5">Legion Config Dir</label>
          <EditableInput
            className="w-full rounded border bg-card px-2 py-1 text-xs font-mono"
            value={runtime.legion.configDir}
            onChange={(value) => updateConfig('runtime.legion.configDir', value)}
            placeholder="~/.legionio/settings"
          />
        </div>
      ) : null}

      {isEmbedded ? (
        <div>
          <label className="text-[10px] text-muted-foreground block mb-0.5">Ruby Path</label>
          <EditableInput
            className="w-full rounded border bg-card px-2 py-1 text-xs font-mono"
            value={runtime.legion.rubyPath}
            onChange={(value) => updateConfig('runtime.legion.rubyPath', value)}
            placeholder="Auto-detect from PATH, or set ~/.rbenv/shims/ruby"
          />
        </div>
      ) : null}

      {isDaemon ? (
        <div>
          <label className="text-[10px] text-muted-foreground block mb-0.5">Daemon URL</label>
          <EditableInput
            className="w-full rounded border bg-card px-2 py-1 text-xs font-mono"
            value={runtime.legion.daemonUrl}
            onChange={(value) => updateConfig('runtime.legion.daemonUrl', value)}
            placeholder="http://127.0.0.1:4567"
          />
        </div>
      ) : null}

      {isEmbedded ? (
        <div className="grid grid-cols-1 gap-2">
          <StatusBadge
            label="Embedded Legion"
            ok={status?.embedded.ok ?? false}
            status={status?.embedded.status ?? 'unknown'}
            detail={status?.embedded.error ?? status?.embedded.rubyPath ?? 'Ruby bridge not checked yet.'}
          />
        </div>
      ) : null}

      {isDaemon ? (
        <div className="grid grid-cols-1 gap-2">
          <StatusBadge
            label="Daemon"
            ok={status?.daemon.ok ?? false}
            status={status?.daemon.status ?? 'unknown'}
            detail={status?.daemon.error ?? status?.daemon.url ?? 'Daemon not checked yet.'}
          />
        </div>
      ) : null}
    </div>
  );
};

const StatusBadge: FC<{
  label: string;
  ok: boolean;
  status: string;
  detail: string;
}> = ({ label, ok, status, detail }) => (
  <div className={`rounded-lg border px-3 py-2 text-xs ${ok ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-amber-500/40 bg-amber-500/5'}`}>
    <div className="flex items-center justify-between gap-2">
      <span className="font-medium">{label}</span>
      <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${ok ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'}`}>
        {status}
      </span>
    </div>
    <p className="mt-1 break-all text-[10px] text-muted-foreground">{detail}</p>
  </div>
);

/* ── Model Catalog ── */

const ModelCatalog: FC<{
  catalog: CatalogEntry[];
  providerKeys: string[];
  providers: Record<string, Provider>;
  onAdd: (entry: CatalogEntry) => void;
  onUpdate: (index: number, entry: CatalogEntry) => void;
  onDelete: (index: number) => void;
}> = ({ catalog, providerKeys, providers, onAdd, onUpdate, onDelete }) => {
  const [showAdd, setShowAdd] = useState(false);
  const [editIndex, setEditIndex] = useState<number | null>(null);

  return (
    <div className="space-y-2">
      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Model Catalog</h4>

      <div className="space-y-1.5">
        {catalog.map((m, i) =>
          editIndex === i ? (
            <ModelForm
              key={`edit-${i}`}
              initial={m}
              providerKeys={providerKeys}
              providers={providers}
              onSave={(entry) => { onUpdate(i, entry); setEditIndex(null); }}
              onCancel={() => setEditIndex(null)}
              submitLabel="Save"
            />
          ) : (
            <div key={m.key} className="flex items-center gap-2 rounded-lg border px-3 py-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium truncate">{highlightBrandText(formatModelDisplayName(m.displayName))}</span>
                  <span className="text-[10px] text-muted-foreground bg-muted rounded px-1.5 py-0.5 shrink-0">{highlightBrandText(m.provider)}</span>
                </div>
                <div className="text-[10px] text-muted-foreground font-mono truncate mt-0.5">
                  {m.modelName}
                  {m.maxInputTokens ? ` · ${Math.round(m.maxInputTokens / 1000)}k ctx` : ''}
                </div>
              </div>
              <button type="button" onClick={() => setEditIndex(i)} className="p-1 rounded hover:bg-muted transition-colors" title="Edit">
                <PencilIcon className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
              <button type="button" onClick={() => onDelete(i)} className="p-1 rounded hover:bg-destructive/10 transition-colors" title="Delete">
                <Trash2Icon className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            </div>
          ),
        )}
      </div>

      {showAdd ? (
        <ModelForm
          initial={{ key: '', displayName: '', provider: providerKeys[0] ?? '', modelName: '' }}
          providerKeys={providerKeys}
          providers={providers}
          onSave={(entry) => { onAdd(entry); setShowAdd(false); }}
          onCancel={() => setShowAdd(false)}
          submitLabel="Add Model"
        />
      ) : (
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-1.5 rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground hover:bg-muted/50 transition-colors w-full"
        >
          <PlusIcon className="h-3.5 w-3.5" />
          Add Model
        </button>
      )}
    </div>
  );
};

const ModelForm: FC<{
  initial: CatalogEntry;
  providerKeys: string[];
  providers: Record<string, Provider>;
  onSave: (entry: CatalogEntry) => void;
  onCancel: () => void;
  submitLabel: string;
}> = ({ initial, providerKeys, providers, onSave, onCancel, submitLabel }) => {
  const [key, setKey] = useState(initial.key);
  const [displayName, setDisplayName] = useState(initial.displayName);
  const [provider, setProvider] = useState(initial.provider);
  const [modelName, setModelName] = useState(initial.modelName);
  const [deploymentName, setDeploymentName] = useState(initial.deploymentName ?? '');
  const [maxInputTokens, setMaxInputTokens] = useState(initial.maxInputTokens?.toString() ?? '');
  const [useResponsesApi, setUseResponsesApi] = useState(initial.useResponsesApi ?? false);

  const selectedProvider = providers[provider];

  const canSave = key.trim() && displayName.trim() && provider && modelName.trim();

  const handleSave = () => {
    if (!canSave) return;
    const entry: CatalogEntry = {
      key: key.trim(),
      displayName: displayName.trim(),
      provider,
      modelName: modelName.trim(),
    };
    if (deploymentName.trim()) entry.deploymentName = deploymentName.trim();
    if (maxInputTokens) entry.maxInputTokens = Number(maxInputTokens);
    if (selectedProvider?.type === 'openai-compatible') {
      entry.useResponsesApi = useResponsesApi;
    }
    onSave(entry);
  };

  // Auto-generate key from display name if key is empty or matches previous auto
  const handleDisplayNameChange = (v: string) => {
    const wasAuto = !initial.key || key === toKey(initial.displayName);
    setDisplayName(v);
    if (wasAuto) setKey(toKey(v));
  };

  return (
    <div className="rounded-lg border bg-card p-3 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] text-muted-foreground block mb-0.5">Display Name</label>
          <EditableInput
            className="w-full rounded border bg-background px-2 py-1 text-xs"
            value={displayName}
            onChange={handleDisplayNameChange}
            placeholder="GPT-5.4"
          />
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground block mb-0.5">Key (unique ID)</label>
          <EditableInput
            className="w-full rounded border bg-background px-2 py-1 text-xs font-mono"
            value={key}
            onChange={setKey}
            placeholder="gpt-5.4"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] text-muted-foreground block mb-0.5">Provider</label>
          <select
            className={settingsSelectClass.replace('bg-card/80', 'bg-background')}
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
          >
            {providerKeys.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground block mb-0.5">Model Name / ID</label>
          <EditableInput
            className="w-full rounded border bg-background px-2 py-1 text-xs font-mono"
            value={modelName}
            onChange={setModelName}
            placeholder="gpt-5.4"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] text-muted-foreground block mb-0.5">Deployment Name (optional)</label>
          <EditableInput
            className="w-full rounded border bg-background px-2 py-1 text-xs font-mono"
            value={deploymentName}
            onChange={setDeploymentName}
            placeholder="Same as model name if blank"
          />
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground block mb-0.5">Max Input Tokens</label>
          <input
            type="number"
            className="w-full rounded border bg-background px-2 py-1 text-xs outline-none"
            value={maxInputTokens}
            onChange={(e) => setMaxInputTokens(e.target.value)}
            placeholder="128000"
            min={1}
          />
        </div>
      </div>

      {selectedProvider?.type === 'openai-compatible' && (
        <Toggle label="Use Responses API" checked={useResponsesApi} onChange={setUseResponsesApi} />
      )}

      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={handleSave}
          disabled={!canSave}
          className="flex items-center gap-1 rounded-md bg-primary text-primary-foreground px-3 py-1 text-xs font-medium disabled:opacity-40 transition-colors hover:bg-primary/90"
        >
          <CheckIcon className="h-3 w-3" />
          {submitLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex items-center gap-1 rounded-md bg-muted px-3 py-1 text-xs hover:bg-muted/80 transition-colors"
        >
          <XIcon className="h-3 w-3" />
          Cancel
        </button>
      </div>
    </div>
  );
};

function toKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function getProviderTypeLabel(type: string): string {
  return type === 'openai-compatible' ? 'openai' : type;
}

const PasswordField: FC<{
  label: string;
  value: string;
  onChange: (value: string) => Promise<void>;
  placeholder?: string;
}> = ({ label, value, onChange, placeholder }) => {
  const [visible, setVisible] = useState(false);

  return (
    <div>
      <label className="text-[10px] text-muted-foreground block mb-0.5">{label}</label>
      <div className="flex items-center gap-2 rounded border bg-card pr-2">
        <EditableInput
          type={visible ? 'text' : 'password'}
          className="min-w-0 flex-1 bg-transparent px-2 py-1 text-xs font-mono"
          value={value}
          onChange={onChange}
          placeholder={placeholder}
        />
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title={visible ? 'Hide value' : 'Show value'}
          aria-label={visible ? `Hide ${label}` : `Show ${label}`}
        >
          {visible ? <EyeOffIcon className="h-3.5 w-3.5" /> : <EyeIcon className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  );
};

/* ── Provider Cards ── */

const ProviderCard: FC<{
  name: string;
  provider: Provider;
  updateConfig: (path: string, value: unknown) => Promise<void>;
}> = ({ name, provider, updateConfig }) => {
  const prefix = `models.providers.${name}`;
  const isBedrock = provider.type === 'amazon-bedrock';
  const isOllama = name === 'ollama';

  return (
    <div className="rounded-lg border p-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-xs font-mono font-medium">{highlightBrandText(name)}</span>
        <span className="text-[10px] text-muted-foreground px-1.5 py-0.5 rounded bg-muted">
          {highlightBrandText(getProviderTypeLabel(provider.type))}
        </span>
      </div>

      {provider.enabled !== undefined && (
        <Toggle
          label="Enabled"
          checked={provider.enabled}
          onChange={(v) => updateConfig(`${prefix}.enabled`, v)}
        />
      )}

      {provider.endpoint !== undefined && (
        <div>
          <label className="text-[10px] text-muted-foreground block mb-0.5">
            {isOllama ? 'Base URL' : 'Endpoint'}
          </label>
          <EditableInput
            className="w-full rounded border bg-card px-2 py-1 text-xs font-mono"
            value={provider.endpoint ?? ''}
            onChange={(v) => updateConfig(`${prefix}.endpoint`, v)}
            placeholder={isOllama ? 'http://localhost:11434' : 'https://api.openai.com/v1'}
          />
        </div>
      )}

      {!isOllama && provider.apiKey !== undefined && (
        <PasswordField
          label="API Key"
          value={provider.apiKey}
          onChange={(v) => updateConfig(`${prefix}.apiKey`, v)}
        />
      )}

      {isBedrock && (
        <BedrockCredentials prefix={prefix} provider={provider} updateConfig={updateConfig} />
      )}
    </div>
  );
};

const BedrockCredentials: FC<{
  prefix: string;
  provider: Provider;
  updateConfig: (path: string, value: unknown) => Promise<void>;
}> = ({ prefix, provider, updateConfig }) => {
  const useDefault = provider.useDefaultCredentials !== false;
  const hasProfile = Boolean(provider.awsProfile?.trim());
  const hasKeys = Boolean(provider.accessKeyId?.trim() && provider.secretAccessKey?.trim());
  const hasRoleArn = Boolean(provider.roleArn?.trim());
  const hasAnyCreds = hasProfile || hasKeys || hasRoleArn;

  return (
    <>
      <div>
        <label className="text-[10px] text-muted-foreground block mb-0.5">Region</label>
        <EditableInput
          className="w-full rounded border bg-card px-2 py-1 text-xs font-mono"
          value={provider.region ?? ''}
          onChange={(v) => updateConfig(`${prefix}.region`, v)}
          placeholder="us-east-1"
        />
      </div>

      <Toggle
        label="Use default AWS credential chain (env vars, ~/.aws/credentials, instance role)"
        checked={useDefault}
        onChange={(v) => updateConfig(`${prefix}.useDefaultCredentials`, v)}
      />

      {useDefault ? (
        <p className="text-[10px] text-muted-foreground bg-muted/50 rounded px-2 py-1">
          Credentials resolved automatically via AWS_PROFILE, environment variables, shared credentials file, or instance metadata.
        </p>
      ) : (
        <fieldset className="rounded-md border p-2 space-y-2">
          <legend className="text-[10px] font-semibold px-1">AWS Credentials</legend>

          {!hasAnyCreds && (
            <p className="text-[10px] text-amber-600 dark:text-amber-400">
              Provide at least one: an AWS profile, access key + secret, or a role ARN.
            </p>
          )}

          <div>
            <label className="text-[10px] text-muted-foreground block mb-0.5">AWS Profile</label>
            <EditableInput
              className="w-full rounded border bg-card px-2 py-1 text-xs font-mono"
              value={provider.awsProfile ?? ''}
              onChange={(v) => updateConfig(`${prefix}.awsProfile`, v)}
              placeholder="default"
            />
          </div>
          <PasswordField
            label="Access Key ID"
            value={provider.accessKeyId ?? ''}
            onChange={(v) => updateConfig(`${prefix}.accessKeyId`, v)}
          />
          <PasswordField
            label="Secret Access Key"
            value={provider.secretAccessKey ?? ''}
            onChange={(v) => updateConfig(`${prefix}.secretAccessKey`, v)}
          />
          <PasswordField
            label="Session Token"
            value={provider.sessionToken ?? ''}
            onChange={(v) => updateConfig(`${prefix}.sessionToken`, v)}
          />
          <div>
            <label className="text-[10px] text-muted-foreground block mb-0.5">Role ARN (STS AssumeRole)</label>
            <EditableInput
              className="w-full rounded border bg-card px-2 py-1 text-xs font-mono"
              value={provider.roleArn ?? ''}
              onChange={(v) => updateConfig(`${prefix}.roleArn`, v)}
              placeholder="arn:aws:iam::123456789:role/my-role"
            />
          </div>
        </fieldset>
      )}
    </>
  );
};
