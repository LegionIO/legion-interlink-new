import { useState, useEffect, useCallback, type FC } from 'react';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  RefreshCwIcon,
  Loader2Icon,
  AlertTriangleIcon,
  CheckCircle2Icon,
  RotateCcwIcon,
  LayersIcon,
  ScissorsIcon,
  MessageSquareIcon,
  DatabaseIcon,
  ServerIcon,
  GitBranchIcon,
  ArrowUpCircleIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react';
import { app } from '@/lib/ipc-client';
import { Toggle, settingsSelectClass, type SettingsProps } from './shared';

// ── Config shape ──────────────────────────────────────────────────────────────

type DaemonLlmConfig = {
  contextCuration?: {
    enabled?: boolean;
    mode?: 'heuristic' | 'llm_assisted';
    llmAssisted?: boolean;
    llmModel?: string | null;
    toolResultMaxChars?: number;
    thinkingEviction?: boolean;
    exchangeFolding?: boolean;
    supersededEviction?: boolean;
    dedupEnabled?: boolean;
    dedupThreshold?: number;
    targetContextTokens?: number;
  };
  debate?: {
    enabled?: boolean;
    gaiaAutoTrigger?: boolean;
    defaultRounds?: number;
    maxRounds?: number;
    advocateModel?: string;
    challengerModel?: string;
    judgeModel?: string;
    modelSelectionStrategy?: 'rotate' | 'fixed';
  };
  promptCaching?: {
    enabled?: boolean;
    cacheSystemPrompt?: boolean;
    cacheTools?: boolean;
    cacheConversation?: boolean;
    sortTools?: boolean;
    scope?: 'ephemeral';
    minTokens?: number;
  };
  tokenBudget?: {
    sessionMaxTokens?: number | null;
    sessionWarnTokens?: number | null;
    dailyMaxTokens?: number | null;
  };
  providerLayer?: {
    mode?: 'ruby_llm' | 'native' | 'auto';
    nativeProviders?: string[];
    fallbackToRubyLlm?: boolean;
  };
  tierRouting?: {
    enabled?: boolean;
    customMappings?: Record<string, string>;
  };
  escalation?: {
    enabled?: boolean;
    pipelineEnabled?: boolean;
  };
};

// ── Live status types ─────────────────────────────────────────────────────────

interface TokenBudgetStatus {
  session_tokens?: number;
  session_max?: number | null;
  session_warn?: number | null;
  daily_tokens?: number;
  daily_max?: number | null;
}

interface ProviderInfo {
  name: string;
  enabled?: boolean;
  models?: number;
}

interface CurationStats {
  messages_curated?: number;
  tokens_saved?: number;
  last_run?: string;
  dedup_matches?: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function cfg(config: Record<string, unknown>): DaemonLlmConfig {
  return ((config.appConfig as Record<string, unknown> | undefined)?.daemonLlm ??
    (config.daemonLlm as DaemonLlmConfig | undefined) ??
    {}) as DaemonLlmConfig;
}

function numOrNull(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return isNaN(n) ? null : n;
}

// ── Collapsible section wrapper ───────────────────────────────────────────────

const Section: FC<{
  icon: FC<{ className?: string }>;
  title: string;
  description?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}> = ({ icon: Icon, title, description, defaultOpen = false, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <fieldset className="rounded-lg border border-border/60">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
      >
        <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-xs font-semibold flex-1">{title}</span>
        {description && !open && (
          <span className="text-[10px] text-muted-foreground truncate max-w-[180px] mr-2">{description}</span>
        )}
        {open
          ? <ChevronDownIcon className="h-3 w-3 text-muted-foreground shrink-0" />
          : <ChevronRightIcon className="h-3 w-3 text-muted-foreground shrink-0" />}
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-3 border-t border-border/40 pt-3">
          {description && <p className="text-[10px] text-muted-foreground">{description}</p>}
          {children}
        </div>
      )}
    </fieldset>
  );
};

// ── Nullable number input ─────────────────────────────────────────────────────

const NullableNumberInput: FC<{
  label: string;
  value: number | null | undefined;
  onChange: (v: number | null) => void;
  hint?: string;
  min?: number;
}> = ({ label, value, onChange, hint, min }) => {
  const [local, setLocal] = useState(value == null ? '' : String(value));

  useEffect(() => {
    setLocal(value == null ? '' : String(value));
  }, [value]);

  return (
    <div>
      <label className="text-[10px] text-muted-foreground block mb-0.5">{label}</label>
      <input
        type="number"
        className="w-full rounded-xl border border-border/70 bg-card/80 px-3 py-2 text-xs outline-none"
        value={local}
        min={min}
        placeholder="(off)"
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => onChange(numOrNull(local))}
      />
      {hint && <span className="text-[10px] text-muted-foreground/60 mt-0.5 block">{hint}</span>}
    </div>
  );
};

// ── Provider Layer section ────────────────────────────────────────────────────

const ProviderLayerSection: FC<{
  daemonLlm: DaemonLlmConfig;
  updateConfig: (path: string, value: unknown) => Promise<void>;
}> = ({ daemonLlm, updateConfig }) => {
  const pl = daemonLlm.providerLayer ?? {};
  const mode = pl.mode ?? 'ruby_llm';
  const nativeProviders = pl.nativeProviders ?? ['claude', 'bedrock'];
  const fallback = pl.fallbackToRubyLlm ?? true;

  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [loadingProviders, setLoadingProviders] = useState(false);
  const [newProvider, setNewProvider] = useState('');

  const fetchProviders = useCallback(async () => {
    setLoadingProviders(true);
    try {
      const res = await app.daemon.capabilities();
      if (res.ok && res.data) {
        const data = res.data as Record<string, unknown>;
        const list = Array.isArray(data.providers) ? data.providers as ProviderInfo[] : [];
        setProviders(list);
      }
    } catch {
      // daemon not reachable — silent
    } finally {
      setLoadingProviders(false);
    }
  }, []);

  useEffect(() => { void fetchProviders(); }, [fetchProviders]);

  const removeProvider = (name: string) => {
    updateConfig('appConfig.daemonLlm.providerLayer.nativeProviders', nativeProviders.filter((p) => p !== name));
  };

  const addProvider = () => {
    const trimmed = newProvider.trim();
    if (!trimmed || nativeProviders.includes(trimmed)) return;
    updateConfig('appConfig.daemonLlm.providerLayer.nativeProviders', [...nativeProviders, trimmed]);
    setNewProvider('');
  };

  return (
    <Section icon={ServerIcon} title="Provider Layer" description="How the daemon routes LLM calls" defaultOpen>
      <div>
        <label className="text-[10px] text-muted-foreground block mb-0.5">Mode</label>
        <select
          className={settingsSelectClass}
          value={mode}
          onChange={(e) => updateConfig('appConfig.daemonLlm.providerLayer.mode', e.target.value)}
        >
          <option value="ruby_llm">ruby_llm (default Ruby LLM provider)</option>
          <option value="native">native (Electron-side providers only)</option>
          <option value="auto">auto (prefer native, fall back to ruby_llm)</option>
        </select>
        <p className="text-[10px] text-muted-foreground/70 mt-0.5">
          Controls whether the daemon uses its built-in ruby_llm layer, native Electron providers, or both.
        </p>
      </div>

      <Toggle
        label="Fall back to ruby_llm if native provider fails"
        checked={fallback}
        onChange={(v) => updateConfig('appConfig.daemonLlm.providerLayer.fallbackToRubyLlm', v)}
      />

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-[10px] text-muted-foreground">Native Providers</label>
          <button
            type="button"
            onClick={() => void fetchProviders()}
            disabled={loadingProviders}
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            <RefreshCwIcon className={`h-3 w-3 ${loadingProviders ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        <div className="space-y-1.5">
          {nativeProviders.map((name) => {
            const live = providers.find((p) => p.name === name);
            return (
              <div key={name} className="flex items-center gap-2 rounded-xl border border-border/40 bg-card/60 px-3 py-1.5">
                <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${live?.enabled ? 'bg-emerald-400' : 'bg-muted-foreground/40'}`} />
                <span className="text-xs flex-1 font-mono">{name}</span>
                {live?.models != null && (
                  <span className="text-[10px] text-muted-foreground">{live.models} models</span>
                )}
                <button
                  type="button"
                  onClick={() => removeProvider(name)}
                  className="rounded p-0.5 text-muted-foreground hover:text-destructive transition-colors"
                  title="Remove provider"
                >
                  <Trash2Icon className="h-3 w-3" />
                </button>
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-2 mt-2">
          <input
            type="text"
            className="flex-1 rounded-xl border border-border/70 bg-card/80 px-3 py-1.5 text-xs outline-none font-mono"
            placeholder="provider name (e.g. openai)"
            value={newProvider}
            onChange={(e) => setNewProvider(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addProvider(); }}
          />
          <button
            type="button"
            onClick={addProvider}
            className="flex items-center gap-1 rounded-xl border border-border/60 px-2.5 py-1.5 text-[10px] font-medium hover:bg-muted/60 transition-colors"
          >
            <PlusIcon className="h-3 w-3" />
            Add
          </button>
        </div>

        {providers.length > 0 && (
          <p className="text-[10px] text-muted-foreground/60 mt-1">
            {providers.length} provider{providers.length !== 1 ? 's' : ''} registered in daemon
          </p>
        )}
      </div>
    </Section>
  );
};

// ── Context Curation section ──────────────────────────────────────────────────

const ContextCurationSection: FC<{
  daemonLlm: DaemonLlmConfig;
  updateConfig: (path: string, value: unknown) => Promise<void>;
}> = ({ daemonLlm, updateConfig }) => {
  const cc = daemonLlm.contextCuration ?? {};
  const enabled = cc.enabled ?? true;
  const mode = cc.mode ?? 'heuristic';
  const llmModel = cc.llmModel ?? '';
  const toolResultMaxChars = cc.toolResultMaxChars ?? 2000;
  const thinkingEviction = cc.thinkingEviction ?? true;
  const exchangeFolding = cc.exchangeFolding ?? true;
  const supersededEviction = cc.supersededEviction ?? true;
  const dedupEnabled = cc.dedupEnabled ?? true;
  const dedupThreshold = cc.dedupThreshold ?? 0.85;
  const targetContextTokens = cc.targetContextTokens ?? 40000;

  const [stats, setStats] = useState<CurationStats | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);

  const fetchStats = useCallback(async () => {
    setLoadingStats(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await (app.daemon as any).llmContextCurationStatus?.();
      if (res?.ok && res.data) {
        setStats(res.data as CurationStats);
      }
    } catch {
      // endpoint not available
    } finally {
      setLoadingStats(false);
    }
  }, []);

  useEffect(() => { void fetchStats(); }, [fetchStats]);

  const base = 'appConfig.daemonLlm.contextCuration';

  return (
    <Section icon={ScissorsIcon} title="Context Curation" description="Trim and compress context window before inference">
      <Toggle
        label="Enable context curation"
        checked={enabled}
        onChange={(v) => updateConfig(`${base}.enabled`, v)}
      />

      {enabled && (
        <>
          <div>
            <label className="text-[10px] text-muted-foreground block mb-0.5">Curation Mode</label>
            <select
              className={settingsSelectClass}
              value={mode}
              onChange={(e) => updateConfig(`${base}.mode`, e.target.value)}
            >
              <option value="heuristic">Heuristic (fast, rule-based)</option>
              <option value="llm_assisted">LLM-assisted (slower, smarter)</option>
            </select>
          </div>

          {mode === 'llm_assisted' && (
            <div>
              <label className="text-[10px] text-muted-foreground block mb-0.5">LLM Model for Curation</label>
              <input
                type="text"
                className="w-full rounded-xl border border-border/70 bg-card/80 px-3 py-2 text-xs font-mono outline-none"
                value={llmModel}
                placeholder="e.g. claude-haiku (blank = use default)"
                onChange={(e) => updateConfig(`${base}.llmModel`, e.target.value || null)}
              />
            </div>
          )}

          <fieldset className="rounded-md border border-border/40 p-2 space-y-1.5">
            <legend className="text-[10px] font-medium px-1">Eviction Strategies</legend>
            <Toggle
              label="Evict thinking/scratchpad blocks"
              checked={thinkingEviction}
              onChange={(v) => updateConfig(`${base}.thinkingEviction`, v)}
            />
            <Toggle
              label="Fold exchange summaries (replace pairs with summary)"
              checked={exchangeFolding}
              onChange={(v) => updateConfig(`${base}.exchangeFolding`, v)}
            />
            <Toggle
              label="Evict superseded messages (earlier answers overwritten)"
              checked={supersededEviction}
              onChange={(v) => updateConfig(`${base}.supersededEviction`, v)}
            />
          </fieldset>

          <fieldset className="rounded-md border border-border/40 p-2 space-y-2">
            <legend className="text-[10px] font-medium px-1">Deduplication</legend>
            <Toggle
              label="Enable semantic deduplication"
              checked={dedupEnabled}
              onChange={(v) => updateConfig(`${base}.dedupEnabled`, v)}
            />
            {dedupEnabled && (
              <div>
                <label className="text-[10px] text-muted-foreground block mb-0.5">
                  Similarity threshold: {dedupThreshold.toFixed(2)}
                </label>
                <input
                  type="range"
                  className="w-full accent-[var(--color-primary)]"
                  min={0.5}
                  max={1.0}
                  step={0.01}
                  value={dedupThreshold}
                  onChange={(e) => updateConfig(`${base}.dedupThreshold`, Number(e.target.value))}
                />
                <div className="flex justify-between text-[9px] text-muted-foreground/60 mt-0.5">
                  <span>0.50 (aggressive)</span>
                  <span>1.00 (exact only)</span>
                </div>
              </div>
            )}
          </fieldset>

          <div>
            <label className="text-[10px] text-muted-foreground block mb-0.5">Tool result max chars</label>
            <input
              type="number"
              className="w-full rounded-xl border border-border/70 bg-card/80 px-3 py-2 text-xs outline-none"
              value={toolResultMaxChars}
              min={100}
              onChange={(e) => updateConfig(`${base}.toolResultMaxChars`, Number(e.target.value))}
            />
            <span className="text-[10px] text-muted-foreground/60 mt-0.5 block">
              Truncate tool results to this many characters before injection
            </span>
          </div>

          <div>
            <label className="text-[10px] text-muted-foreground block mb-0.5">Target context tokens</label>
            <input
              type="number"
              className="w-full rounded-xl border border-border/70 bg-card/80 px-3 py-2 text-xs outline-none"
              value={targetContextTokens}
              min={1000}
              onChange={(e) => updateConfig(`${base}.targetContextTokens`, Number(e.target.value))}
            />
            <span className="text-[10px] text-muted-foreground/60 mt-0.5 block">
              Curation targets this token budget before each inference call
            </span>
          </div>

          {/* Live stats */}
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground font-medium">Live Stats</span>
            <button
              type="button"
              onClick={() => void fetchStats()}
              disabled={loadingStats}
              className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            >
              <RefreshCwIcon className={`h-3 w-3 ${loadingStats ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
          {stats ? (
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: 'Messages curated', value: stats.messages_curated ?? '—' },
                { label: 'Tokens saved', value: stats.tokens_saved ?? '—' },
                { label: 'Dedup matches', value: stats.dedup_matches ?? '—' },
                { label: 'Last run', value: stats.last_run ?? '—' },
              ].map(({ label, value }) => (
                <div key={label} className="rounded-lg border border-border/40 bg-card/40 px-3 py-2">
                  <p className="text-[10px] text-muted-foreground">{label}</p>
                  <p className="text-xs font-medium mt-0.5">{String(value)}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[10px] text-muted-foreground/60">
              {loadingStats ? 'Fetching stats...' : 'Stats not available (daemon may be offline)'}
            </p>
          )}
        </>
      )}
    </Section>
  );
};

// ── Debate section ────────────────────────────────────────────────────────────

const DebateSection: FC<{
  daemonLlm: DaemonLlmConfig;
  updateConfig: (path: string, value: unknown) => Promise<void>;
}> = ({ daemonLlm, updateConfig }) => {
  const d = daemonLlm.debate ?? {};
  const enabled = d.enabled ?? false;
  const gaiaAutoTrigger = d.gaiaAutoTrigger ?? false;
  const defaultRounds = d.defaultRounds ?? 1;
  const maxRounds = d.maxRounds ?? 3;
  const advocateModel = d.advocateModel ?? '';
  const challengerModel = d.challengerModel ?? '';
  const judgeModel = d.judgeModel ?? '';
  const strategy = d.modelSelectionStrategy ?? 'rotate';

  const base = 'appConfig.daemonLlm.debate';

  return (
    <Section icon={MessageSquareIcon} title="Debate" description="Multi-model adversarial reasoning pipeline">
      <Toggle
        label="Enable debate pipeline"
        checked={enabled}
        onChange={(v) => updateConfig(`${base}.enabled`, v)}
      />

      {enabled && (
        <>
          <Toggle
            label="GAIA auto-trigger (GAIA decides when to debate)"
            checked={gaiaAutoTrigger}
            onChange={(v) => updateConfig(`${base}.gaiaAutoTrigger`, v)}
          />

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-muted-foreground block mb-0.5">Default rounds</label>
              <input
                type="number"
                className="w-full rounded-xl border border-border/70 bg-card/80 px-3 py-2 text-xs outline-none"
                value={defaultRounds}
                min={1}
                max={maxRounds}
                onChange={(e) => updateConfig(`${base}.defaultRounds`, Number(e.target.value))}
              />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground block mb-0.5">Max rounds</label>
              <input
                type="number"
                className="w-full rounded-xl border border-border/70 bg-card/80 px-3 py-2 text-xs outline-none"
                value={maxRounds}
                min={1}
                max={10}
                onChange={(e) => updateConfig(`${base}.maxRounds`, Number(e.target.value))}
              />
            </div>
          </div>

          <div>
            <label className="text-[10px] text-muted-foreground block mb-0.5">Model selection strategy</label>
            <select
              className={settingsSelectClass}
              value={strategy}
              onChange={(e) => updateConfig(`${base}.modelSelectionStrategy`, e.target.value)}
            >
              <option value="rotate">Rotate (cycle through available models)</option>
              <option value="fixed">Fixed (always use the configured models below)</option>
            </select>
          </div>

          {strategy === 'fixed' && (
            <fieldset className="rounded-md border border-border/40 p-2 space-y-2">
              <legend className="text-[10px] font-medium px-1">Role Models</legend>
              {[
                { label: 'Advocate model', key: 'advocateModel', value: advocateModel, placeholder: 'e.g. claude-sonnet' },
                { label: 'Challenger model', key: 'challengerModel', value: challengerModel, placeholder: 'e.g. claude-opus' },
                { label: 'Judge model', key: 'judgeModel', value: judgeModel, placeholder: 'e.g. claude-sonnet' },
              ].map(({ label, key, value, placeholder }) => (
                <div key={key}>
                  <label className="text-[10px] text-muted-foreground block mb-0.5">{label}</label>
                  <input
                    type="text"
                    className="w-full rounded-xl border border-border/70 bg-card/80 px-3 py-2 text-xs font-mono outline-none"
                    value={value}
                    placeholder={placeholder}
                    onChange={(e) => updateConfig(`${base}.${key}`, e.target.value)}
                  />
                </div>
              ))}
              <p className="text-[10px] text-muted-foreground/60">
                Leave blank to use the daemon's default model for that role.
              </p>
            </fieldset>
          )}
        </>
      )}
    </Section>
  );
};

// ── Prompt Caching section ────────────────────────────────────────────────────

const PromptCachingSection: FC<{
  daemonLlm: DaemonLlmConfig;
  updateConfig: (path: string, value: unknown) => Promise<void>;
}> = ({ daemonLlm, updateConfig }) => {
  const pc = daemonLlm.promptCaching ?? {};
  const enabled = pc.enabled ?? false;
  const cacheSystemPrompt = pc.cacheSystemPrompt ?? true;
  const cacheTools = pc.cacheTools ?? true;
  const cacheConversation = pc.cacheConversation ?? true;
  const sortTools = pc.sortTools ?? true;
  const minTokens = pc.minTokens ?? 1000;

  const base = 'appConfig.daemonLlm.promptCaching';

  return (
    <Section icon={DatabaseIcon} title="Prompt Caching" description="Cache prompt prefixes to reduce latency and cost">
      <Toggle
        label="Enable prompt caching"
        checked={enabled}
        onChange={(v) => updateConfig(`${base}.enabled`, v)}
      />

      {enabled && (
        <>
          <fieldset className="rounded-md border border-border/40 p-2 space-y-1.5">
            <legend className="text-[10px] font-medium px-1">Cache Targets</legend>
            <Toggle
              label="Cache system prompt"
              checked={cacheSystemPrompt}
              onChange={(v) => updateConfig(`${base}.cacheSystemPrompt`, v)}
            />
            <Toggle
              label="Cache tool definitions"
              checked={cacheTools}
              onChange={(v) => updateConfig(`${base}.cacheTools`, v)}
            />
            <Toggle
              label="Cache conversation prefix"
              checked={cacheConversation}
              onChange={(v) => updateConfig(`${base}.cacheConversation`, v)}
            />
          </fieldset>

          <Toggle
            label="Sort tools before caching (improves cache hit rate)"
            checked={sortTools}
            onChange={(v) => updateConfig(`${base}.sortTools`, v)}
          />

          <div>
            <label className="text-[10px] text-muted-foreground block mb-0.5">Minimum tokens to cache</label>
            <input
              type="number"
              className="w-full rounded-xl border border-border/70 bg-card/80 px-3 py-2 text-xs outline-none"
              value={minTokens}
              min={0}
              onChange={(e) => updateConfig(`${base}.minTokens`, Number(e.target.value))}
            />
            <span className="text-[10px] text-muted-foreground/60 mt-0.5 block">
              Only cache blocks with at least this many tokens (Anthropic minimum: 1024)
            </span>
          </div>

          <div className="flex items-start gap-2 rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2">
            <AlertTriangleIcon className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
            <p className="text-[10px] text-muted-foreground">
              Prompt caching scope is <span className="font-mono">ephemeral</span> — cached content lives for ~5 minutes. Only supported by providers with cache_control API support (Anthropic, some OpenAI-compatible).
            </p>
          </div>
        </>
      )}
    </Section>
  );
};

// ── Token Budget section ──────────────────────────────────────────────────────

const TokenBudgetSection: FC<{
  daemonLlm: DaemonLlmConfig;
  updateConfig: (path: string, value: unknown) => Promise<void>;
}> = ({ daemonLlm, updateConfig }) => {
  const tb = daemonLlm.tokenBudget ?? {};
  const sessionMaxTokens = tb.sessionMaxTokens ?? null;
  const sessionWarnTokens = tb.sessionWarnTokens ?? null;
  const dailyMaxTokens = tb.dailyMaxTokens ?? null;

  const [status, setStatus] = useState<TokenBudgetStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetOk, setResetOk] = useState(false);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await (app.daemon as any).llmTokenBudget?.();
      if (res?.ok && res.data) {
        setStatus(res.data as TokenBudgetStatus);
      }
    } catch {
      // endpoint not available
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchStatus(); }, [fetchStatus]);

  const handleReset = async () => {
    setResetting(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await (app.daemon as any).llmTokenBudgetReset?.();
      if (res?.ok) {
        setResetOk(true);
        setTimeout(() => setResetOk(false), 3000);
        void fetchStatus();
      }
    } catch {
      // silent
    } finally {
      setResetting(false);
    }
  };

  const base = 'appConfig.daemonLlm.tokenBudget';

  const pct = (used: number | undefined, max: number | null | undefined) => {
    if (used == null || !max) return null;
    return Math.min(Math.round((used / max) * 100), 100);
  };

  const sessionPct = pct(status?.session_tokens, status?.session_max);
  const dailyPct = pct(status?.daily_tokens, status?.daily_max);

  return (
    <Section icon={LayersIcon} title="Token Budget" description="Session and daily token limits">
      <div className="grid grid-cols-1 gap-3">
        <NullableNumberInput
          label="Session max tokens (blank = off)"
          value={sessionMaxTokens}
          onChange={(v) => updateConfig(`${base}.sessionMaxTokens`, v)}
          min={1000}
          hint="Hard limit per conversation session. Stops inference when reached."
        />
        <NullableNumberInput
          label="Session warn tokens (blank = off)"
          value={sessionWarnTokens}
          onChange={(v) => updateConfig(`${base}.sessionWarnTokens`, v)}
          min={1000}
          hint="Show a warning when session usage approaches this threshold."
        />
        <NullableNumberInput
          label="Daily max tokens (blank = off)"
          value={dailyMaxTokens}
          onChange={(v) => updateConfig(`${base}.dailyMaxTokens`, v)}
          min={1000}
          hint="Hard daily token limit across all sessions. Resets at midnight UTC."
        />
      </div>

      {/* Live usage */}
      <div className="flex items-center justify-between mt-1">
        <span className="text-[10px] text-muted-foreground font-medium">Current Usage</span>
        <button
          type="button"
          onClick={() => void fetchStatus()}
          disabled={loading}
          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
        >
          <RefreshCwIcon className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {status ? (
        <div className="space-y-2">
          <UsageBar
            label="Session"
            used={status.session_tokens}
            max={status.session_max}
            warn={status.session_warn}
            pct={sessionPct}
          />
          <UsageBar
            label="Daily"
            used={status.daily_tokens}
            max={status.daily_max}
            pct={dailyPct}
          />

          <button
            type="button"
            onClick={() => void handleReset()}
            disabled={resetting}
            className="flex items-center gap-1.5 rounded-xl border border-border/60 px-3 py-1.5 text-xs hover:bg-muted/60 transition-colors disabled:opacity-50"
          >
            {resetting
              ? <Loader2Icon className="h-3 w-3 animate-spin" />
              : resetOk
                ? <CheckCircle2Icon className="h-3 w-3 text-emerald-400" />
                : <RotateCcwIcon className="h-3 w-3" />}
            {resetOk ? 'Session reset' : 'Reset session counter'}
          </button>
        </div>
      ) : (
        <p className="text-[10px] text-muted-foreground/60">
          {loading ? 'Fetching usage...' : 'Usage not available (daemon may be offline)'}
        </p>
      )}
    </Section>
  );
};

const UsageBar: FC<{
  label: string;
  used?: number;
  max?: number | null;
  warn?: number | null;
  pct?: number | null;
}> = ({ label, used, max, warn, pct }) => {
  if (used == null) return null;
  const warnPct = warn && max ? Math.min(Math.round((warn / max) * 100), 100) : null;
  const isWarning = warn != null && used >= warn;
  const isOver = max != null && used >= max;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-muted-foreground">{label}</span>
        <span className={isOver ? 'text-destructive' : isWarning ? 'text-amber-500' : 'text-muted-foreground'}>
          {used.toLocaleString()}{max ? ` / ${max.toLocaleString()}` : ''} tok
          {pct != null ? ` (${pct}%)` : ''}
        </span>
      </div>
      {max != null && (
        <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted/30">
          {warnPct != null && (
            <div className="absolute top-0 h-full w-px bg-amber-400/60" style={{ left: `${warnPct}%` }} />
          )}
          <div
            className={`h-full rounded-full transition-all ${isOver ? 'bg-destructive' : isWarning ? 'bg-amber-400' : 'bg-primary/70'}`}
            style={{ width: `${pct ?? 0}%` }}
          />
        </div>
      )}
    </div>
  );
};

// ── Tier Routing section ──────────────────────────────────────────────────────

const TierRoutingSection: FC<{
  daemonLlm: DaemonLlmConfig;
  updateConfig: (path: string, value: unknown) => Promise<void>;
}> = ({ daemonLlm, updateConfig }) => {
  const tr = daemonLlm.tierRouting ?? {};
  const enabled = tr.enabled ?? true;
  const customMappings = tr.customMappings ?? {};
  const entries = Object.entries(customMappings);

  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');

  const base = 'appConfig.daemonLlm.tierRouting';

  const addMapping = () => {
    const k = newKey.trim();
    const v = newValue.trim();
    if (!k || !v) return;
    updateConfig(`${base}.customMappings`, { ...customMappings, [k]: v });
    setNewKey('');
    setNewValue('');
  };

  const removeMapping = (key: string) => {
    const next = { ...customMappings };
    delete next[key];
    updateConfig(`${base}.customMappings`, next);
  };

  return (
    <Section icon={GitBranchIcon} title="Tier Routing" description="Map intent patterns to specific model tiers">
      <Toggle
        label="Enable tier routing"
        checked={enabled}
        onChange={(v) => updateConfig(`${base}.enabled`, v)}
      />

      {enabled && (
        <>
          <p className="text-[10px] text-muted-foreground">
            Custom mappings override the daemon's default tier assignments. Keys are intent patterns (e.g. <span className="font-mono">code_generation</span>), values are tier names (e.g. <span className="font-mono">tier2</span>) or model identifiers.
          </p>

          <div className="space-y-1.5">
            {entries.length === 0 ? (
              <p className="text-[10px] text-muted-foreground/60 italic">No custom mappings — using daemon defaults.</p>
            ) : (
              entries.map(([k, v]) => (
                <div key={k} className="flex items-center gap-2 rounded-xl border border-border/40 bg-card/60 px-3 py-1.5">
                  <span className="text-xs font-mono flex-1 truncate">{k}</span>
                  <span className="text-muted-foreground text-[10px]">→</span>
                  <span className="text-xs font-mono flex-1 truncate text-primary">{v}</span>
                  <button
                    type="button"
                    onClick={() => removeMapping(k)}
                    className="rounded p-0.5 text-muted-foreground hover:text-destructive transition-colors shrink-0"
                    title="Remove mapping"
                  >
                    <Trash2Icon className="h-3 w-3" />
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="flex items-center gap-2">
            <input
              type="text"
              className="flex-1 rounded-xl border border-border/70 bg-card/80 px-3 py-1.5 text-xs font-mono outline-none"
              placeholder="intent pattern"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
            />
            <span className="text-muted-foreground text-xs shrink-0">→</span>
            <input
              type="text"
              className="flex-1 rounded-xl border border-border/70 bg-card/80 px-3 py-1.5 text-xs font-mono outline-none"
              placeholder="tier / model"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addMapping(); }}
            />
            <button
              type="button"
              onClick={addMapping}
              className="flex items-center gap-1 rounded-xl border border-border/60 px-2.5 py-1.5 text-[10px] font-medium hover:bg-muted/60 transition-colors shrink-0"
            >
              <PlusIcon className="h-3 w-3" />
              Add
            </button>
          </div>
        </>
      )}
    </Section>
  );
};

// ── Escalation section ────────────────────────────────────────────────────────

const EscalationSection: FC<{
  daemonLlm: DaemonLlmConfig;
  updateConfig: (path: string, value: unknown) => Promise<void>;
}> = ({ daemonLlm, updateConfig }) => {
  const esc = daemonLlm.escalation ?? {};
  const enabled = esc.enabled ?? true;
  const pipelineEnabled = esc.pipelineEnabled ?? true;

  const base = 'appConfig.daemonLlm.escalation';

  return (
    <Section icon={ArrowUpCircleIcon} title="Escalation" description="Automatically escalate to higher-tier models on low-quality responses">
      <Toggle
        label="Enable escalation"
        checked={enabled}
        onChange={(v) => updateConfig(`${base}.enabled`, v)}
      />

      {enabled && (
        <>
          <Toggle
            label="Enable escalation pipeline (multi-step quality scoring)"
            checked={pipelineEnabled}
            onChange={(v) => updateConfig(`${base}.pipelineEnabled`, v)}
          />
          <p className="text-[10px] text-muted-foreground">
            When a response scores below the daemon's quality threshold, it is automatically re-run with a higher-tier model. Configure thresholds in the daemon's LLM routing settings.
          </p>
        </>
      )}
    </Section>
  );
};

// ── Main component ────────────────────────────────────────────────────────────

export const DaemonLlmSettings: FC<SettingsProps> = ({ config, updateConfig }) => {
  const daemonLlm = cfg(config);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">LLM Pipeline</h3>
        <span className="text-[10px] text-muted-foreground">Daemon LLM configuration</span>
      </div>
      <p className="text-xs text-muted-foreground">
        Configure how the daemon processes, routes, and caches LLM calls. Changes take effect on the daemon's next inference request.
      </p>

      <ProviderLayerSection daemonLlm={daemonLlm} updateConfig={updateConfig} />
      <ContextCurationSection daemonLlm={daemonLlm} updateConfig={updateConfig} />
      <DebateSection daemonLlm={daemonLlm} updateConfig={updateConfig} />
      <PromptCachingSection daemonLlm={daemonLlm} updateConfig={updateConfig} />
      <TokenBudgetSection daemonLlm={daemonLlm} updateConfig={updateConfig} />
      <TierRoutingSection daemonLlm={daemonLlm} updateConfig={updateConfig} />
      <EscalationSection daemonLlm={daemonLlm} updateConfig={updateConfig} />
    </div>
  );
};
