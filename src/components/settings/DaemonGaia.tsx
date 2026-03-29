import { useState, useEffect, useCallback, useRef, type FC } from 'react';
import { BrainIcon, RefreshCwIcon, Loader2Icon, AlertCircleIcon, PauseIcon, MoonIcon, EyeIcon, ZapIcon, ActivityIcon } from 'lucide-react';
import type { SettingsProps } from './shared';
import { GaiaPhaseWheel } from './GaiaPhaseWheel';
import { legion } from '@/lib/ipc-client';

const POLL_INTERVAL = 3000;

interface PhaseState {
  name: string;
  status: 'running' | 'completed' | 'idle' | 'skipped';
  last_run?: string;
  duration_ms?: number;
  budget_ms?: number;
}

interface GaiaStatus {
  tick_mode?: string;
  tick_count?: number;
  phases?: PhaseState[];
  sensory_buffer?: { depth?: number; recent_signals?: number; max_capacity?: number };
  channels?: Array<{ name: string; type?: string; connected?: boolean }>;
  sessions?: { active_count?: number; ttl?: number; identities?: string[] };
  notification_gate?: { schedule?: boolean; presence?: string; behavioral?: number };
  dream_cycle?: { active?: boolean; last_run?: string; phase_progress?: string; insight_count?: number };
  uptime_seconds?: number;
}

interface TickEvent {
  timestamp: string;
  phase: string;
  duration_ms?: number;
  status?: string;
}

const modeConfig: Record<string, { color: string; bg: string; icon: typeof ZapIcon }> = {
  dormant: { color: 'text-gray-400', bg: 'bg-gray-500/10', icon: PauseIcon },
  sentinel: { color: 'text-amber-400', bg: 'bg-amber-500/10', icon: EyeIcon },
  full_active: { color: 'text-emerald-400', bg: 'bg-emerald-500/10', icon: ZapIcon },
  dormant_active: { color: 'text-purple-400', bg: 'bg-purple-500/10', icon: MoonIcon },
};

function formatSecondsAgo(date: Date): string {
  const secs = Math.floor((Date.now() - date.getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

export const DaemonGaia: FC<SettingsProps> = () => {
  const [status, setStatus] = useState<GaiaStatus | null>(null);
  const [events, setEvents] = useState<TickEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = useCallback(async () => {
    const res = await legion.daemon.gaiaStatus();
    if (res.ok && res.data) {
      setStatus(res.data as GaiaStatus);
      setLastFetched(new Date());
      setError(null);
    } else {
      setError(res.error || 'Failed to fetch GAIA status');
    }
    setLoading(false);
  }, []);

  const fetchEvents = useCallback(async () => {
    const res = await legion.daemon.gaiaEvents({ limit: '50' });
    if (res.ok && res.data) {
      const newEvents = Array.isArray(res.data) ? res.data as TickEvent[] : (res.data as { events?: TickEvent[] }).events || [];
      setEvents((prev) => {
        const seen = new Set(prev.map((e) => `${e.timestamp}|${e.phase}`));
        const merged = [...prev, ...newEvents.filter((e) => !seen.has(`${e.timestamp}|${e.phase}`))];
        return merged.slice(-200);
      });
    }
  }, []);

  useEffect(() => { fetchStatus(); fetchEvents(); }, [fetchStatus, fetchEvents]);

  useEffect(() => {
    if (live) {
      intervalRef.current = setInterval(() => { fetchStatus(); fetchEvents(); }, POLL_INTERVAL);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [live, fetchStatus, fetchEvents]);

  useEffect(() => {
    if (live && feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [events, live]);

  if (loading) return <div className="flex justify-center py-12"><Loader2Icon className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (error && !status) return (
    <div className="flex flex-col items-center gap-4 py-12">
      <AlertCircleIcon className="h-8 w-8 text-muted-foreground/40" />
      <p className="text-sm text-muted-foreground">{error}</p>
      <button type="button" onClick={fetchStatus} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Retry</button>
    </div>
  );

  const mode = status?.tick_mode || 'unknown';
  const mc = modeConfig[mode] || modeConfig.dormant;
  const ModeIcon = mc.icon;
  const buf = status?.sensory_buffer;
  const gate = status?.notification_gate;
  const dream = status?.dream_cycle;
  const sessions = status?.sessions;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BrainIcon className="h-5 w-5 text-primary" />
          <h3 className="text-sm font-semibold">GAIA Cognitive Engine</h3>
          <span className={`flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${mc.bg} ${mc.color}`}>
            <ModeIcon className="h-3 w-3" />
            {mode.replace(/_/g, ' ')}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {lastFetched && (
            <span className="text-[10px] text-muted-foreground">Updated {formatSecondsAgo(lastFetched)}</span>
          )}
          <button type="button" onClick={() => setLive(!live)} className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${live ? 'bg-red-500/10 text-red-400' : 'bg-card/50 text-muted-foreground hover:text-foreground border border-border/50'}`}>
            {live && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />}
            {live ? 'Stop' : 'Live'}
          </button>
          <button type="button" onClick={() => { fetchStatus(); fetchEvents(); }} className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted/50">
            <RefreshCwIcon className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Phase Wheel */}
      <GaiaPhaseWheel
        phases={status?.phases || []}
        tickMode={mode}
        tickCount={status?.tick_count || 0}
      />

      {/* Status Cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {/* Tick Mode */}
        <div className="rounded-lg border border-border/50 bg-card/30 p-3">
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Tick Mode</p>
          <p className={`mt-1 text-sm font-semibold capitalize ${mc.color}`}>{mode.replace(/_/g, ' ')}</p>
          {status?.uptime_seconds != null && <p className="text-[10px] text-muted-foreground">Uptime: {Math.floor(status.uptime_seconds / 60)}m</p>}
        </div>

        {/* Sensory Buffer */}
        <div className="rounded-lg border border-border/50 bg-card/30 p-3">
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Sensory Buffer</p>
          <p className="mt-1 text-lg font-bold">{buf?.depth ?? '—'}<span className="text-xs font-normal text-muted-foreground">/{buf?.max_capacity ?? 1000}</span></p>
          {buf?.recent_signals != null && <p className="text-[10px] text-muted-foreground">{buf.recent_signals} recent signals</p>}
        </div>

        {/* Channels */}
        <div className="rounded-lg border border-border/50 bg-card/30 p-3">
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Channels</p>
          <div className="mt-1 flex flex-col gap-1">
            {status?.channels?.length ? status.channels.map((ch) => (
              <div key={ch.name} className="flex items-center gap-1.5">
                <span className={`h-1.5 w-1.5 rounded-full ${ch.connected ? 'bg-emerald-400' : 'bg-gray-500'}`} />
                <span className="text-xs">{ch.name}</span>
                {ch.type && <span className="rounded-full bg-muted/50 px-1.5 py-0.5 text-[9px] text-muted-foreground">{ch.type}</span>}
              </div>
            )) : <span className="text-xs text-muted-foreground">No active channels</span>}
          </div>
        </div>

        {/* Sessions */}
        <div className="rounded-lg border border-border/50 bg-card/30 p-3">
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Sessions</p>
          <p className="mt-1 text-lg font-bold">{sessions?.active_count ?? '—'}</p>
          {sessions?.ttl != null && <p className="text-[10px] text-muted-foreground">TTL: {sessions.ttl}s</p>}
          {sessions?.identities?.length ? (
            <div className="mt-1 flex flex-wrap gap-1">
              {sessions.identities.slice(0, 3).map((id) => (
                <span key={id} className="rounded-full bg-primary/10 px-2 py-0.5 text-[9px] text-primary">{id}</span>
              ))}
              {sessions.identities.length > 3 && <span className="text-[9px] text-muted-foreground">+{sessions.identities.length - 3}</span>}
            </div>
          ) : null}
        </div>

        {/* Notification Gate */}
        <div className="rounded-lg border border-border/50 bg-card/30 p-3">
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Notification Gate</p>
          <div className="mt-1.5 flex flex-col gap-1">
            <div className="flex items-center gap-1.5">
              <span className={`h-1.5 w-1.5 rounded-full ${gate?.schedule ? 'bg-emerald-400' : 'bg-gray-500'}`} />
              <span className="text-[10px]">Schedule: {gate?.schedule ? 'Open' : 'Closed'}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
              <span className="text-[10px]">Presence: {gate?.presence || '—'}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-purple-400" />
              <span className="text-[10px]">Behavioral: {gate?.behavioral != null ? `${(gate.behavioral * 100).toFixed(0)}%` : '—'}</span>
            </div>
          </div>
        </div>

        {/* Dream Cycle */}
        <div className="rounded-lg border border-border/50 bg-card/30 p-3">
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Dream Cycle</p>
          <div className="mt-1 flex items-center gap-1.5">
            <MoonIcon className={`h-3.5 w-3.5 ${dream?.active ? 'text-purple-400' : 'text-gray-500'}`} />
            <span className="text-xs font-medium">{dream?.active ? 'Active' : 'Idle'}</span>
          </div>
          {dream?.last_run && <p className="text-[10px] text-muted-foreground">Last: {dream.last_run}</p>}
          {dream?.insight_count != null && <p className="text-[10px] text-muted-foreground">{dream.insight_count} insights</p>}
          {dream?.phase_progress && <p className="text-[10px] text-muted-foreground">{dream.phase_progress}</p>}
        </div>
      </div>

      {/* Live Tick Stream */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ActivityIcon className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-medium">Tick Stream</span>
            {live && <span className="flex items-center gap-1 text-[10px] text-emerald-400"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />Live</span>}
          </div>
          <span className="text-[10px] text-muted-foreground">{events.length} events</span>
        </div>
        <div ref={feedRef} className="max-h-[300px] overflow-y-auto rounded-lg border border-border/30 bg-card/10">
          {events.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">No tick events yet</p>
          ) : (
            <table className="w-full text-[11px]">
              <thead className="sticky top-0 bg-card/80 backdrop-blur-sm">
                <tr className="border-b border-border/30 text-left text-muted-foreground">
                  <th className="px-3 py-1.5 font-medium">Time</th>
                  <th className="px-3 py-1.5 font-medium">Phase</th>
                  <th className="px-3 py-1.5 font-medium text-right">Duration</th>
                  <th className="px-3 py-1.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {events.map((ev, i) => (
                  <tr key={`${ev.timestamp}-${ev.phase}-${i}`} className="border-b border-border/10 hover:bg-muted/20">
                    <td className="px-3 py-1 font-mono text-muted-foreground">{ev.timestamp}</td>
                    <td className="px-3 py-1">{ev.phase?.replace(/_/g, ' ')}</td>
                    <td className="px-3 py-1 text-right font-mono">{ev.duration_ms != null ? `${ev.duration_ms}ms` : '—'}</td>
                    <td className="px-3 py-1">
                      <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium ${
                        ev.status === 'completed' ? 'bg-emerald-500/10 text-emerald-400' :
                        ev.status === 'running' ? 'bg-blue-500/10 text-blue-400' :
                        ev.status === 'skipped' ? 'bg-gray-500/10 text-gray-400' :
                        'bg-muted/50 text-muted-foreground'
                      }`}>{ev.status || '—'}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};
