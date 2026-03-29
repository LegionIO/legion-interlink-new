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
} from 'lucide-react';
import { type SettingsProps } from './shared';
import { legion } from '@/lib/ipc-client';

type LoadState = 'idle' | 'loading' | 'loaded' | 'error';

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

export const DaemonExtensions: FC<SettingsProps> = ({ config }) => {
  const [extensions, setExtensions] = useState<Extension[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [loadError, setLoadError] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

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

  useEffect(() => {
    fetchCatalog();
  }, [fetchCatalog]);

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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Extensions</h3>
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-muted-foreground">
            {active.length} active / {extensions.length} total
          </span>
          <button
            type="button"
            onClick={fetchCatalog}
            className="flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] hover:bg-muted transition-colors"
          >
            <RefreshCwIcon className="h-3 w-3" />
            Refresh
          </button>
        </div>
      </div>

      {extensions.length === 0 && (
        <p className="text-xs text-muted-foreground text-center py-6">No extensions loaded.</p>
      )}

      <div className="space-y-2">
        {extensions.map((ext) => (
          <ExtensionCard
            key={ext.name}
            ext={ext}
            isExpanded={expanded.has(ext.name)}
            onToggle={() => toggleExpanded(ext.name)}
          />
        ))}
      </div>
    </div>
  );
};

/* ── Extension card ── */

const ExtensionCard: FC<{ ext: Extension; isExpanded: boolean; onToggle: () => void }> = ({
  ext,
  isExpanded,
  onToggle,
}) => {
  const isActive = ext.state === 'active' || ext.state === 'running';
  const runners = ext.runners ?? [];
  const mcpTools = ext.mcp_tools ?? [];
  const sandboxKeys = ext.sandbox ? Object.keys(ext.sandbox) : [];
  const hasDetails = runners.length > 0 || mcpTools.length > 0 || sandboxKeys.length > 0;

  return (
    <div className="rounded-lg border overflow-hidden">
      <button
        type="button"
        onClick={hasDetails ? onToggle : undefined}
        className={`w-full flex items-center gap-3 px-3 py-2.5 text-left ${hasDetails ? 'hover:bg-muted/40 cursor-pointer' : 'cursor-default'} transition-colors`}
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
