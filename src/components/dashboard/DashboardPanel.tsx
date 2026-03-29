import { useState, useEffect, useCallback, type FC } from 'react';
import {
  ActivityIcon, CpuIcon, LayersIcon, ZapIcon, DollarSignIcon,
  CheckCircle2Icon, AlertCircleIcon, AlertTriangleIcon, Loader2Icon,
  RefreshCwIcon, BrainIcon, NetworkIcon, ClockIcon,
} from 'lucide-react';
import { legion } from '@/lib/ipc-client';
import { useNotifications } from '@/providers/NotificationProvider';

interface HealthData {
  status?: string;
  uptime?: number;
  version?: string;
  mode?: string;
}

interface TaskSummary {
  total: number;
  running: number;
  completed: number;
  failed: number;
}

interface WorkerSummary {
  total: number;
  healthy: number;
  degraded: number;
}

interface GaiaSnap {
  mode?: string;
  tick_count?: number;
  active_phases?: number;
}

interface CostSnap {
  total_cost_usd?: number;
  total_tokens?: number;
  total_requests?: number;
}

function fmtUptime(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
  return `${Math.floor(sec / 86400)}d ${Math.floor((sec % 86400) / 3600)}h`;
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

const StatusDot: FC<{ status: string }> = ({ status }) => {
  const color = status === 'pass' || status === 'healthy' || status === 'ok' || status === 'ready'
    ? 'bg-emerald-400' : status === 'warn' || status === 'degraded'
    ? 'bg-amber-400' : 'bg-red-400';
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} />;
};

const StatCard: FC<{ icon: FC<{ className?: string }>; label: string; value: string; sub?: string; accent?: string }> = ({ icon: Icon, label, value, sub, accent }) => (
  <div className="rounded-xl border border-border/40 bg-card/60 p-4 transition-colors hover:bg-card/80">
    <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
      <Icon className={`h-3.5 w-3.5 ${accent || ''}`} />
      {label}
    </div>
    <p className="mt-1.5 text-xl font-bold tracking-tight">{value}</p>
    {sub && <p className="mt-0.5 text-[10px] text-muted-foreground">{sub}</p>}
  </div>
);

const RecentEventRow: FC<{ type: string; severity: string; title: string; time: string }> = ({ severity, title, time }) => {
  const Icon = severity === 'error' ? AlertCircleIcon : severity === 'warn' ? AlertTriangleIcon : severity === 'success' ? CheckCircle2Icon : ActivityIcon;
  const color = severity === 'error' ? 'text-red-400' : severity === 'warn' ? 'text-amber-400' : severity === 'success' ? 'text-emerald-400' : 'text-blue-400';
  return (
    <div className="flex items-center gap-2.5 px-3 py-2">
      <Icon className={`h-3 w-3 shrink-0 ${color}`} />
      <span className="text-[11px] truncate flex-1">{title}</span>
      <span className="text-[9px] text-muted-foreground/50 shrink-0">{time}</span>
    </div>
  );
};

function fmtAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'now';
  if (ms < 3600_000) return `${Math.floor(ms / 60_000)}m`;
  if (ms < 86400_000) return `${Math.floor(ms / 3600_000)}h`;
  return `${Math.floor(ms / 86400_000)}d`;
}

export const DashboardPanel: FC<{ onClose: () => void }> = () => {
  const { notifications } = useNotifications();
  const [loading, setLoading] = useState(true);
  const [health, setHealth] = useState<HealthData | null>(null);
  const [tasks, setTasks] = useState<TaskSummary>({ total: 0, running: 0, completed: 0, failed: 0 });
  const [workers, setWorkers] = useState<WorkerSummary>({ total: 0, healthy: 0, degraded: 0 });
  const [gaia, setGaia] = useState<GaiaSnap | null>(null);
  const [cost, setCost] = useState<CostSnap | null>(null);
  const [extensions, setExtensions] = useState(0);
  const [connected, setConnected] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [hRes, tRes, wRes, gRes, mRes, eRes] = await Promise.all([
        legion.daemon.health(),
        legion.daemon.tasks(),
        legion.daemon.workers(),
        legion.daemon.gaiaStatus(),
        legion.daemon.metering(),
        legion.daemon.extensions(),
      ]);

      if (hRes.ok) {
        const d = hRes.data as Record<string, unknown>;
        setHealth({
          status: String(d.status || 'unknown'),
          uptime: typeof d.uptime_seconds === 'number' ? d.uptime_seconds : typeof d.uptime === 'number' ? d.uptime : undefined,
          version: d.version ? String(d.version) : undefined,
          mode: d.mode ? String(d.mode) : undefined,
        });
        setConnected(true);
      } else {
        setConnected(false);
      }

      if (tRes.ok && tRes.data) {
        const arr = Array.isArray(tRes.data) ? tRes.data as Record<string, unknown>[] : [];
        setTasks({
          total: arr.length,
          running: arr.filter((t) => t.status === 'running' || t.status === 'active').length,
          completed: arr.filter((t) => t.status === 'completed' || t.status === 'done').length,
          failed: arr.filter((t) => t.status === 'failed' || t.status === 'error').length,
        });
      }

      if (wRes.ok && wRes.data) {
        const arr = Array.isArray(wRes.data) ? wRes.data as Record<string, unknown>[] : [];
        setWorkers({
          total: arr.length,
          healthy: arr.filter((w) => w.status === 'healthy' || w.status === 'active' || w.status === 'running').length,
          degraded: arr.filter((w) => w.status === 'degraded' || w.status === 'unhealthy').length,
        });
      }

      if (gRes.ok && gRes.data) {
        const d = gRes.data as Record<string, unknown>;
        setGaia({
          mode: d.mode ? String(d.mode) : undefined,
          tick_count: typeof d.tick_count === 'number' ? d.tick_count : undefined,
          active_phases: typeof d.active_phases === 'number' ? d.active_phases : undefined,
        });
      }

      if (mRes.ok && mRes.data) {
        const d = mRes.data as Record<string, unknown>;
        setCost({
          total_cost_usd: typeof d.total_cost_usd === 'number' ? d.total_cost_usd : undefined,
          total_tokens: typeof d.total_tokens === 'number' ? d.total_tokens : undefined,
          total_requests: typeof d.total_requests === 'number' ? d.total_requests : undefined,
        });
      }

      if (eRes.ok && eRes.data) {
        const arr = Array.isArray(eRes.data) ? eRes.data : [];
        setExtensions(arr.length);
      }
    } catch {
      setConnected(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  // Auto-refresh every 15s
  useEffect(() => {
    const id = setInterval(() => { void refresh(); }, 15_000);
    return () => clearInterval(id);
  }, [refresh]);

  const recentEvents = notifications.slice(0, 8);

  if (!connected && !loading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8">
        <div className="rounded-full bg-red-500/10 p-4">
          <AlertCircleIcon className="h-8 w-8 text-red-400" />
        </div>
        <h2 className="text-sm font-semibold">Daemon Offline</h2>
        <p className="max-w-xs text-center text-xs text-muted-foreground">
          Cannot reach the Legion daemon. Start it with <code className="rounded bg-muted/50 px-1 py-0.5 font-mono text-[10px]">legion start</code> and try again.
        </p>
        <button
          type="button"
          onClick={() => void refresh()}
          className="mt-2 rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          Retry Connection
        </button>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-4xl space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold tracking-tight">Mission Control</h2>
            <p className="text-xs text-muted-foreground">
              {connected ? (
                <span className="flex items-center gap-1.5">
                  <StatusDot status="healthy" />
                  Connected
                  {health?.version && <span className="opacity-50">&middot; v{health.version}</span>}
                  {health?.mode && <span className="opacity-50">&middot; {health.mode}</span>}
                </span>
              ) : 'Connecting...'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="rounded-lg border border-border/40 p-2 hover:bg-muted/40 transition-colors disabled:opacity-50"
          >
            <RefreshCwIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {loading && !health ? (
          <div className="flex items-center justify-center py-20">
            <Loader2Icon className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : (
          <>
            {/* Stat grid */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <StatCard
                icon={ClockIcon}
                label="Uptime"
                value={health?.uptime != null ? fmtUptime(health.uptime) : 'N/A'}
                accent="text-blue-400"
              />
              <StatCard
                icon={LayersIcon}
                label="Tasks"
                value={String(tasks.total)}
                sub={`${tasks.running} running · ${tasks.failed} failed`}
                accent="text-violet-400"
              />
              <StatCard
                icon={CpuIcon}
                label="Workers"
                value={String(workers.total)}
                sub={`${workers.healthy} healthy`}
                accent="text-cyan-400"
              />
              <StatCard
                icon={ZapIcon}
                label="Extensions"
                value={String(extensions)}
                accent="text-amber-400"
              />
              <StatCard
                icon={BrainIcon}
                label="GAIA"
                value={gaia?.mode || 'N/A'}
                sub={gaia?.tick_count != null ? `${fmtNum(gaia.tick_count)} ticks` : undefined}
                accent="text-fuchsia-400"
              />
              <StatCard
                icon={DollarSignIcon}
                label="LLM Cost"
                value={cost?.total_cost_usd != null ? `$${cost.total_cost_usd.toFixed(2)}` : 'N/A'}
                sub={cost?.total_tokens != null ? `${fmtNum(cost.total_tokens)} tokens` : undefined}
                accent="text-emerald-400"
              />
            </div>

            {/* Two-column layout */}
            <div className="grid gap-4 lg:grid-cols-2">
              {/* Recent events */}
              <div className="rounded-xl border border-border/40 bg-card/40">
                <div className="flex items-center gap-2 border-b border-border/30 px-4 py-3">
                  <ActivityIcon className="h-3.5 w-3.5 text-primary" />
                  <h3 className="text-xs font-semibold">Recent Events</h3>
                  <span className="ml-auto text-[10px] text-muted-foreground/50">Live</span>
                </div>
                {recentEvents.length === 0 ? (
                  <p className="px-4 py-6 text-center text-xs text-muted-foreground/50">No events yet</p>
                ) : (
                  <div className="divide-y divide-border/20">
                    {recentEvents.map((n) => (
                      <RecentEventRow
                        key={n.id}
                        type={n.type}
                        severity={n.severity}
                        title={n.title}
                        time={fmtAgo(n.timestamp)}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Quick status */}
              <div className="rounded-xl border border-border/40 bg-card/40">
                <div className="flex items-center gap-2 border-b border-border/30 px-4 py-3">
                  <NetworkIcon className="h-3.5 w-3.5 text-primary" />
                  <h3 className="text-xs font-semibold">System Status</h3>
                </div>
                <div className="divide-y divide-border/20">
                  {[
                    { label: 'Daemon', status: connected ? 'healthy' : 'error', detail: connected ? 'Running' : 'Offline' },
                    { label: 'Workers', status: workers.degraded > 0 ? 'warn' : workers.total > 0 ? 'healthy' : 'warn', detail: `${workers.healthy}/${workers.total} healthy` },
                    { label: 'Tasks', status: tasks.failed > 0 ? 'warn' : 'healthy', detail: `${tasks.running} active, ${tasks.failed} failed` },
                    { label: 'GAIA', status: gaia ? 'healthy' : 'warn', detail: gaia?.mode ? `${gaia.mode} mode` : 'Not available' },
                    { label: 'Extensions', status: extensions > 0 ? 'healthy' : 'warn', detail: `${extensions} loaded` },
                  ].map((row) => (
                    <div key={row.label} className="flex items-center gap-3 px-4 py-2.5">
                      <StatusDot status={row.status} />
                      <span className="text-xs font-medium">{row.label}</span>
                      <span className="ml-auto text-[11px] text-muted-foreground">{row.detail}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
