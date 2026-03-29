import { useState, useEffect, useCallback, useRef, type FC } from 'react';
import {
  RefreshCwIcon,
  LoaderIcon,
  WifiOffIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  PlusIcon,
} from 'lucide-react';
import { settingsSelectClass, type SettingsProps } from './shared';
import { legion } from '@/lib/ipc-client';

type LoadState = 'idle' | 'loading' | 'loaded' | 'error';

interface Task {
  id: string;
  status: 'completed' | 'running' | 'failed' | 'pending' | string;
  runner: string;
  function: string;
  created_at: string;
}

interface TaskDetail extends Task {
  args?: unknown;
  logs?: string[];
}

const STATUS_BADGE: Record<string, string> = {
  completed: 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20',
  running:   'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20',
  failed:    'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20',
  pending:   'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/20',
};

const StatusBadge: FC<{ status: string }> = ({ status }) => (
  <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${STATUS_BADGE[status] ?? 'bg-muted/50 text-muted-foreground border-border/40'}`}>
    {status}
  </span>
);

/* ── Expanded row ── */

const ExpandedTask: FC<{ task: TaskDetail }> = ({ task }) => {
  const [logs, setLogs] = useState<string[] | null>(null);
  const [logsState, setLogsState] = useState<LoadState>('idle');

  useEffect(() => {
    setLogsState('loading');
    legion.daemon.taskLogs(task.id).then((res) => {
      if (res.ok) {
        const raw = res.data;
        setLogs(Array.isArray(raw) ? (raw as string[]) : typeof raw === 'string' ? [raw] : []);
        setLogsState('loaded');
      } else {
        setLogsState('error');
      }
    }).catch(() => setLogsState('error'));
  }, [task.id]);

  return (
    <div className="px-3 pb-3 pt-1 space-y-2 border-t border-border/30 bg-muted/10">
      <div>
        <span className="text-[10px] text-muted-foreground">Full ID</span>
        <p className="text-[10px] font-mono select-all break-all">{task.id}</p>
      </div>
      {task.args !== undefined && (
        <div>
          <span className="text-[10px] text-muted-foreground">Args</span>
          <pre className="mt-0.5 max-h-24 overflow-auto rounded-md border border-border/40 bg-muted/30 p-2 text-[10px] font-mono">
            {JSON.stringify(task.args, null, 2)}
          </pre>
        </div>
      )}
      <div>
        <span className="text-[10px] text-muted-foreground">Logs</span>
        {logsState === 'loading' && (
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground mt-1">
            <LoaderIcon className="h-3 w-3 animate-spin" /> Loading logs...
          </div>
        )}
        {logsState === 'error' && (
          <p className="text-[10px] text-destructive mt-1">Failed to load logs.</p>
        )}
        {logsState === 'loaded' && (
          <div className="mt-0.5 max-h-32 overflow-auto rounded-md border border-border/40 bg-muted/30 p-2 text-[10px] font-mono space-y-0.5">
            {logs && logs.length > 0 ? logs.map((line, i) => (
              <div key={i}>{line}</div>
            )) : <span className="text-muted-foreground italic">No logs.</span>}
          </div>
        )}
      </div>
    </div>
  );
};

/* ── Trigger form ── */

const TriggerForm: FC<{ onClose: () => void; onCreated: () => void }> = ({ onClose, onCreated }) => {
  const [runnerClass, setRunnerClass] = useState('');
  const [fn, setFn] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!runnerClass.trim() || !fn.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await legion.daemon.taskCreate({ runner_class: runnerClass.trim(), function: fn.trim() });
      if (res.ok) {
        onCreated();
        onClose();
      } else {
        setError(res.error || 'Failed to create task');
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border p-3 space-y-3 bg-card/60">
      <p className="text-xs font-semibold">Trigger Task</p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[10px] text-muted-foreground block mb-0.5">Runner Class</label>
          <input
            className="w-full rounded-xl border border-border/70 bg-card/80 px-3 py-2 text-xs outline-none"
            value={runnerClass}
            onChange={(e) => setRunnerClass(e.target.value)}
            placeholder="Lex::MyExt::Runners::MyRunner"
            required
          />
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground block mb-0.5">Function</label>
          <input
            className="w-full rounded-xl border border-border/70 bg-card/80 px-3 py-2 text-xs outline-none"
            value={fn}
            onChange={(e) => setFn(e.target.value)}
            placeholder="perform"
            required
          />
        </div>
      </div>
      {error && <p className="text-[10px] text-destructive">{error}</p>}
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs hover:bg-primary/20 transition-colors disabled:opacity-50"
        >
          {submitting ? <LoaderIcon className="h-3 w-3 animate-spin" /> : <PlusIcon className="h-3 w-3" />}
          Create
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border px-3 py-1.5 text-xs hover:bg-muted transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  );
};

/* ── Main component ── */

export const DaemonTasks: FC<SettingsProps> = ({ config }) => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [loadError, setLoadError] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedData, setExpandedData] = useState<Record<string, TaskDetail>>({});
  const [statusFilter, setStatusFilter] = useState('all');
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [showTrigger, setShowTrigger] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const daemonUrl = (config.runtime as { legion?: { daemonUrl?: string } })?.legion?.daemonUrl || 'http://127.0.0.1:4567';

  const fetchTasks = useCallback(async () => {
    setLoadState((s) => s === 'idle' ? 'loading' : s === 'loaded' ? 'loaded' : 'loading');
    setLoadError('');
    try {
      const filters = statusFilter !== 'all' ? { status: statusFilter } : undefined;
      const res = await legion.daemon.tasks(filters);
      if (res.ok) {
        setTasks(Array.isArray(res.data) ? (res.data as Task[]) : []);
        setLoadState('loaded');
      } else {
        setLoadError(res.error || 'Failed to fetch tasks');
        setLoadState('error');
      }
    } catch (err) {
      setLoadError(String(err));
      setLoadState('error');
    }
  }, [statusFilter]);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(fetchTasks, 5000);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [autoRefresh, fetchTasks]);

  const toggleExpand = useCallback(async (task: Task) => {
    if (expandedId === task.id) { setExpandedId(null); return; }
    setExpandedId(task.id);
    if (!expandedData[task.id]) {
      try {
        const res = await legion.daemon.task(task.id);
        if (res.ok && res.data) {
          setExpandedData((prev) => ({ ...prev, [task.id]: res.data as TaskDetail }));
        } else {
          setExpandedData((prev) => ({ ...prev, [task.id]: task }));
        }
      } catch {
        setExpandedData((prev) => ({ ...prev, [task.id]: task }));
      }
    }
  }, [expandedId, expandedData]);

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
        <h3 className="text-sm font-semibold">Daemon Tasks</h3>
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
            onClick={fetchTasks}
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
        <h3 className="text-sm font-semibold">Daemon Tasks</h3>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded"
            />
            Auto-refresh
          </label>
          <button
            type="button"
            onClick={fetchTasks}
            className="flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] hover:bg-muted transition-colors"
          >
            <RefreshCwIcon className="h-3 w-3" />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => setShowTrigger((v) => !v)}
            className="flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] hover:bg-muted transition-colors"
          >
            <PlusIcon className="h-3 w-3" />
            Trigger
          </button>
        </div>
      </div>

      {showTrigger && (
        <TriggerForm onClose={() => setShowTrigger(false)} onCreated={fetchTasks} />
      )}

      <div className="flex items-center gap-2">
        <label className="text-[10px] text-muted-foreground shrink-0">Filter by status</label>
        <select
          className={settingsSelectClass}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="all">All</option>
          <option value="pending">Pending</option>
          <option value="running">Running</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
        </select>
      </div>

      {tasks.length === 0 ? (
        <p className="text-[10px] text-muted-foreground italic py-4 text-center">No tasks found.</p>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <div className="grid grid-cols-[1.5rem_1fr_6rem_1fr_1fr_7rem] gap-x-2 px-3 py-1.5 bg-muted/40 border-b border-border/40 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
            <span />
            <span>ID</span>
            <span>Status</span>
            <span>Runner</span>
            <span>Function</span>
            <span>Created</span>
          </div>
          <div className="max-h-[420px] overflow-y-auto divide-y divide-border/30">
            {tasks.map((task) => (
              <div key={task.id}>
                <button
                  type="button"
                  onClick={() => toggleExpand(task)}
                  className="w-full grid grid-cols-[1.5rem_1fr_6rem_1fr_1fr_7rem] gap-x-2 px-3 py-2 text-left hover:bg-muted/30 transition-colors items-center"
                >
                  <span className="text-muted-foreground">
                    {expandedId === task.id
                      ? <ChevronDownIcon className="h-3 w-3" />
                      : <ChevronRightIcon className="h-3 w-3" />}
                  </span>
                  <span className="text-[10px] font-mono truncate" title={task.id}>
                    {task.id.slice(0, 8)}…
                  </span>
                  <span><StatusBadge status={task.status} /></span>
                  <span className="text-[10px] truncate">{task.runner}</span>
                  <span className="text-[10px] truncate">{task.function}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {task.created_at ? new Date(task.created_at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                  </span>
                </button>
                {expandedId === task.id && expandedData[task.id] && (
                  <ExpandedTask task={expandedData[task.id]} />
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
