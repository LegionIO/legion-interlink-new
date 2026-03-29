import { useState, useEffect, useCallback, useRef, type FC } from 'react';
import {
  LinkIcon, PlayIcon, SearchIcon, Loader2Icon, CheckCircle2Icon,
  XCircleIcon, GlobeIcon, CircleIcon, RefreshCwIcon,
} from 'lucide-react';
import { legion } from '@/lib/ipc-client';

interface AbsorberPattern {
  type: string;
  value: string;
  priority?: number;
  absorber_class?: string;
  description?: string;
}

interface AbsorbJob {
  id: string;
  input: string;
  status: 'running' | 'completed' | 'failed';
  absorber?: string;
  error?: string;
  startedAt: number;
}

export const AbsorbTab: FC = () => {
  const [patterns, setPatterns] = useState<AbsorberPattern[]>([]);
  const [loading, setLoading] = useState(true);
  const [urlInput, setUrlInput] = useState('');
  const [scope, setScope] = useState<'global' | 'local'>('global');
  const [resolveResult, setResolveResult] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [jobs, setJobs] = useState<AbsorbJob[]>([]);
  const pollIntervalsRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());

  const loadPatterns = useCallback(async () => {
    setLoading(true);
    try {
      const res = await legion.daemon.absorbers();
      if (res.ok && Array.isArray(res.data)) {
        setPatterns(res.data as AbsorberPattern[]);
      }
    } catch { /* daemon unavailable */ }
    setLoading(false);
  }, []);

  useEffect(() => { void loadPatterns(); }, [loadPatterns]);

  useEffect(() => {
    const intervals = pollIntervalsRef.current;
    return () => {
      intervals.forEach((id) => clearInterval(id));
      intervals.clear();
    };
  }, []);

  const startPolling = useCallback((localId: string, jobId: string) => {
    const intervalId = setInterval(() => {
      void (async () => {
        try {
          const res = await legion.daemon.absorberJob(jobId);
          if (!res.ok) return;
          const d = res.data as { status?: string; absorber?: string; error?: string };
          const terminal = d.status === 'completed' || d.status === 'failed';
          setJobs((prev) =>
            prev.map((j) =>
              j.id === localId
                ? {
                    ...j,
                    id: jobId,
                    status: terminal ? (d.status as 'completed' | 'failed') : 'running',
                    absorber: d.absorber ?? j.absorber,
                    error: d.error,
                  }
                : j,
            ),
          );
          if (terminal) {
            clearInterval(intervalId);
            pollIntervalsRef.current.delete(localId);
          }
        } catch { /* daemon unavailable, keep polling */ }
      })();
    }, 2000);
    pollIntervalsRef.current.set(localId, intervalId);
  }, []);

  const handleResolve = async () => {
    if (!urlInput.trim()) return;
    setResolving(true);
    setResolveResult(null);
    try {
      const res = await legion.daemon.absorberResolve(urlInput.trim());
      if (res.ok && res.data) {
        const d = res.data as { absorber?: string; match?: boolean };
        setResolveResult(d.match ? `${d.absorber}` : 'No matching absorber');
      } else {
        setResolveResult(res.error || 'Resolve failed');
      }
    } catch (err) {
      setResolveResult(err instanceof Error ? err.message : 'Resolve failed');
    }
    setResolving(false);
  };

  const handleDispatch = async () => {
    if (!urlInput.trim()) return;
    setDispatching(true);
    const input = urlInput.trim();
    const jobId = `job-${Date.now()}`;
    setJobs((prev) => [{ id: jobId, input, status: 'running', startedAt: Date.now() }, ...prev]);

    try {
      const res = await legion.daemon.absorberDispatch(input, scope);
      if (res.ok && res.data) {
        const d = res.data as { job_id?: string; absorber?: string; success?: boolean; error?: string };
        if (d.job_id) {
          setJobs((prev) =>
            prev.map((j) =>
              j.id === jobId
                ? { ...j, absorber: d.absorber, status: 'running' }
                : j,
            ),
          );
          startPolling(jobId, d.job_id);
        } else {
          setJobs((prev) =>
            prev.map((j) =>
              j.id === jobId
                ? { ...j, id: d.job_id || j.id, status: d.success ? 'completed' : 'failed', absorber: d.absorber, error: d.error }
                : j,
            ),
          );
        }
      } else {
        setJobs((prev) =>
          prev.map((j) => (j.id === jobId ? { ...j, status: 'failed', error: res.error } : j)),
        );
      }
    } catch (err) {
      setJobs((prev) =>
        prev.map((j) =>
          j.id === jobId ? { ...j, status: 'failed', error: err instanceof Error ? err.message : 'Dispatch failed' } : j,
        ),
      );
    }
    setDispatching(false);
    setUrlInput('');
    setResolveResult(null);
  };

  return (
    <div className="p-6 space-y-6 max-w-3xl mx-auto">
      {/* URL Input */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Absorb Content</h2>
        <p className="text-xs text-muted-foreground">
          Paste a URL to absorb its content into the knowledge system. The daemon will match it against registered absorber patterns and dispatch the appropriate handler.
        </p>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              value={urlInput}
              onChange={(e) => { setUrlInput(e.target.value); setResolveResult(null); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && urlInput.trim()) void handleDispatch();
              }}
              placeholder="https://teams.microsoft.com/l/meetup-join/..."
              className="w-full rounded-lg border border-border/50 bg-background py-2 pl-9 pr-3 text-sm outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value as 'global' | 'local')}
            className="rounded-lg border border-border/50 bg-background px-2.5 py-2 text-xs outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="global">Global</option>
            <option value="local">Local</option>
          </select>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void handleResolve()}
            disabled={!urlInput.trim() || resolving}
            className="flex items-center gap-1.5 rounded-lg border border-border/50 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50 disabled:opacity-50"
          >
            {resolving ? <Loader2Icon className="h-3 w-3 animate-spin" /> : <SearchIcon className="h-3 w-3" />}
            Resolve
          </button>
          <button
            type="button"
            onClick={() => void handleDispatch()}
            disabled={!urlInput.trim() || dispatching}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {dispatching ? <Loader2Icon className="h-3 w-3 animate-spin" /> : <PlayIcon className="h-3 w-3" />}
            Absorb
          </button>
        </div>
        {resolveResult && (
          <div className="rounded-lg border border-border/30 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            <span className="font-medium">Resolve:</span> {resolveResult}
          </div>
        )}
      </div>

      {/* Recent Jobs */}
      {jobs.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground">Recent Jobs</h2>
          <div className="space-y-2">
            {jobs.slice(0, 10).map((job) => (
              <div
                key={job.id}
                className="flex items-start gap-3 rounded-lg border border-border/30 bg-card/50 px-3 py-2.5"
              >
                {job.status === 'running' && <Loader2Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-primary" />}
                {job.status === 'completed' && <CheckCircle2Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />}
                {job.status === 'failed' && <XCircleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" />}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-foreground">{job.input}</p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {job.absorber && <span>{job.absorber} &middot; </span>}
                    {job.status === 'running' && 'Processing...'}
                    {job.status === 'completed' && 'Done'}
                    {job.status === 'failed' && (job.error || 'Failed')}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Registered Patterns */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Registered Absorbers</h2>
          <button
            type="button"
            onClick={() => void loadPatterns()}
            disabled={loading}
            className="rounded-md p-1 transition-colors hover:bg-muted/50 disabled:opacity-50"
          >
            <RefreshCwIcon className={`h-3.5 w-3.5 text-muted-foreground ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {loading && patterns.length === 0 ? (
          <div className="flex justify-center py-8">
            <Loader2Icon className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : patterns.length === 0 ? (
          <div className="flex flex-col items-center py-8 text-muted-foreground">
            <GlobeIcon className="h-8 w-8 opacity-20 mb-2" />
            <p className="text-xs">No absorbers registered</p>
            <p className="text-[10px] opacity-60 mt-1">Absorbers are discovered from loaded LEX extensions</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {patterns.map((pat, idx) => {
              const extName = pat.absorber_class?.split('::')[2] || 'unknown';
              return (
                <div
                  key={`${pat.type}-${pat.value}-${idx}`}
                  className="flex items-start gap-3 rounded-lg border border-border/30 bg-card/40 px-3 py-2.5 transition-colors hover:bg-card/60"
                >
                  <div className="mt-0.5 rounded bg-primary/10 p-1">
                    <CircleIcon className="h-2.5 w-2.5 text-primary fill-current" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-mono text-foreground">{pat.value}</p>
                    <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
                      <span>Type: {pat.type}</span>
                      <span>Extension: {extName}</span>
                      {pat.priority != null && pat.priority !== 100 && <span>Priority: {pat.priority}</span>}
                    </div>
                    {pat.description && (
                      <p className="mt-1 text-[10px] text-muted-foreground/70">{pat.description}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
