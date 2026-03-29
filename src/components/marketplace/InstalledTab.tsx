import { useState, useEffect, useCallback, type FC } from 'react';
import { Loader2Icon, PuzzleIcon, RefreshCwIcon, TrashIcon, PlayIcon, PauseIcon, SettingsIcon, ChevronDownIcon, ChevronRightIcon } from 'lucide-react';
import { legion } from '@/lib/ipc-client';

interface Extension {
  name: string;
  namespace?: string;
  state?: string;
  version?: string;
  runners?: Array<{ name: string; functions?: string[] }>;
  mcp_tools?: Array<{ name: string; description?: string }>;
}

export const InstalledTab: FC = () => {
  const [extensions, setExtensions] = useState<Extension[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionInProgress, setActionInProgress] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [configData, setConfigData] = useState<Record<string, unknown> | null>(null);

  const fetchInstalled = useCallback(async () => {
    setLoading(true);
    const res = await legion.daemon.catalog();
    if (res.ok && res.data) {
      const data = Array.isArray(res.data) ? res.data : [];
      setExtensions(data as Extension[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchInstalled(); }, [fetchInstalled]);

  const withAction = async (name: string, fn: () => Promise<unknown>) => {
    setActionInProgress((prev) => new Set(prev).add(name));
    await fn();
    setActionInProgress((prev) => { const n = new Set(prev); n.delete(name); return n; });
    fetchInstalled();
  };

  const handleToggle = (ext: Extension) => {
    const isActive = ext.state === 'active' || ext.state === 'running';
    withAction(ext.name, () =>
      isActive ? legion.daemon.extensionDisable(ext.name) : legion.daemon.extensionEnable(ext.name)
    );
  };

  const handleUninstall = (ext: Extension) => {
    withAction(ext.name, () => legion.daemon.extensionUninstall(ext.name));
  };

  const handleExpand = async (ext: Extension) => {
    if (expanded === ext.name) {
      setExpanded(null);
      setConfigData(null);
      return;
    }
    setExpanded(ext.name);
    const res = await legion.daemon.extensionConfig(ext.name);
    if (res.ok && res.data) {
      setConfigData(res.data as Record<string, unknown>);
    } else {
      setConfigData(null);
    }
  };

  if (loading) return <div className="flex justify-center py-8"><Loader2Icon className="h-5 w-5 animate-spin text-muted-foreground" /></div>;

  const active = extensions.filter((e) => e.state === 'active' || e.state === 'running');

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{active.length} active / {extensions.length} total</span>
        <button type="button" onClick={fetchInstalled} className="rounded-md p-1 text-muted-foreground hover:bg-muted/50"><RefreshCwIcon className="h-3.5 w-3.5" /></button>
      </div>

      {extensions.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <PuzzleIcon className="h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">No extensions installed</p>
        </div>
      ) : (
        <div className="space-y-2">
          {extensions.map((ext) => {
            const isActive = ext.state === 'active' || ext.state === 'running';
            const busy = actionInProgress.has(ext.name);
            const isExpanded = expanded === ext.name;
            const runners = ext.runners ?? [];
            const tools = ext.mcp_tools ?? [];

            return (
              <div key={ext.name} className="rounded-lg border border-border/50 bg-card/30 overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-3">
                  <PuzzleIcon className={`h-4 w-4 shrink-0 ${isActive ? 'text-emerald-400' : 'text-gray-400'}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{ext.name}</span>
                      {ext.version && <span className="text-[10px] text-muted-foreground font-mono">v{ext.version}</span>}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[9px] font-medium ${isActive ? 'bg-emerald-500/10 text-emerald-400' : 'bg-gray-500/10 text-gray-400'}`}>
                        {ext.state || 'unknown'}
                      </span>
                      {runners.length > 0 && <span className="text-[10px] text-muted-foreground">{runners.length} runners</span>}
                      {tools.length > 0 && <span className="text-[10px] text-muted-foreground">{tools.length} tools</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleToggle(ext)}
                      disabled={busy}
                      className={`rounded-md p-1.5 transition-colors ${isActive ? 'text-amber-400 hover:bg-amber-500/10' : 'text-emerald-400 hover:bg-emerald-500/10'} disabled:opacity-50`}
                      title={isActive ? 'Disable' : 'Enable'}
                    >
                      {busy ? <Loader2Icon className="h-3.5 w-3.5 animate-spin" /> : isActive ? <PauseIcon className="h-3.5 w-3.5" /> : <PlayIcon className="h-3.5 w-3.5" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleExpand(ext)}
                      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted/50"
                      title="Details"
                    >
                      {isExpanded ? <ChevronDownIcon className="h-3.5 w-3.5" /> : <SettingsIcon className="h-3.5 w-3.5" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleUninstall(ext)}
                      disabled={busy}
                      className="rounded-md p-1.5 text-red-400 transition-colors hover:bg-red-500/10 disabled:opacity-50"
                      title="Uninstall"
                    >
                      <TrashIcon className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t border-border/30 px-4 py-3 space-y-3 text-xs">
                    {ext.namespace && (
                      <div>
                        <span className="text-[10px] text-muted-foreground block">Namespace</span>
                        <span className="font-mono text-[10px]">{ext.namespace}</span>
                      </div>
                    )}
                    {runners.length > 0 && (
                      <div>
                        <span className="text-[10px] text-muted-foreground block mb-1">Runners</span>
                        <div className="flex flex-wrap gap-1">
                          {runners.map((r) => (
                            <span key={r.name} className="rounded bg-muted/50 px-2 py-0.5 font-mono text-[10px]">{r.name}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    {tools.length > 0 && (
                      <div>
                        <span className="text-[10px] text-muted-foreground block mb-1">MCP Tools</span>
                        <div className="flex flex-wrap gap-1">
                          {tools.map((t) => (
                            <span key={t.name} className="rounded bg-primary/10 px-2 py-0.5 font-mono text-[10px] text-primary">{t.name}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    {configData && (
                      <div>
                        <span className="text-[10px] text-muted-foreground block mb-1">Configuration</span>
                        <pre className="max-h-32 overflow-auto rounded border border-border/30 bg-muted/20 p-2 text-[10px] font-mono">
                          {JSON.stringify(configData, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
