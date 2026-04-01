import { useEffect, useRef, useState, type FC } from 'react';
import { ActivityIcon } from 'lucide-react';
import { app } from '@/lib/ipc-client';

type GaiaStatusData = {
  started: boolean;
  mode?: string;
  buffer_depth?: number;
  active_channels?: string[];
  sessions?: number;
  extensions_loaded?: number;
  extensions_total?: number;
  wired_phases?: number;
  phase_list?: string[];
  uptime?: number;
};

type GaiaState =
  | { status: 'offline' }
  | { status: 'active'; data: GaiaStatusData }
  | { status: 'dream'; data: GaiaStatusData };

function isDreamMode(data: GaiaStatusData): boolean {
  if (!data.phase_list?.length) return false;
  return data.phase_list.some((p) => p.toLowerCase().includes('dream'));
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

function deriveState(result: { ok: boolean; data?: unknown }): GaiaState {
  if (!result.ok) return { status: 'offline' };
  const raw = result.data as GaiaStatusData | undefined;
  if (!raw?.started) return { status: 'offline' };
  if (isDreamMode(raw)) return { status: 'dream', data: raw };
  return { status: 'active', data: raw };
}

export const GaiaPresenceIndicator: FC = () => {
  const [state, setState] = useState<GaiaState>({ status: 'offline' });
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = async () => {
    try {
      const result = await app.daemon.gaiaStatus();
      setState(deriveState(result as { ok: boolean; data?: unknown }));
    } catch {
      setState({ status: 'offline' });
    }
  };

  useEffect(() => {
    void poll();
    intervalRef.current = setInterval(() => { void poll(); }, 10_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const dotClass =
    state.status === 'active'
      ? 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]'
      : state.status === 'dream'
        ? 'bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.5)]'
        : 'bg-muted-foreground/40';

  const label =
    state.status === 'active'
      ? 'GAIA active'
      : state.status === 'dream'
        ? 'GAIA dream'
        : 'Daemon offline';

  const tooltipLines: string[] = [];
  if (state.status === 'offline') {
    tooltipLines.push('LegionIO daemon not reachable');
  } else {
    const d = state.data;
    tooltipLines.push(`Phase: ${d.phase_list?.join(', ') || 'unknown'}`);
    if (d.wired_phases != null) tooltipLines.push(`Wired phases: ${d.wired_phases}`);
    if (d.sessions != null) tooltipLines.push(`Sessions: ${d.sessions}`);
    if (d.uptime != null) tooltipLines.push(`Uptime: ${formatUptime(d.uptime)}`);
    if (d.extensions_loaded != null && d.extensions_total != null) {
      tooltipLines.push(`Extensions: ${d.extensions_loaded}/${d.extensions_total}`);
    }
  }

  return (
    <div
      className="flex items-center gap-2 px-4 py-2 border-t border-sidebar-border/50"
      title={tooltipLines.join('\n')}
    >
      <span className="relative flex h-2 w-2 shrink-0">
        {state.status !== 'offline' && (
          <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${dotClass}`} />
        )}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${dotClass}`} />
      </span>
      <ActivityIcon className="h-3 w-3 text-muted-foreground/60 shrink-0" />
      <span className="text-[10px] text-muted-foreground truncate">{label}</span>
    </div>
  );
};
