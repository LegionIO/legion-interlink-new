import { useState, useEffect, useCallback, type FC } from 'react';
import {
  RefreshCwIcon,
  LoaderIcon,
  AlertTriangleIcon,
  CheckCircle2Icon,
  WifiOffIcon,
} from 'lucide-react';
import { legion } from '@/lib/ipc-client';
import { Toggle, settingsSelectClass, type SettingsProps } from './shared';

type DaemonSettingsData = Record<string, unknown>;
type LoadState = 'idle' | 'loading' | 'loaded' | 'error';
type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export const DaemonSettings: FC<SettingsProps> = ({ config, updateConfig }) => {
  const [settings, setSettings] = useState<DaemonSettingsData | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [loadError, setLoadError] = useState('');
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState('');

  const daemonUrl = (config.runtime as { legion?: { daemonUrl?: string } })?.legion?.daemonUrl || 'http://127.0.0.1:4567';

  const fetchSettings = useCallback(async () => {
    setLoadState('loading');
    setLoadError('');
    try {
      const result = await legion.daemon.settings() as { ok: boolean; settings?: DaemonSettingsData; error?: string };
      if (result.ok && result.settings) {
        setSettings(result.settings);
        setLoadState('loaded');
      } else {
        setLoadError(result.error || 'Failed to fetch daemon settings');
        setLoadState('error');
      }
    } catch (err) {
      setLoadError(String(err));
      setLoadState('error');
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const updateSetting = useCallback(async (key: string, value: unknown) => {
    setSaveState('saving');
    setSaveError('');
    try {
      const result = await legion.daemon.settingsUpdate(key, value) as { ok: boolean; error?: string };
      if (result.ok) {
        setSaveState('saved');
        setSettings((prev) => prev ? { ...prev, [key]: value } : prev);
        setTimeout(() => setSaveState('idle'), 2000);
      } else {
        setSaveError(result.error || 'Failed to update setting');
        setSaveState('error');
        setTimeout(() => setSaveState('idle'), 4000);
      }
    } catch (err) {
      setSaveError(String(err));
      setSaveState('error');
      setTimeout(() => setSaveState('idle'), 4000);
    }
  }, []);

  if (loadState === 'idle' || loadState === 'loading') {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-8 justify-center">
        <LoaderIcon className="h-4 w-4 animate-spin" />
        Connecting to daemon at {daemonUrl}...
      </div>
    );
  }

  if (loadState === 'error') {
    return (
      <div className="space-y-4">
        <h3 className="text-sm font-semibold">Legion Daemon</h3>
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 space-y-3">
          <div className="flex items-start gap-2">
            <WifiOffIcon className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-medium text-destructive">Cannot connect to daemon</p>
              <p className="text-[10px] text-muted-foreground mt-1">{loadError}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">URL: {daemonUrl}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={fetchSettings}
            className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs hover:bg-muted transition-colors"
          >
            <RefreshCwIcon className="h-3 w-3" />
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!settings) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Legion Daemon</h3>
        <div className="flex items-center gap-3">
          <SaveIndicator state={saveState} error={saveError} />
          <button
            type="button"
            onClick={fetchSettings}
            className="flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] hover:bg-muted transition-colors"
          >
            <RefreshCwIcon className="h-3 w-3" />
            Refresh
          </button>
        </div>
      </div>

      <DaemonStatusBadge url={daemonUrl} />

      <div className="rounded-lg border border-border/50 p-3 space-y-2">
        <p className="text-xs font-semibold">Daemon Chat</p>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={(config.runtime as { legion?: { daemonStreaming?: boolean } })?.legion?.daemonStreaming !== false}
            onChange={(e) => updateConfig('runtime.legion.daemonStreaming', e.target.checked)}
            className="rounded"
          />
          <span className="text-xs">Enable SSE streaming</span>
        </label>
        <p className="text-[10px] text-muted-foreground">
          When enabled, daemon chat responses stream in real-time via Server-Sent Events instead of waiting for the full response.
        </p>
      </div>

      <LoggingSection settings={settings} onUpdate={updateSetting} />
      <CacheSection settings={settings} />
      <TransportSection settings={settings} />
      <DataSection settings={settings} />
      <CryptSection settings={settings} />
      <RbacSection settings={settings} onUpdate={updateSetting} />
      <LlmRoutingSection settings={settings} />
      <GaiaSection settings={settings} />
      <ApiSection settings={settings} />
      <PrivacySection settings={settings} onUpdate={updateSetting} />
    </div>
  );
};

/* ── Status badge ── */

const DaemonStatusBadge: FC<{ url: string }> = ({ url }) => (
  <div className="flex items-center gap-2 rounded-xl border border-green-500/30 bg-green-500/5 px-3 py-2">
    <CheckCircle2Icon className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
    <span className="text-xs text-green-700 dark:text-green-300">Connected to {url}</span>
  </div>
);

/* ── Save indicator ── */

const SaveIndicator: FC<{ state: SaveState; error: string }> = ({ state, error }) => {
  if (state === 'saving') {
    return (
      <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
        <LoaderIcon className="h-3 w-3 animate-spin" /> Saving...
      </span>
    );
  }
  if (state === 'saved') {
    return (
      <span className="flex items-center gap-1 text-[10px] text-green-600 dark:text-green-400">
        <CheckCircle2Icon className="h-3 w-3" /> Saved
      </span>
    );
  }
  if (state === 'error') {
    return (
      <span className="flex items-center gap-1 text-[10px] text-destructive" title={error}>
        <AlertTriangleIcon className="h-3 w-3" /> {error}
      </span>
    );
  }
  return null;
};

/* ── Helper to safely read nested values ── */

function dig(obj: unknown, ...keys: string[]): unknown {
  let current = obj;
  for (const key of keys) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' ? value : fallback;
}

function asBool(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/* ── ReadOnly field ── */

const ReadOnlyField: FC<{ label: string; value: string }> = ({ label, value }) => (
  <div>
    <label className="text-[10px] text-muted-foreground block mb-0.5">{label}</label>
    <div className="w-full rounded-xl border border-border/40 bg-muted/30 px-3 py-2 text-xs text-muted-foreground font-mono select-all">
      {value || <span className="italic opacity-50">not set</span>}
    </div>
  </div>
);

const ReadOnlyBadge: FC<{ label: string; active: boolean }> = ({ label, active }) => (
  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
    active
      ? 'bg-green-500/10 text-green-700 dark:text-green-400 border border-green-500/20'
      : 'bg-muted/50 text-muted-foreground border border-border/40'
  }`}>
    {label}: {active ? 'enabled' : 'disabled'}
  </span>
);

const SectionHeader: FC<{ icon?: FC<{ className?: string }>; label: string; description?: string }> = ({ icon: Icon, label, description }) => (
  <div className="mb-1">
    <div className="flex items-center gap-1.5">
      {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground" />}
      <legend className="text-xs font-semibold">{label}</legend>
    </div>
    {description && <p className="text-[10px] text-muted-foreground mt-0.5">{description}</p>}
  </div>
);

/* ── Logging ── */

const LoggingSection: FC<{ settings: DaemonSettingsData; onUpdate: (key: string, value: unknown) => void }> = ({ settings, onUpdate }) => {
  const logging = (settings.logging ?? {}) as Record<string, unknown>;
  const level = asString(logging.level, 'info');
  const location = asString(logging.location, 'stdout');
  const trace = asBool(logging.trace);

  return (
    <fieldset className="rounded-lg border p-3 space-y-3">
      <SectionHeader label="Logging" description="Daemon log level and output" />

      <div>
        <label className="text-[10px] text-muted-foreground block mb-0.5">Log Level</label>
        <select
          className={settingsSelectClass}
          value={level}
          onChange={(e) => onUpdate('logging', { ...logging, level: e.target.value })}
        >
          <option value="debug">Debug</option>
          <option value="info">Info</option>
          <option value="warn">Warn</option>
          <option value="error">Error</option>
          <option value="fatal">Fatal</option>
        </select>
      </div>

      <ReadOnlyField label="Output Location" value={location} />

      <Toggle
        label="Enable trace logging"
        checked={trace}
        onChange={(v) => onUpdate('logging', { ...logging, trace: v })}
      />
    </fieldset>
  );
};

/* ── Cache ── */

const CacheSection: FC<{ settings: DaemonSettingsData }> = ({ settings }) => {
  const cache = (settings.cache ?? {}) as Record<string, unknown>;
  const driver = asString(cache.driver, 'not configured');
  const servers = asStringArray(cache.servers);
  const connected = asBool(cache.connected);
  const poolSize = asNumber(cache.pool_size, 10);
  const timeout = asNumber(cache.timeout, 5);
  const namespace = asString(cache.namespace, 'legion');
  const compress = asBool(cache.compress);
  const failover = asBool(cache.failover);

  return (
    <fieldset className="rounded-lg border p-3 space-y-3">
      <SectionHeader label="Cache" description="Shared cache (Redis or Memcached)" />

      <div className="flex flex-wrap gap-2">
        <ReadOnlyBadge label="Status" active={connected} />
        <ReadOnlyBadge label="Compression" active={compress} />
        <ReadOnlyBadge label="Failover" active={failover} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <ReadOnlyField label="Driver" value={driver} />
        <ReadOnlyField label="Namespace" value={namespace} />
        <ReadOnlyField label="Pool Size" value={String(poolSize)} />
        <ReadOnlyField label="Timeout (s)" value={String(timeout)} />
      </div>

      {servers.length > 0 && (
        <div>
          <label className="text-[10px] text-muted-foreground block mb-0.5">Servers</label>
          <div className="space-y-1">
            {servers.map((server) => (
              <div key={server} className="rounded-md border border-border/40 bg-muted/30 px-3 py-1.5 text-xs font-mono">
                {server}
              </div>
            ))}
          </div>
        </div>
      )}
    </fieldset>
  );
};

/* ── Transport ── */

const TransportSection: FC<{ settings: DaemonSettingsData }> = ({ settings }) => {
  const transport = (settings.transport ?? {}) as Record<string, unknown>;
  const connection = (transport.connection ?? {}) as Record<string, unknown>;
  const host = asString(connection.host, 'not configured');
  const port = asNumber(connection.port, 5672);
  const vhost = asString(connection.vhost, '/');
  const connected = asBool(dig(settings, 'transport', 'connected') as boolean);
  const ssl = asBool(dig(settings, 'transport', 'ssl') as boolean);

  return (
    <fieldset className="rounded-lg border p-3 space-y-3">
      <SectionHeader label="Transport" description="RabbitMQ message broker (read-only)" />

      <div className="flex flex-wrap gap-2">
        <ReadOnlyBadge label="Status" active={connected} />
        <ReadOnlyBadge label="SSL/TLS" active={ssl} />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <ReadOnlyField label="Host" value={host} />
        <ReadOnlyField label="Port" value={String(port)} />
        <ReadOnlyField label="VHost" value={vhost} />
      </div>

      <p className="text-[10px] text-muted-foreground italic">
        Transport settings are read-only. Edit ~/.legionio/settings/transport.json directly.
      </p>
    </fieldset>
  );
};

/* ── Data ── */

const DataSection: FC<{ settings: DaemonSettingsData }> = ({ settings }) => {
  const data = (settings.data ?? {}) as Record<string, unknown>;
  const adapter = asString(data.adapter, 'not configured');
  const creds = (data.creds ?? {}) as Record<string, unknown>;
  const database = asString(creds.database ?? creds.url, '');

  return (
    <fieldset className="rounded-lg border p-3 space-y-3">
      <SectionHeader label="Data" description="Database persistence (SQLite, PostgreSQL, MySQL)" />

      <div className="grid grid-cols-2 gap-3">
        <ReadOnlyField label="Adapter" value={adapter} />
        <ReadOnlyField label="Database" value={database} />
      </div>
    </fieldset>
  );
};

/* ── Crypt ── */

const CryptSection: FC<{ settings: DaemonSettingsData }> = ({ settings }) => {
  const crypt = (settings.crypt ?? {}) as Record<string, unknown>;
  const vault = (crypt.vault ?? {}) as Record<string, unknown>;
  const jwt = (crypt.jwt ?? {}) as Record<string, unknown>;
  const vaultEnabled = asBool(vault.enabled);
  const vaultAddress = asString(vault.address, 'not configured');
  const vaultPort = asNumber(vault.port, 8200);
  const jwtEnabled = asBool(jwt.enabled);
  const jwtAlgorithm = asString(jwt.default_algorithm, 'HS256');
  const jwtTtl = asNumber(jwt.default_ttl, 3600);
  const clusters = vault.clusters;
  const clusterCount = clusters && typeof clusters === 'object' ? Object.keys(clusters).length : 0;

  return (
    <fieldset className="rounded-lg border p-3 space-y-3">
      <SectionHeader label="Crypt" description="Encryption, Vault, and JWT (read-only)" />

      <div className="flex flex-wrap gap-2">
        <ReadOnlyBadge label="Vault" active={vaultEnabled} />
        <ReadOnlyBadge label="JWT" active={jwtEnabled} />
      </div>

      <fieldset className="rounded-md border border-border/40 p-2 space-y-2">
        <legend className="text-[10px] font-medium px-1">Vault</legend>
        <div className="grid grid-cols-3 gap-3">
          <ReadOnlyField label="Address" value={vaultAddress} />
          <ReadOnlyField label="Port" value={String(vaultPort)} />
          <ReadOnlyField label="Clusters" value={clusterCount > 0 ? `${clusterCount} configured` : 'none'} />
        </div>
      </fieldset>

      <fieldset className="rounded-md border border-border/40 p-2 space-y-2">
        <legend className="text-[10px] font-medium px-1">JWT</legend>
        <div className="grid grid-cols-2 gap-3">
          <ReadOnlyField label="Algorithm" value={jwtAlgorithm} />
          <ReadOnlyField label="Default TTL" value={`${jwtTtl}s`} />
        </div>
      </fieldset>

      <p className="text-[10px] text-muted-foreground italic">
        Crypt settings are read-only. Edit ~/.legionio/settings/crypt.json directly.
      </p>
    </fieldset>
  );
};

/* ── RBAC ── */

const RbacSection: FC<{ settings: DaemonSettingsData; onUpdate: (key: string, value: unknown) => void }> = ({ settings, onUpdate }) => {
  const rbac = (settings.rbac ?? {}) as Record<string, unknown>;
  const enforce = asBool(rbac.enforce);
  const enabled = asBool(rbac.enabled);
  const roles = (rbac.roles ?? {}) as Record<string, unknown>;
  const roleNames = Object.keys(roles);

  const entra = (rbac.entra ?? {}) as Record<string, unknown>;
  const entraTenantId = asString(entra.tenant_id);

  return (
    <fieldset className="rounded-lg border p-3 space-y-3">
      <SectionHeader label="RBAC" description="Role-based access control" />

      <div className="flex flex-wrap gap-2">
        <ReadOnlyBadge label="Enabled" active={enabled} />
        <ReadOnlyBadge label="Enforcement" active={enforce} />
      </div>

      <Toggle
        label="Enforce RBAC (reject unauthorized requests)"
        checked={enforce}
        onChange={(v) => onUpdate('rbac', { ...rbac, enforce: v })}
      />

      {roleNames.length > 0 && (
        <div>
          <label className="text-[10px] text-muted-foreground block mb-1">Defined Roles ({roleNames.length})</label>
          <div className="flex flex-wrap gap-1">
            {roleNames.map((name) => (
              <span key={name} className="inline-flex rounded-full border px-2 py-0.5 text-[10px] font-mono">
                {name}
              </span>
            ))}
          </div>
        </div>
      )}

      {entraTenantId && (
        <ReadOnlyField label="Entra ID Tenant" value={entraTenantId} />
      )}
    </fieldset>
  );
};

/* ── LLM Routing ── */

const LlmRoutingSection: FC<{ settings: DaemonSettingsData }> = ({ settings }) => {
  const llm = (settings.llm ?? {}) as Record<string, unknown>;
  const defaultModel = asString(llm.default_model);
  const defaultProvider = asString(llm.default_provider);
  const connected = asBool(llm.connected);
  const routing = (llm.routing ?? {}) as Record<string, unknown>;
  const rules = Array.isArray(routing.rules) ? routing.rules : [];
  const escalation = (routing.escalation ?? {}) as Record<string, unknown>;
  const escalationEnabled = asBool(escalation.enabled);
  const qualityThreshold = asNumber(escalation.quality_threshold, 50);

  const providers = (llm.providers ?? {}) as Record<string, Record<string, unknown>>;
  const enabledProviders = Object.entries(providers)
    .filter(([, cfg]) => asBool(cfg?.enabled))
    .map(([name]) => name);

  return (
    <fieldset className="rounded-lg border p-3 space-y-3">
      <SectionHeader label="LLM" description="Model routing, providers, and escalation" />

      <div className="flex flex-wrap gap-2">
        <ReadOnlyBadge label="LLM" active={connected} />
        <ReadOnlyBadge label="Escalation" active={escalationEnabled} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <ReadOnlyField label="Default Model" value={defaultModel} />
        <ReadOnlyField label="Default Provider" value={defaultProvider} />
      </div>

      {enabledProviders.length > 0 && (
        <div>
          <label className="text-[10px] text-muted-foreground block mb-1">Active Providers</label>
          <div className="flex flex-wrap gap-1">
            {enabledProviders.map((name) => (
              <span key={name} className="inline-flex rounded-full border border-green-500/20 bg-green-500/10 px-2 py-0.5 text-[10px] font-mono text-green-700 dark:text-green-400">
                {name}
              </span>
            ))}
          </div>
        </div>
      )}

      {escalationEnabled && (
        <fieldset className="rounded-md border border-border/40 p-2 space-y-2">
          <legend className="text-[10px] font-medium px-1">Escalation</legend>
          <ReadOnlyField label="Quality Threshold" value={String(qualityThreshold)} />
          <p className="text-[10px] text-muted-foreground">
            Responses below this score trigger escalation to higher-tier models.
          </p>
        </fieldset>
      )}

      {rules.length > 0 && (
        <div>
          <label className="text-[10px] text-muted-foreground block mb-1">Routing Rules ({rules.length})</label>
          <div className="max-h-32 overflow-y-auto rounded-md border border-border/40 bg-muted/20 p-2 text-[10px] font-mono">
            {rules.map((rule: unknown, i: number) => {
              const r = rule as Record<string, unknown>;
              return (
                <div key={i} className="py-0.5 border-b border-border/20 last:border-0">
                  {asString(r.intent, '*')} → {asString(r.target as string, '?')} (pri: {asNumber(r.priority, 0)})
                </div>
              );
            })}
          </div>
        </div>
      )}
    </fieldset>
  );
};

/* ── GAIA ── */

const GaiaSection: FC<{ settings: DaemonSettingsData }> = ({ settings }) => {
  const gaia = (settings.gaia ?? {}) as Record<string, unknown>;
  const mode = asString(gaia.mode, 'not configured');
  const channels = (gaia.channels ?? {}) as Record<string, unknown>;
  const channelNames = Object.entries(channels)
    .filter(([, cfg]) => {
      if (typeof cfg === 'object' && cfg !== null) return asBool((cfg as Record<string, unknown>).enabled);
      return Boolean(cfg);
    })
    .map(([name]) => name);

  const sessionTtl = asNumber(gaia.session_ttl, 86400);

  if (mode === 'not configured' && channelNames.length === 0) return null;

  return (
    <fieldset className="rounded-lg border p-3 space-y-3">
      <SectionHeader label="GAIA" description="Cognitive coordination layer" />

      <div className="grid grid-cols-2 gap-3">
        <ReadOnlyField label="Mode" value={mode} />
        <ReadOnlyField label="Session TTL" value={`${sessionTtl}s`} />
      </div>

      {channelNames.length > 0 && (
        <div>
          <label className="text-[10px] text-muted-foreground block mb-1">Active Channels</label>
          <div className="flex flex-wrap gap-1">
            {channelNames.map((name) => (
              <span key={name} className="inline-flex rounded-full border px-2 py-0.5 text-[10px] font-mono">
                {name}
              </span>
            ))}
          </div>
        </div>
      )}
    </fieldset>
  );
};

/* ── API ── */

const ApiSection: FC<{ settings: DaemonSettingsData }> = ({ settings }) => {
  const api = (settings.api ?? {}) as Record<string, unknown>;
  const port = asNumber(api.port, 4567);
  const host = asString(api.host, '0.0.0.0');
  const rateLimit = dig(api, 'rate_limit');

  return (
    <fieldset className="rounded-lg border p-3 space-y-3">
      <SectionHeader label="API" description="Daemon REST API server" />
      <div className="grid grid-cols-3 gap-3">
        <ReadOnlyField label="Host" value={host} />
        <ReadOnlyField label="Port" value={String(port)} />
        <ReadOnlyField label="Rate Limit" value={rateLimit ? String(rateLimit) : 'none'} />
      </div>
    </fieldset>
  );
};

/* ── Enterprise Privacy ── */

const PrivacySection: FC<{ settings: DaemonSettingsData; onUpdate: (key: string, value: unknown) => void }> = ({ settings, onUpdate }) => {
  const privacyEnabled = asBool(settings.enterprise_data_privacy);

  return (
    <fieldset className="rounded-lg border border-amber-500/30 p-3 space-y-3">
      <SectionHeader label="Enterprise Data Privacy" description="When enabled, blocks all cloud LLM tiers. Only Tier 0 (cache) and Tier 1 (local Ollama) are permitted." />

      <Toggle
        label="Enable enterprise data privacy mode"
        checked={privacyEnabled}
        onChange={(v) => onUpdate('enterprise_data_privacy', v)}
      />

      {privacyEnabled && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2">
          <AlertTriangleIcon className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <p className="text-[10px] text-amber-700 dark:text-amber-300">
            Cloud providers (Anthropic, Bedrock, OpenAI, Gemini, Azure) are blocked. Only local Ollama and cached responses will work.
          </p>
        </div>
      )}
    </fieldset>
  );
};
