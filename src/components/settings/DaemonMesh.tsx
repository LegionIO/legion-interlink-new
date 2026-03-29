import { useState, useEffect, useCallback, type FC } from 'react';
import { NetworkIcon, CircleIcon, RefreshCwIcon, Loader2Icon, AlertTriangleIcon, HeartPulseIcon, WifiIcon, WifiOffIcon, PlayIcon, PauseIcon } from 'lucide-react';
import { legion } from '@/lib/ipc-client';
import type { SettingsProps } from './shared';

interface MeshPeer {
  id: string;
  name?: string;
  address?: string;
  role?: string;
  status: string;
  last_seen?: string;
  latency_ms?: number;
  hops?: number;
  capabilities?: string[];
}

interface MeshStatus {
  node_id: string;
  cluster_name?: string;
  role?: string;
  peer_count: number;
  connected: boolean;
  uptime_seconds?: number;
  gossip_interval_ms?: number;
}

const STATUS_COLORS: Record<string, string> = {
  healthy: 'text-emerald-400',
  connected: 'text-emerald-400',
  active: 'text-emerald-400',
  degraded: 'text-amber-400',
  unreachable: 'text-red-400',
  disconnected: 'text-red-400',
};

function fmtUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
}

function fmtAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3600_000) return `${Math.floor(ms / 60_000)}m ago`;
  return `${Math.floor(ms / 3600_000)}h ago`;
}

const MeshNodeViz: FC<{ self: MeshStatus; peers: MeshPeer[] }> = ({ self, peers }) => {
  const cx = 200;
  const cy = 150;
  const radius = 100;
  const nodeR = 18;
  const peerPositions = peers.map((_, i) => {
    const angle = (2 * Math.PI * i) / Math.max(peers.length, 1) - Math.PI / 2;
    return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
  });

  return (
    <svg viewBox="0 0 400 300" className="w-full max-w-md mx-auto">
      {/* Edges */}
      {peerPositions.map((pos, i) => (
        <line
          key={`edge-${peers[i].id}`}
          x1={cx} y1={cy} x2={pos.x} y2={pos.y}
          className={peers[i].status === 'unreachable' || peers[i].status === 'disconnected' ? 'stroke-red-500/30' : 'stroke-primary/30'}
          strokeWidth={1.5}
          strokeDasharray={peers[i].status === 'unreachable' || peers[i].status === 'disconnected' ? '4 4' : undefined}
        />
      ))}

      {/* Self node */}
      <circle cx={cx} cy={cy} r={nodeR} className="fill-primary/20 stroke-primary" strokeWidth={2} />
      <text x={cx} y={cy + 4} textAnchor="middle" className="fill-foreground text-[10px] font-medium">Self</text>
      <text x={cx} y={cy + nodeR + 14} textAnchor="middle" className="fill-muted-foreground text-[8px]">{self.role || 'node'}</text>

      {/* Peer nodes */}
      {peerPositions.map((pos, i) => {
        const peer = peers[i];
        const isDown = peer.status === 'unreachable' || peer.status === 'disconnected';
        return (
          <g key={peer.id}>
            <circle cx={pos.x} cy={pos.y} r={nodeR - 2} className={isDown ? 'fill-red-500/10 stroke-red-500/50' : 'fill-emerald-500/10 stroke-emerald-500/50'} strokeWidth={1.5} />
            <text x={pos.x} y={pos.y + 3} textAnchor="middle" className="fill-foreground text-[8px]">
              {(peer.name || peer.id).slice(0, 8)}
            </text>
            {peer.latency_ms != null && (
              <text x={pos.x} y={pos.y + nodeR + 10} textAnchor="middle" className="fill-muted-foreground text-[7px]">
                {peer.latency_ms}ms
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
};

const PeerRow: FC<{ peer: MeshPeer }> = ({ peer }) => {
  const color = STATUS_COLORS[peer.status] || 'text-muted-foreground';
  return (
    <div className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-muted/20 transition-colors">
      <CircleIcon className={`h-2.5 w-2.5 shrink-0 fill-current ${color}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium truncate">{peer.name || peer.id}</span>
          {peer.role && <span className="shrink-0 rounded bg-muted/50 px-1.5 py-0.5 text-[9px] text-muted-foreground">{peer.role}</span>}
        </div>
        <div className="flex gap-3 text-[10px] text-muted-foreground mt-0.5">
          {peer.address && <span>{peer.address}</span>}
          {peer.latency_ms != null && <span>{peer.latency_ms}ms</span>}
          {peer.hops != null && <span>{peer.hops} hop{peer.hops !== 1 ? 's' : ''}</span>}
          {peer.last_seen && <span>{fmtAgo(peer.last_seen)}</span>}
        </div>
      </div>
      {peer.status === 'unreachable' || peer.status === 'disconnected' ? (
        <WifiOffIcon className="h-3.5 w-3.5 shrink-0 text-red-400" />
      ) : (
        <WifiIcon className="h-3.5 w-3.5 shrink-0 text-emerald-400/60" />
      )}
    </div>
  );
};

export const DaemonMesh: FC<SettingsProps> = () => {
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<MeshStatus | null>(null);
  const [peers, setPeers] = useState<MeshPeer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [sRes, pRes] = await Promise.all([
        legion.daemon.meshStatus(),
        legion.daemon.meshPeers(),
      ]);

      if (sRes.ok && sRes.data) {
        setStatus(sRes.data as MeshStatus);
      }
      if (pRes.ok && pRes.data) {
        const arr = Array.isArray(pRes.data) ? pRes.data : (pRes.data as { peers?: MeshPeer[] }).peers || [];
        setPeers(arr as MeshPeer[]);
      }

      if (!sRes.ok && !pRes.ok) {
        setError(sRes.error || pRes.error || 'Failed to load mesh data');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load mesh data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!live) return;
    const interval = setInterval(() => { void refresh(); }, 10_000);
    return () => clearInterval(interval);
  }, [refresh, live]);

  if (error && !status) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Agent Mesh</h3>
          <button type="button" onClick={() => void refresh()} className="rounded-md p-1 hover:bg-muted/60">
            <RefreshCwIcon className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 text-xs">
          <div className="flex items-center gap-2 text-red-400">
            <AlertTriangleIcon className="h-4 w-4" />
            <span>{error}</span>
          </div>
          <p className="mt-2 text-muted-foreground">Mesh topology requires the daemon to be running with mesh support enabled.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Agent Mesh Topology</h3>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setLive((v) => !v)}
            title={live ? 'Stop auto-refresh' : 'Start auto-refresh (10s)'}
            className={`rounded-md p-1 transition-colors ${live ? 'bg-emerald-500/15 text-emerald-500' : 'text-muted-foreground hover:bg-muted/60'}`}
          >
            {live ? <PauseIcon className="h-3.5 w-3.5" /> : <PlayIcon className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="rounded-md p-1 hover:bg-muted/60 disabled:opacity-50"
          >
            <RefreshCwIcon className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {loading && !status ? (
        <div className="flex items-center justify-center py-12">
          <Loader2Icon className="h-5 w-5 animate-spin text-primary" />
        </div>
      ) : (
        <>
          {/* Status cards */}
          <div className="grid grid-cols-4 gap-3">
            <div className="rounded-xl border border-border/40 bg-card/60 p-3">
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                <NetworkIcon className="h-3.5 w-3.5" />
                Node
              </div>
              <p className="mt-1 text-xs font-semibold truncate" title={status?.node_id}>{status?.node_id?.slice(0, 12) || '...'}</p>
              {status?.cluster_name && <p className="text-[10px] text-muted-foreground">{status.cluster_name}</p>}
            </div>
            <div className="rounded-xl border border-border/40 bg-card/60 p-3">
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                <HeartPulseIcon className="h-3.5 w-3.5" />
                Status
              </div>
              <p className={`mt-1 text-xs font-semibold ${status?.connected ? 'text-emerald-400' : 'text-red-400'}`}>
                {status?.connected ? 'Connected' : 'Disconnected'}
              </p>
              {status?.role && <p className="text-[10px] text-muted-foreground">{status.role}</p>}
            </div>
            <div className="rounded-xl border border-border/40 bg-card/60 p-3">
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                <WifiIcon className="h-3.5 w-3.5" />
                Peers
              </div>
              <p className="mt-1 text-xs font-semibold">{status?.peer_count ?? peers.length}</p>
              <p className="text-[10px] text-muted-foreground">
                {peers.filter((p) => p.status !== 'unreachable' && p.status !== 'disconnected').length} reachable
              </p>
            </div>
            <div className="rounded-xl border border-border/40 bg-card/60 p-3">
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                <RefreshCwIcon className="h-3.5 w-3.5" />
                Uptime
              </div>
              <p className="mt-1 text-xs font-semibold">{status?.uptime_seconds ? fmtUptime(status.uptime_seconds) : 'N/A'}</p>
              {status?.gossip_interval_ms && <p className="text-[10px] text-muted-foreground">gossip: {status.gossip_interval_ms}ms</p>}
            </div>
          </div>

          {/* Topology visualization */}
          {status && peers.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-xs font-medium text-muted-foreground">Network Topology</h4>
              <div className="rounded-xl border border-border/40 bg-card/40 p-4">
                <MeshNodeViz self={status} peers={peers} />
              </div>
            </div>
          )}

          {/* Peer list */}
          <div className="space-y-2">
            <h4 className="text-xs font-medium text-muted-foreground">Peers ({peers.length})</h4>
            {peers.length === 0 ? (
              <p className="text-xs text-muted-foreground">No peers discovered yet.</p>
            ) : (
              <div className="rounded-xl border border-border/40 bg-card/40 divide-y divide-border/30">
                {peers.map((peer) => (
                  <PeerRow key={peer.id} peer={peer} />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
