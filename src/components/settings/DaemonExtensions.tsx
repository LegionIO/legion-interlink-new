import { useState, useEffect, useCallback, type FC } from 'react';
import {
  RefreshCwIcon,
  LoaderIcon,
  WifiOffIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  PuzzleIcon,
  WrenchIcon,
  ShieldIcon,
  SearchIcon,
  DownloadIcon,
  TrashIcon,
  PowerIcon,
} from 'lucide-react';
import { type SettingsProps } from './shared';
import { legion } from '@/lib/ipc-client';

type LoadState = 'idle' | 'loading' | 'loaded' | 'error';
type Tab = 'installed' | 'available';

type RunnerMethod = {
  name: string;
  description?: string;
};

type Runner = {
  name: string;
  methods?: RunnerMethod[];
  functions?: string[];
};

type McpTool = {
  name: string;
  description?: string;
};

type Extension = {
  name: string;
  namespace?: string;
  state?: string;
  version?: string;
  runners?: Runner[];
  mcp_tools?: McpTool[];
  sandbox?: Record<string, unknown>;
};

type MarketplaceExtension = {
  id: string;
  name: string;
  description?: string;
  version?: string;
  author?: string;
  tags?: string[];
};

export const DaemonExtensions: FC<SettingsProps> = ({ config }) => {
  const [extensions, setExtensions] = useState<Extension[]>([]);
  const [marketplace, setMarketplace] = useState<MarketplaceExtension[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [marketplaceLoadState, setMarketplaceLoadState] = useState<LoadState>('idle');
  const [loadError, setLoadError] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<Tab>('installed');
  const [search, setSearch] = useState('');
  const [actionInFlight, setActionInFlight] = useState<Set<string>>(new Set());
  const [confirmUninstall, setConfirmUninstall] = useState<string | null>(null);
  const [installingId, setInstallingId] = useState<string | null>(null);

  const daemonUrl = (config.runtime as { legion?: { daemonUrl?: string } })?.legion?.daemonUrl || 'http://127.0.0.1:4567';

  const fetchCatalog = useCallback(async () => {
    setLoadState('loading');
    setLoadError('');
    try {
      const result = await legion.daemon.catalog();
      if (result.ok && result.data) {
        setExtensions(result.data as Extension[]);
        setLoadState('loaded');
      } else {
        setLoadError(result.error || 'Failed to fetch extension catalog');
        setLoadState('error');
      }
    } catch (err) {
      setLoadError(String(err));
      setLoadState('error');
    }
  }, []);

  const fetchMarketplace = useCallback(async () => {
    setMarketplaceLoadState('loading');
    try {
      const result = await legion.daemon.marketplace();
      if (result.ok && result.data) {
        setMarketplace(result.data as MarketplaceExtension[]);
        setMarketplaceLoadState('loaded');
      } else {
        setMarketplaceLoadState('error');
      }
    } catch {
      setMarketplaceLoadState('error');
    }
  }, []);

  useEffect(() => {
    fetchCatalog();
  }, [fetchCatalog]);

  useEffect(() => {
    if (tab === 'available' && marketplaceLoadState === 'idle') {
      fetchMarketplace();
    }
  }, [tab, marketplaceLoadState, fetchMarketplace]);

  const toggleExpanded = (name: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  };

  const setInFlight = (id: string, on: boolean) => {
    setActionInFlight((prev) => {
      const next = new Set(prev);
      if (on) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  };

  const handleToggleEnabled = async (ext: Extension) => {
    const id = ext.name;
    if (actionInFlight.has(id)) return;
    setInFlight(id, true);
    try {
      const isActive = ext.state === 'active' || ext.state === 'running';
      if (isActive) {
        await legion.daemon.extensionDisable(id);
      } else {
        await legion.daemon.extensionEnable(id);
      }
      await fetchCatalog();
    } finally {
      setInFlight(id, false);
    }
  };

  const handleUninstall = async (name: string) => {
    if (actionInFlight.has(name)) return;
    setInFlight(name, true);
    setConfirmUninstall(null);
    try {
      await legion.daemon.extensionUninstall(name);
      await fetchCatalog();
    } finally {
      setInFlight(name, false);
    }
  };

  const handleInstall = async (id: string) => {
    if (installingId) return;
    setInstallingId(id);
    try {
      await legion.daemon.extensionInstall(id);
      await fetchCatalog();
      // Refresh marketplace to reflect updated install state
      setMarketplaceLoadState('idle');
    } finally {
      setInstallingId(null);
    }
  };

  const q = search.trim().toLowerCase();

  const filteredExtensions = q
    ? extensions.filter((e) => e.name.toLowerCase().includes(q) || e.namespace?.toLowerCase().includes(q))
    : extensions;

  const installedNames = new Set(extensions.map((e) => e.name.toLowerCase()));

  const filteredMarketplace = marketplace.filter((m) => {
    if (q && !m.name.toLowerCase().includes(q) && !m.description?.toLowerCase().includes(q)) return false;
    return true;
  });

  if (loadState === 'idle' || loadState === 'loading') {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-8 justify-center">
        <LoaderIcon className="h-4 w-4 animate-spin" />
        Loading extensions from {daemonUrl}...
      </div>
    );
  }

  if (loadState === 'error') {
    return (
      <div className="space-y-4">
        <h3 className="text-sm font-semibold">Extensions</h3>
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
            onClick={fetchCatalog}
            className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs hover:bg-muted transition-colors"
          >
            <RefreshCwIcon className="h-3 w-3" />
            Retry
          </button>
        </div>
      </div>
    );
  }

  const active = extensions.filter((e) => e.state === 'active' || e.state === 'running');

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Extensions</h3>
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-muted-foreground">
            {active.length} active / {extensions.length} total
          </span>
          <button
            type="button"
            onClick={() => { fetchCatalog(); if (tab === 'available') setMarketplaceLoadState('idle'); }}
            className="flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] hover:bg-muted transition-colors"
          >
            <RefreshCwIcon className="h-3 w-3" />
            Refresh
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
        <input
          type="text"
          placeholder="Filter extensions..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-md border bg-transparent pl-8 pr-3 py-1.5 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 rounded-md border p-0.5 bg-muted/30 w-fit">
        <button
          type="button"
          onClick={() => setTab('installed')}
          className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
            tab === 'installed'
              ? 'bg-background shadow-sm text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Installed
        </button>
        <button
          type="button"
          onClick={() => setTab('available')}
          className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
            tab === 'available'
              ? 'bg-background shadow-sm text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Available
        </button>
      </div>

      {/* Installed tab */}
      {tab === 'installed' && (
        <div className="space-y-2">
          {filteredExtensions.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-6">
              {q ? 'No extensions match your search.' : 'No extensions loaded.'}
            </p>
          )}
          {filteredExtensions.map((ext) => (
            <ExtensionCard
              key={ext.name}
              ext={ext}
              isExpanded={expanded.has(ext.name)}
              onToggle={() => toggleExpanded(ext.name)}
              inFlight={actionInFlight.has(ext.name)}
              confirmingUninstall={confirmUninstall === ext.name}
              onToggleEnabled={() => handleToggleEnabled(ext)}
              onRequestUninstall={() => setConfirmUninstall(ext.name)}
              onCancelUninstall={() => setConfirmUninstall(null)}
              onConfirmUninstall={() => handleUninstall(ext.name)}
            />
          ))}
        </div>
      )}

      {/* Available tab */}
      {tab === 'available' && (
        <div className="space-y-2">
          {(marketplaceLoadState === 'idle' || marketplaceLoadState === 'loading') && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-6 justify-center">
              <LoaderIcon className="h-4 w-4 animate-spin" />
              Loading marketplace...
            </div>
          )}
          {marketplaceLoadState === 'error' && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 flex items-center gap-2">
              <WifiOffIcon className="h-4 w-4 text-destructive shrink-0" />
              <p className="text-xs text-destructive">Failed to load marketplace.</p>
              <button
                type="button"
                onClick={fetchMarketplace}
                className="ml-auto flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] hover:bg-muted transition-colors"
              >
                <RefreshCwIcon className="h-3 w-3" />
                Retry
              </button>
            </div>
          )}
          {marketplaceLoadState === 'loaded' && filteredMarketplace.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-6">
              {q ? 'No extensions match your search.' : 'No extensions available in marketplace.'}
            </p>
          )}
          {marketplaceLoadState === 'loaded' && filteredMarketplace.map((item) => (
            <MarketplaceCard
              key={item.id}
              item={item}
              alreadyInstalled={installedNames.has(item.name.toLowerCase())}
              installing={installingId === item.id}
              onInstall={() => handleInstall(item.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

/* ── Extension card (installed) ── */

type ExtensionCardProps = {
  ext: Extension;
  isExpanded: boolean;
  onToggle: () => void;
  inFlight: boolean;
  confirmingUninstall: boolean;
  onToggleEnabled: () => void;
  onRequestUninstall: () => void;
  onCancelUninstall: () => void;
  onConfirmUninstall: () => void;
};

const ExtensionCard: FC<ExtensionCardProps> = ({
  ext,
  isExpanded,
  onToggle,
  inFlight,
  confirmingUninstall,
  onToggleEnabled,
  onRequestUninstall,
  onCancelUninstall,
  onConfirmUninstall,
}) => {
  const isActive = ext.state === 'active' || ext.state === 'running';
  const runners = ext.runners ?? [];
  const mcpTools = ext.mcp_tools ?? [];
  const sandboxKeys = ext.sandbox ? Object.keys(ext.sandbox) : [];
  const hasDetails = runners.length > 0 || mcpTools.length > 0 || sandboxKeys.length > 0;

  return (
    <div className="rounded-lg border overflow-hidden">
      {/* Main row */}
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button
          type="button"
          onClick={hasDetails ? onToggle : undefined}
          className={`flex items-center gap-3 flex-1 min-w-0 text-left ${hasDetails ? 'hover:text-foreground cursor-pointer' : 'cursor-default'} transition-colors`}
        >
          <PuzzleIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium truncate">{ext.name}</span>
              {ext.version && (
                <span className="text-[10px] text-muted-foreground font-mono shrink-0">v{ext.version}</span>
              )}
            </div>
            {ext.namespace && ext.namespace !== ext.name && (
              <p className="text-[10px] text-muted-foreground font-mono truncate">{ext.namespace}</p>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <StateBadge active={isActive} label={ext.state || 'unknown'} />
            {hasDetails && (
              isExpanded
                ? <ChevronDownIcon className="h-3.5 w-3.5 text-muted-foreground" />
                : <ChevronRightIcon className="h-3.5 w-3.5 text-muted-foreground" />
            )}
          </div>
        </button>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0 ml-1">
          {confirmingUninstall ? (
            <>
              <span className="text-[10px] text-destructive mr-1">Remove?</span>
              <button
                type="button"
                onClick={onConfirmUninstall}
                disabled={inFlight}
                className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-[10px] text-destructive hover:bg-destructive/20 transition-colors disabled:opacity-50"
              >
                Yes
              </button>
              <button
                type="button"
                onClick={onCancelUninstall}
                className="rounded-md border px-2 py-1 text-[10px] hover:bg-muted transition-colors"
              >
                No
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={onToggleEnabled}
                disabled={inFlight}
                title={isActive ? 'Disable' : 'Enable'}
                className={`rounded-md border p-1 transition-colors disabled:opacity-50 ${
                  isActive
                    ? 'border-green-500/30 text-green-600 hover:bg-green-500/10'
                    : 'text-muted-foreground hover:bg-muted'
                }`}
              >
                {inFlight
                  ? <LoaderIcon className="h-3 w-3 animate-spin" />
                  : <PowerIcon className="h-3 w-3" />
                }
              </button>
              <button
                type="button"
                onClick={onRequestUninstall}
                disabled={inFlight}
                title="Uninstall"
                className="rounded-md border p-1 text-muted-foreground hover:text-destructive hover:border-destructive/40 hover:bg-destructive/10 transition-colors disabled:opacity-50"
              >
                <TrashIcon className="h-3 w-3" />
              </button>
            </>
          )}
        </div>
      </div>

      {isExpanded && hasDetails && (
        <div className="border-t bg-muted/10 px-3 py-3 space-y-3">
          {runners.length > 0 && <RunnersSection runners={runners} />}
          {mcpTools.length > 0 && <McpToolsSection tools={mcpTools} />}
          {sandboxKeys.length > 0 && <SandboxSection sandbox={ext.sandbox!} />}
        </div>
      )}
    </div>
  );
};

/* ── Marketplace card (available) ── */

type MarketplaceCardProps = {
  item: MarketplaceExtension;
  alreadyInstalled: boolean;
  installing: boolean;
  onInstall: () => void;
};

const MarketplaceCard: FC<MarketplaceCardProps> = ({ item, alreadyInstalled, installing, onInstall }) => (
  <div className="rounded-lg border px-3 py-2.5 flex items-start gap-3">
    <PuzzleIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />

    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium truncate">{item.name}</span>
        {item.version && (
          <span className="text-[10px] text-muted-foreground font-mono shrink-0">v{item.version}</span>
        )}
        {item.author && (
          <span className="text-[10px] text-muted-foreground shrink-0">by {item.author}</span>
        )}
      </div>
      {item.description && (
        <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">{item.description}</p>
      )}
      {item.tags && item.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {item.tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex rounded-full border border-border/40 bg-muted/40 px-1.5 py-0.5 text-[10px] font-mono"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>

    <div className="shrink-0 ml-1">
      {alreadyInstalled ? (
        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium border bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20">
          Installed
        </span>
      ) : (
        <button
          type="button"
          onClick={onInstall}
          disabled={installing}
          className="flex items-center gap-1 rounded-md border px-2.5 py-1 text-[10px] hover:bg-muted transition-colors disabled:opacity-50"
        >
          {installing
            ? <LoaderIcon className="h-3 w-3 animate-spin" />
            : <DownloadIcon className="h-3 w-3" />
          }
          {installing ? 'Installing...' : 'Install'}
        </button>
      )}
    </div>
  </div>
);

/* ── State badge ── */

const StateBadge: FC<{ active: boolean; label: string }> = ({ active, label }) => (
  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium border ${
    active
      ? 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20'
      : 'bg-muted/50 text-muted-foreground border-border/40'
  }`}>
    {label}
  </span>
);

/* ── Runners ── */

const RunnersSection: FC<{ runners: Runner[] }> = ({ runners }) => (
  <div>
    <div className="flex items-center gap-1.5 mb-1.5">
      <WrenchIcon className="h-3 w-3 text-muted-foreground" />
      <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
        Runners ({runners.length})
      </span>
    </div>
    <div className="space-y-1.5">
      {runners.map((runner) => {
        const fns = runner.functions ?? runner.methods?.map((m) => m.name) ?? [];
        return (
          <div key={runner.name} className="rounded-md border border-border/40 bg-card/60 px-2.5 py-2">
            <p className="text-xs font-medium font-mono">{runner.name}</p>
            {fns.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {fns.map((fn) => (
                  <span key={fn} className="inline-flex rounded-md border border-border/40 bg-muted/40 px-1.5 py-0.5 text-[10px] font-mono">
                    {fn}
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  </div>
);

/* ── MCP tools ── */

const McpToolsSection: FC<{ tools: McpTool[] }> = ({ tools }) => (
  <div>
    <div className="flex items-center gap-1.5 mb-1.5">
      <WrenchIcon className="h-3 w-3 text-muted-foreground" />
      <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
        MCP Tools ({tools.length})
      </span>
    </div>
    <div className="space-y-1">
      {tools.map((tool) => (
        <div key={tool.name} className="rounded-md border border-border/40 bg-card/60 px-2.5 py-1.5">
          <p className="text-xs font-mono">{tool.name}</p>
          {tool.description && (
            <p className="text-[10px] text-muted-foreground mt-0.5">{tool.description}</p>
          )}
        </div>
      ))}
    </div>
  </div>
);

/* ── Sandbox permissions ── */

const SandboxSection: FC<{ sandbox: Record<string, unknown> }> = ({ sandbox }) => (
  <div>
    <div className="flex items-center gap-1.5 mb-1.5">
      <ShieldIcon className="h-3 w-3 text-muted-foreground" />
      <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
        Sandbox Permissions
      </span>
    </div>
    <div className="flex flex-wrap gap-1">
      {Object.entries(sandbox).map(([key, val]) => (
        <span
          key={key}
          className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-mono border ${
            val
              ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20'
              : 'bg-muted/50 text-muted-foreground border-border/40'
          }`}
        >
          {key}
        </span>
      ))}
    </div>
  </div>
);
