import { useState, useRef, useCallback, type FC } from 'react';
import { Trash2Icon, AlertTriangleIcon, LoaderIcon, CheckCircle2Icon, EyeIcon, EyeOffIcon, WifiIcon, WifiOffIcon } from 'lucide-react';
import { app } from '@/lib/ipc-client';
import { Toggle, NumberField, TextField, settingsSelectClass, type SettingsProps } from './shared';

type EmbeddingProviderType = 'openai' | 'azure' | 'custom';

type EmbeddingProviderConfig = {
  type?: EmbeddingProviderType;
  model?: string;
  openai?: { apiKey?: string };
  azure?: { endpoint?: string; apiKey?: string; deploymentName?: string; apiVersion?: string };
  custom?: { baseUrl?: string; apiKey?: string };
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

// ─── Test Embedding Connection Button ────────────────────────────────────────

type TestState = 'idle' | 'testing' | 'success' | 'error';

const TestEmbeddingButton: FC = () => {
  const [state, setState] = useState<TestState>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successInfo, setSuccessInfo] = useState<{ model?: string; dimensions?: number } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleTest = useCallback(async () => {
    if (state === 'testing') return;
    setState('testing');
    setErrorMsg(null);
    setSuccessInfo(null);

    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }

    try {
      const result = await app.memory.testEmbedding();

      if (result.error) {
        setState('error');
        setErrorMsg(result.error);
      } else {
        setState('success');
        setSuccessInfo({ model: result.model, dimensions: result.dimensions });
      }
    } catch (err) {
      setState('error');
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }

    timerRef.current = setTimeout(() => {
      setState('idle');
      setErrorMsg(null);
      setSuccessInfo(null);
    }, state === 'success' ? 5000 : 10000);
  }, [state]);

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={handleTest}
        disabled={state === 'testing'}
        className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition-all ${
          state === 'testing'
            ? 'border-primary/40 bg-primary/5 text-primary'
            : state === 'success'
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
              : state === 'error'
                ? 'border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400'
                : 'border-border/70 bg-card/70 text-foreground hover:bg-muted/60'
        }`}
        title="Test the embedding provider connection by generating a test vector"
      >
        {state === 'testing' ? (
          <>
            <LoaderIcon className="h-3 w-3 animate-spin" />
            Testing...
          </>
        ) : state === 'success' ? (
          <>
            <WifiIcon className="h-3 w-3" />
            Connected
          </>
        ) : state === 'error' ? (
          <>
            <WifiOffIcon className="h-3 w-3" />
            Failed
          </>
        ) : (
          <>
            <WifiIcon className="h-3 w-3" />
            Test Embedding Connection
          </>
        )}
      </button>
      {state === 'success' && successInfo && (
        <p className="text-[10px] text-emerald-600/80 dark:text-emerald-400/80 pl-1">
          Model: {successInfo.model} &middot; {successInfo.dimensions} dimensions
        </p>
      )}
      {state === 'error' && errorMsg && (
        <p className="text-[10px] text-red-600/80 dark:text-red-400/80 pl-1 break-all">
          {errorMsg}
        </p>
      )}
    </div>
  );
};

// ─── Main Component ──────────────────────────────────────────────────────────

export const MemorySettings: FC<SettingsProps> = ({ config, updateConfig }) => {
  const memory = config.memory as {
    enabled: boolean;
    workingMemory: { enabled: boolean; scope: string };
    observationalMemory: { enabled: boolean; scope: string };
    semanticRecall: {
      enabled: boolean;
      topK: number;
      scope: string;
      embeddingProvider?: EmbeddingProviderConfig;
    };
    lastMessages: number;
  };

  const embeddingProvider = memory.semanticRecall.embeddingProvider;
  const embeddingProviderType: EmbeddingProviderType = embeddingProvider?.type ?? 'azure';

  return (
    <div className="space-y-6">
      <h3 className="text-sm font-semibold">Memory</h3>

      <Toggle label="Enable Mastra memory" checked={memory.enabled} onChange={(v) => updateConfig('memory.enabled', v)} />

      <NumberField label="Last messages to keep in context" value={memory.lastMessages} onChange={(v) => updateConfig('memory.lastMessages', v)} min={1} />

      <fieldset className="rounded-lg border p-3 space-y-2">
        <legend className="text-xs font-semibold px-1">Working Memory</legend>
        <Toggle label="Enabled" checked={memory.workingMemory.enabled} onChange={(v) => updateConfig('memory.workingMemory.enabled', v)} />
        <div>
          <label className="text-[10px] text-muted-foreground block mb-0.5">Scope</label>
          <select className={settingsSelectClass} value={memory.workingMemory.scope} onChange={(e) => updateConfig('memory.workingMemory.scope', e.target.value)}>
            <option value="resource">Resource (cross-thread)</option>
            <option value="thread">Thread (per-conversation)</option>
          </select>
        </div>
        <p className="text-[10px] text-muted-foreground">Working memory stores user preferences and key facts. "Resource" scope shares across all threads.</p>
      </fieldset>

      <fieldset className="rounded-lg border p-3 space-y-2">
        <legend className="text-xs font-semibold px-1">Observational Memory</legend>
        <Toggle label="Enabled" checked={memory.observationalMemory.enabled} onChange={(v) => updateConfig('memory.observationalMemory.enabled', v)} />
        <div>
          <label className="text-[10px] text-muted-foreground block mb-0.5">Scope</label>
          <select className={settingsSelectClass} value={memory.observationalMemory.scope} onChange={(e) => updateConfig('memory.observationalMemory.scope', e.target.value)}>
            <option value="resource">Resource (cross-thread)</option>
            <option value="thread">Thread (per-conversation)</option>
          </select>
        </div>
        <p className="text-[10px] text-muted-foreground">AI-generated observations about patterns and preferences. Best with "resource" scope for cross-thread learning.</p>
      </fieldset>

      <fieldset className="rounded-lg border p-3 space-y-3">
        <legend className="text-xs font-semibold px-1">Semantic Recall (RAG)</legend>
        <Toggle label="Enabled" checked={memory.semanticRecall.enabled} onChange={(v) => updateConfig('memory.semanticRecall.enabled', v)} />
        <NumberField label="Top-K results" value={memory.semanticRecall.topK} onChange={(v) => updateConfig('memory.semanticRecall.topK', v)} min={1} max={20} />
        <p className="text-[10px] text-muted-foreground">Vector similarity search across conversation history. Enables cross-thread reference (&quot;that thing from yesterday&quot;).</p>

        {memory.semanticRecall.enabled && (
          <div className="space-y-3 border-t border-border/50 pt-3">
            <h4 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Embedding Provider</h4>

            {/* Provider Selector */}
            <div>
              <label className="text-[10px] text-muted-foreground block mb-0.5">Provider</label>
              <select
                className={settingsSelectClass}
                value={embeddingProviderType}
                onChange={(e) => updateConfig('memory.semanticRecall.embeddingProvider.type', e.target.value)}
              >
                <option value="openai">OpenAI</option>
                <option value="azure">Azure OpenAI</option>
                <option value="custom">Custom (OpenAI-compatible)</option>
              </select>
            </div>

            {/* Model Name */}
            <TextField
              label="Model name"
              value={embeddingProvider?.model ?? 'text-embedding-3-small'}
              onChange={(v) => updateConfig('memory.semanticRecall.embeddingProvider.model', v)}
              placeholder="text-embedding-3-small"
              hint="The embedding model identifier (e.g. text-embedding-3-small, text-embedding-ada-002)."
            />

            {/* ── OpenAI Configuration ── */}
            {embeddingProviderType === 'openai' && (
              <div className="space-y-3 rounded-xl border border-border/50 bg-card/40 p-3">
                <h4 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">OpenAI Configuration</h4>
                <PasswordField
                  label="API Key"
                  value={embeddingProvider?.openai?.apiKey ?? ''}
                  onChange={(v) => updateConfig('memory.semanticRecall.embeddingProvider.openai.apiKey', v)}
                  placeholder="sk-..."
                />
              </div>
            )}

            {/* ── Azure Configuration ── */}
            {embeddingProviderType === 'azure' && (
              <div className="space-y-3 rounded-xl border border-border/50 bg-card/40 p-3">
                <h4 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Azure OpenAI Configuration</h4>
                <p className="text-[10px] text-muted-foreground/60">
                  Configure Azure-specific credentials here, or leave blank to use the global Azure primary provider.
                </p>

                <TextField
                  label="Endpoint"
                  value={embeddingProvider?.azure?.endpoint ?? ''}
                  onChange={(v) => updateConfig('memory.semanticRecall.embeddingProvider.azure.endpoint', v || undefined)}
                  placeholder="https://your-resource.cognitiveservices.azure.com/"
                  mono
                  hint="Your Azure OpenAI resource base URL. Leave blank to use the global Azure primary provider."
                />

                <PasswordField
                  label="API Key"
                  value={embeddingProvider?.azure?.apiKey ?? ''}
                  onChange={(v) => updateConfig('memory.semanticRecall.embeddingProvider.azure.apiKey', v)}
                  placeholder="Enter your Azure OpenAI API key"
                />

                <TextField
                  label="Deployment Name"
                  value={embeddingProvider?.azure?.deploymentName ?? ''}
                  onChange={(v) => updateConfig('memory.semanticRecall.embeddingProvider.azure.deploymentName', v)}
                  placeholder="text-embedding-3-small"
                  hint="Azure deployment name for the embedding model. Overrides the model name above when set."
                />

                <TextField
                  label="API Version"
                  value={embeddingProvider?.azure?.apiVersion ?? ''}
                  onChange={(v) => updateConfig('memory.semanticRecall.embeddingProvider.azure.apiVersion', v)}
                  placeholder="2024-02-01"
                />
              </div>
            )}

            {/* ── Custom Configuration ── */}
            {embeddingProviderType === 'custom' && (
              <div className="space-y-3 rounded-xl border border-border/50 bg-card/40 p-3">
                <h4 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Custom Provider Configuration</h4>
                <p className="text-[10px] text-muted-foreground/60">
                  Use any OpenAI-compatible embeddings endpoint (e.g. a proxy, local server, or third-party provider).
                </p>

                <TextField
                  label="Base URL"
                  value={embeddingProvider?.custom?.baseUrl ?? ''}
                  onChange={(v) => updateConfig('memory.semanticRecall.embeddingProvider.custom.baseUrl', v || undefined)}
                  placeholder="https://api.example.com/v1"
                  mono
                  hint="The base URL of the OpenAI-compatible embeddings API (must support POST /embeddings)."
                />

                <PasswordField
                  label="API Key"
                  value={embeddingProvider?.custom?.apiKey ?? ''}
                  onChange={(v) => updateConfig('memory.semanticRecall.embeddingProvider.custom.apiKey', v)}
                  placeholder="Enter your API key (optional for some providers)"
                />
              </div>
            )}

            {/* ── Test Connection ── */}
            <div className="pt-1">
              <TestEmbeddingButton />
            </div>
          </div>
        )}
      </fieldset>

      <ClearMemorySection />
    </div>
  );
};

/* ── Clear Memory Section ── */

type ClearStatus = 'idle' | 'confirming' | 'clearing' | 'done' | 'error';

const ClearMemorySection: FC = () => {
  const [status, setStatus] = useState<ClearStatus>('idle');
  const [working, setWorking] = useState(true);
  const [observational, setObservational] = useState(true);
  const [semantic, setSemantic] = useState(true);
  const [clearAll, setClearAll] = useState(false);
  const [result, setResult] = useState<{ cleared?: string[]; error?: string } | null>(null);

  const noneSelected = !clearAll && !working && !observational && !semantic;

  const handleClear = async () => {
    setStatus('clearing');
    setResult(null);
    try {
      const res = await app.memory.clear(
        clearAll
          ? { all: true }
          : { working, observational, semantic },
      );
      if (res.error) {
        setResult({ error: res.error });
        setStatus('error');
      } else {
        setResult({ cleared: res.cleared });
        setStatus('done');
      }
    } catch (err) {
      setResult({ error: String(err) });
      setStatus('error');
    }
  };

  const reset = () => {
    setStatus('idle');
    setResult(null);
  };

  return (
    <fieldset className="rounded-lg border border-destructive/30 p-3 space-y-3">
      <legend className="text-xs font-semibold px-1 text-destructive">Clear Memory</legend>

      <p className="text-[10px] text-muted-foreground">
        Permanently delete stored memories. This cannot be undone.
      </p>

      <div className="space-y-1.5">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={clearAll}
            onChange={(e) => {
              setClearAll(e.target.checked);
              if (e.target.checked) { setWorking(true); setObservational(true); setSemantic(true); }
            }}
            className="rounded"
          />
          <span className="text-xs font-medium text-destructive">Clear ALL memory (nuclear option)</span>
        </label>

        {!clearAll && (
          <>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={working} onChange={(e) => setWorking(e.target.checked)} className="rounded" />
              <span className="text-xs">Working memory (preferences, facts)</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={observational} onChange={(e) => setObservational(e.target.checked)} className="rounded" />
              <span className="text-xs">Observational memory (AI observations)</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={semantic} onChange={(e) => setSemantic(e.target.checked)} className="rounded" />
              <span className="text-xs">Semantic recall (vector embeddings)</span>
            </label>
          </>
        )}
      </div>

      {/* Action buttons */}
      {status === 'idle' && (
        <button
          type="button"
          disabled={noneSelected}
          onClick={() => setStatus('confirming')}
          className="flex items-center gap-1.5 rounded-md border border-destructive/30 text-destructive px-3 py-1.5 text-xs hover:bg-destructive/10 disabled:opacity-40 transition-colors"
        >
          <Trash2Icon className="h-3.5 w-3.5" />
          Clear Selected Memory
        </button>
      )}

      {/* Confirmation modal */}
      {status === 'confirming' && (
        <div className="rounded-md border border-destructive/50 bg-destructive/5 p-3 space-y-2">
          <div className="flex items-start gap-2">
            <AlertTriangleIcon className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-medium text-destructive">Are you sure?</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {clearAll
                  ? 'This will permanently delete ALL stored memories, including working memory, observations, and vector embeddings.'
                  : `This will permanently delete: ${[
                      working && 'working memory',
                      observational && 'observational memory',
                      semantic && 'semantic recall vectors',
                    ].filter(Boolean).join(', ')}.`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleClear}
              className="rounded-md bg-destructive text-destructive-foreground px-3 py-1 text-xs font-medium hover:bg-destructive/90 transition-colors"
            >
              Yes, clear permanently
            </button>
            <button
              type="button"
              onClick={reset}
              className="rounded-md bg-muted px-3 py-1 text-xs hover:bg-muted/80 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Clearing spinner */}
      {status === 'clearing' && (
        <div className="flex items-center gap-1.5 text-[10px] text-blue-600 dark:text-blue-400">
          <LoaderIcon className="h-3 w-3 animate-spin" />
          Clearing memory...
        </div>
      )}

      {/* Success */}
      {status === 'done' && result?.cleared && (
        <div className="rounded-md border border-green-500/30 bg-green-500/5 p-2 space-y-1">
          <div className="flex items-center gap-1.5 text-[10px] text-green-600 dark:text-green-400">
            <CheckCircle2Icon className="h-3 w-3" />
            Memory cleared successfully
          </div>
          <ul className="text-[10px] text-muted-foreground ml-5 list-disc">
            {result.cleared.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <button type="button" onClick={reset} className="text-[10px] text-muted-foreground hover:text-foreground transition-colors mt-1">
            Dismiss
          </button>
        </div>
      )}

      {/* Error */}
      {status === 'error' && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2">
          <p className="text-[10px] text-destructive">{result?.error ?? 'Unknown error'}</p>
          <button type="button" onClick={reset} className="text-[10px] text-muted-foreground hover:text-foreground transition-colors mt-1">
            Dismiss
          </button>
        </div>
      )}
    </fieldset>
  );
};
