import { useState, useEffect, useCallback, type FC } from 'react';
import {
  RefreshCwIcon,
  LoaderIcon,
  WifiOffIcon,
  PlayIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  XIcon,
} from 'lucide-react';
import { type SettingsProps } from './shared';
import { legion } from '@/lib/ipc-client';

type LoadState = 'idle' | 'loading' | 'loaded' | 'error';
type RunState = 'idle' | 'running' | 'done' | 'error';

interface Prompt {
  name: string;
  description?: string;
  template?: string;
  variables?: string[];
  [key: string]: unknown;
}

interface RunForm {
  promptName: string;
  vars: { key: string; value: string }[];
  model: string;
}

export const DaemonPrompts: FC<SettingsProps> = () => {
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [loadError, setLoadError] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [runForm, setRunForm] = useState<RunForm | null>(null);
  const [runState, setRunState] = useState<RunState>('idle');
  const [runResult, setRunResult] = useState('');

  const fetchPrompts = useCallback(async () => {
    setLoadState('loading');
    setLoadError('');
    try {
      const result = await legion.daemon.prompts();
      if (result.ok && Array.isArray(result.data)) {
        setPrompts(result.data as Prompt[]);
        setLoadState('loaded');
      } else {
        setLoadError(result.error || 'Failed to fetch prompts');
        setLoadState('error');
      }
    } catch (err) {
      setLoadError(String(err));
      setLoadState('error');
    }
  }, []);

  useEffect(() => {
    fetchPrompts();
  }, [fetchPrompts]);

  const toggleExpand = (name: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  const openRunForm = (prompt: Prompt) => {
    const vars = (prompt.variables ?? []).map((k) => ({ key: k, value: '' }));
    setRunForm({ promptName: prompt.name, vars, model: '' });
    setRunState('idle');
    setRunResult('');
  };

  const closeRunForm = () => {
    setRunForm(null);
    setRunState('idle');
    setRunResult('');
  };

  const submitRun = async () => {
    if (!runForm) return;
    setRunState('running');
    setRunResult('');
    const body: Record<string, unknown> = {};
    for (const { key, value } of runForm.vars) {
      if (key) body[key] = value;
    }
    if (runForm.model) body['model'] = runForm.model;
    try {
      const result = await legion.daemon.promptRun(runForm.promptName, body);
      if (result.ok) {
        setRunState('done');
        setRunResult(typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2));
      } else {
        setRunState('error');
        setRunResult(result.error || 'Run failed');
      }
    } catch (err) {
      setRunState('error');
      setRunResult(String(err));
    }
  };

  if (loadState === 'idle' || loadState === 'loading') {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-8 justify-center">
        <LoaderIcon className="h-4 w-4 animate-spin" />
        Loading prompts...
      </div>
    );
  }

  if (loadState === 'error') {
    return (
      <div className="space-y-4">
        <h3 className="text-sm font-semibold">Prompts</h3>
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 space-y-3">
          <div className="flex items-start gap-2">
            <WifiOffIcon className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-medium text-destructive">Failed to load prompts</p>
              <p className="text-[10px] text-muted-foreground mt-1">{loadError}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={fetchPrompts}
            className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs hover:bg-muted transition-colors"
          >
            <RefreshCwIcon className="h-3 w-3" />
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Prompts</h3>
        <button
          type="button"
          onClick={fetchPrompts}
          className="flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] hover:bg-muted transition-colors"
        >
          <RefreshCwIcon className="h-3 w-3" />
          Refresh
        </button>
      </div>

      {runForm && (
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold">Run: <span className="font-mono">{runForm.promptName}</span></p>
            <button type="button" onClick={closeRunForm} className="text-muted-foreground hover:text-foreground">
              <XIcon className="h-3.5 w-3.5" />
            </button>
          </div>

          {runForm.vars.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] text-muted-foreground">Variables</p>
              {runForm.vars.map((v, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-32 shrink-0 text-[10px] font-mono text-muted-foreground">{v.key}</span>
                  <input
                    type="text"
                    value={v.value}
                    onChange={(e) => {
                      const next = [...runForm.vars];
                      next[i] = { ...next[i], value: e.target.value };
                      setRunForm({ ...runForm, vars: next });
                    }}
                    placeholder="value"
                    className="flex-1 rounded-md border border-border/50 bg-background px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
              ))}
            </div>
          )}

          <div>
            <label className="text-[10px] text-muted-foreground block mb-0.5">Model override (optional)</label>
            <input
              type="text"
              value={runForm.model}
              onChange={(e) => setRunForm({ ...runForm, model: e.target.value })}
              placeholder="e.g. claude-3-5-haiku-latest"
              className="w-full rounded-md border border-border/50 bg-background px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={submitRun}
              disabled={runState === 'running'}
              className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs hover:bg-muted transition-colors disabled:opacity-50"
            >
              {runState === 'running' ? (
                <LoaderIcon className="h-3 w-3 animate-spin" />
              ) : (
                <PlayIcon className="h-3 w-3" />
              )}
              {runState === 'running' ? 'Running...' : 'Run'}
            </button>
          </div>

          {runResult && (
            <div
              className={`rounded-md border p-2 text-[10px] font-mono whitespace-pre-wrap max-h-40 overflow-y-auto ${
                runState === 'error'
                  ? 'border-destructive/30 bg-destructive/5 text-destructive'
                  : 'border-border/40 bg-muted/20'
              }`}
            >
              {runResult}
            </div>
          )}
        </div>
      )}

      {prompts.length === 0 ? (
        <p className="text-xs text-muted-foreground italic py-4 text-center">No prompts configured.</p>
      ) : (
        <div className="space-y-1">
          {prompts.map((p) => {
            const isOpen = expanded.has(p.name);
            return (
              <div key={p.name} className="rounded-lg border border-border/50">
                <div className="flex items-center gap-2 px-3 py-2">
                  <button
                    type="button"
                    onClick={() => toggleExpand(p.name)}
                    className="flex flex-1 items-center gap-2 text-left hover:opacity-80 transition-opacity"
                  >
                    {isOpen ? (
                      <ChevronDownIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRightIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    )}
                    <span className="flex-1 text-xs font-mono">{p.name}</span>
                    {p.description && (
                      <span className="text-[10px] text-muted-foreground truncate max-w-[200px]">
                        {p.description}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => openRunForm(p)}
                    className="flex items-center gap-1 rounded-md border border-border/50 px-2 py-0.5 text-[10px] hover:bg-muted transition-colors"
                  >
                    <PlayIcon className="h-3 w-3" />
                    Run
                  </button>
                </div>
                {isOpen && p.template && (
                  <div className="border-t border-border/30 px-4 py-2 bg-muted/10 rounded-b-lg">
                    <p className="text-[10px] text-muted-foreground mb-1">Template</p>
                    <pre className="text-[10px] font-mono whitespace-pre-wrap text-foreground/80 max-h-40 overflow-y-auto">
                      {p.template}
                    </pre>
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
