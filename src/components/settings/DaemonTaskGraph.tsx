import { useState, useEffect, useCallback, useRef, type FC } from 'react';
import { NetworkIcon, RefreshCwIcon, Loader2Icon, AlertCircleIcon, PlayIcon, PauseIcon } from 'lucide-react';
import type { SettingsProps } from './shared';
import { TaskGraphCanvas, type GraphNode } from './TaskGraphCanvas';
import { legion } from '@/lib/ipc-client';

const POLL_INTERVAL = 5000;

interface TaskDetail {
  id: string;
  status: string;
  runner?: string;
  function?: string;
  created_at?: string;
  updated_at?: string;
  args?: unknown;
  parent_id?: string | null;
  depends_on?: string[];
  result?: unknown;
  error?: string;
  duration_ms?: number;
}

export const DaemonTaskGraph: FC<SettingsProps> = () => {
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<TaskDetail | null>(null);
  const [live, setLive] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchGraph = useCallback(async () => {
    const filters: Record<string, string> = {};
    if (statusFilter !== 'all') filters.status = statusFilter;

    // Try the graph endpoint first, fall back to regular tasks
    let res = await legion.daemon.taskGraph(filters);
    if (!res.ok) {
      res = await legion.daemon.tasks(filters);
    }

    if (res.ok && res.data) {
      const raw = Array.isArray(res.data)
        ? res.data
        : (res.data as { tasks?: unknown[]; nodes?: unknown[] }).tasks
          || (res.data as { nodes?: unknown[] }).nodes
          || [];
      const graphNodes: GraphNode[] = (raw as TaskDetail[]).map((t) => ({
        id: t.id,
        label: t.function || t.runner || t.id.slice(0, 8),
        status: t.status || 'pending',
        runner: t.runner,
        function: t.function,
        created_at: t.created_at,
        parent_id: t.parent_id,
        depends_on: t.depends_on,
      }));
      setNodes(graphNodes);
      setError(null);
    } else {
      setError(res.error || 'Failed to fetch task graph');
    }
    setLoading(false);
  }, [statusFilter]);

  useEffect(() => { fetchGraph(); }, [fetchGraph]);

  useEffect(() => {
    if (live) {
      intervalRef.current = setInterval(fetchGraph, POLL_INTERVAL);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [live, fetchGraph]);

  // Fetch detail when selecting a node
  useEffect(() => {
    if (!selectedId) { setSelectedDetail(null); return; }
    legion.daemon.task(selectedId).then((res) => {
      if (res.ok && res.data) {
        setSelectedDetail(res.data as TaskDetail);
      }
    });
  }, [selectedId]);

  if (loading) return <div className="flex justify-center py-12"><Loader2Icon className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (error && nodes.length === 0) return (
    <div className="flex flex-col items-center gap-4 py-12">
      <AlertCircleIcon className="h-8 w-8 text-muted-foreground/40" />
      <p className="text-sm text-muted-foreground">{error}</p>
      <button type="button" onClick={fetchGraph} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Retry</button>
    </div>
  );

  const statusCounts = nodes.reduce<Record<string, number>>((acc, n) => {
    acc[n.status] = (acc[n.status] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <NetworkIcon className="h-5 w-5 text-primary" />
          <h3 className="text-sm font-semibold">Task Graph</h3>
          <span className="text-xs text-muted-foreground">{nodes.length} tasks</span>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-border/50 bg-card/50 px-2 py-1 text-xs text-foreground outline-none"
          >
            <option value="all">All statuses</option>
            <option value="pending">Pending</option>
            <option value="running">Running</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
          </select>
          <button type="button" onClick={() => setLive(!live)} className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${live ? 'bg-red-500/10 text-red-400' : 'bg-card/50 text-muted-foreground hover:text-foreground border border-border/50'}`}>
            {live ? <PauseIcon className="h-3 w-3" /> : <PlayIcon className="h-3 w-3" />}
            {live ? 'Stop' : 'Live'}
          </button>
          <button type="button" onClick={fetchGraph} className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted/50">
            <RefreshCwIcon className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Status summary */}
      <div className="flex gap-3">
        {Object.entries(statusCounts).map(([status, count]) => (
          <div key={status} className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${
              status === 'running' ? 'bg-blue-400' :
              status === 'completed' ? 'bg-emerald-400' :
              status === 'failed' ? 'bg-red-400' :
              status === 'pending' ? 'bg-amber-400' :
              'bg-gray-400'
            }`} />
            <span className="text-[10px] text-muted-foreground">{count} {status}</span>
          </div>
        ))}
      </div>

      {/* Graph canvas */}
      <TaskGraphCanvas nodes={nodes} selectedId={selectedId} onSelect={setSelectedId} />

      {/* Detail panel */}
      {selectedDetail && (
        <div className="rounded-lg border border-border/50 bg-card/30 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold">Task Detail</h4>
            <button type="button" onClick={() => setSelectedId(null)} className="text-[10px] text-muted-foreground hover:text-foreground">Close</button>
          </div>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <span className="text-[10px] text-muted-foreground block">ID</span>
              <span className="font-mono text-[10px] select-all break-all">{selectedDetail.id}</span>
            </div>
            <div>
              <span className="text-[10px] text-muted-foreground block">Status</span>
              <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${
                selectedDetail.status === 'completed' ? 'bg-emerald-500/10 text-emerald-400' :
                selectedDetail.status === 'running' ? 'bg-blue-500/10 text-blue-400' :
                selectedDetail.status === 'failed' ? 'bg-red-500/10 text-red-400' :
                'bg-amber-500/10 text-amber-400'
              }`}>{selectedDetail.status}</span>
            </div>
            {selectedDetail.runner && (
              <div>
                <span className="text-[10px] text-muted-foreground block">Runner</span>
                <span className="font-mono text-[10px]">{selectedDetail.runner}</span>
              </div>
            )}
            {selectedDetail.function && (
              <div>
                <span className="text-[10px] text-muted-foreground block">Function</span>
                <span className="font-mono text-[10px]">{selectedDetail.function}</span>
              </div>
            )}
            {selectedDetail.created_at && (
              <div>
                <span className="text-[10px] text-muted-foreground block">Created</span>
                <span className="text-[10px]">{new Date(selectedDetail.created_at).toLocaleString()}</span>
              </div>
            )}
            {selectedDetail.duration_ms != null && (
              <div>
                <span className="text-[10px] text-muted-foreground block">Duration</span>
                <span className="text-[10px]">{selectedDetail.duration_ms}ms</span>
              </div>
            )}
            {selectedDetail.parent_id && (
              <div>
                <span className="text-[10px] text-muted-foreground block">Parent</span>
                <span className="font-mono text-[10px]">{selectedDetail.parent_id.slice(0, 8)}...</span>
              </div>
            )}
            {selectedDetail.depends_on?.length ? (
              <div>
                <span className="text-[10px] text-muted-foreground block">Dependencies</span>
                <span className="text-[10px]">{selectedDetail.depends_on.length} tasks</span>
              </div>
            ) : null}
          </div>
          {selectedDetail.error && (
            <div>
              <span className="text-[10px] text-muted-foreground block">Error</span>
              <pre className="mt-1 max-h-20 overflow-auto rounded border border-red-500/20 bg-red-500/5 p-2 text-[10px] font-mono text-red-400">{selectedDetail.error}</pre>
            </div>
          )}
          {selectedDetail.args !== undefined && (
            <div>
              <span className="text-[10px] text-muted-foreground block">Args</span>
              <pre className="mt-1 max-h-24 overflow-auto rounded border border-border/30 bg-muted/20 p-2 text-[10px] font-mono">{JSON.stringify(selectedDetail.args, null, 2)}</pre>
            </div>
          )}
          {selectedDetail.result !== undefined && (
            <div>
              <span className="text-[10px] text-muted-foreground block">Result</span>
              <pre className="mt-1 max-h-24 overflow-auto rounded border border-border/30 bg-muted/20 p-2 text-[10px] font-mono">{JSON.stringify(selectedDetail.result, null, 2)}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
