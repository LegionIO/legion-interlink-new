import { useState, useEffect, useCallback, useRef, type FC } from 'react';
import {
  RefreshCwIcon,
  LoaderIcon,
  WifiOffIcon,
  NetworkIcon,
  CircleIcon,
} from 'lucide-react';
import { type SettingsProps } from './shared';
import { legion } from '@/lib/ipc-client';

type LoadState = 'idle' | 'loading' | 'loaded' | 'error';

interface TopologyNode {
  id: string;
  type: 'extension' | 'worker' | 'schedule' | 'node';
  label: string;
  state?: string;
  x: number;
  y: number;
}

interface TopologyEdge {
  from: string;
  to: string;
  label?: string;
}

interface TopologyData {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
}

const NODE_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  extension: { bg: '#3b82f620', border: '#3b82f680', text: '#3b82f6' },
  worker: { bg: '#10b98120', border: '#10b98180', text: '#10b981' },
  schedule: { bg: '#f59e0b20', border: '#f59e0b80', text: '#f59e0b' },
  node: { bg: '#8b5cf620', border: '#8b5cf680', text: '#8b5cf6' },
};

const NODE_RADIUS = 28;
const SVG_WIDTH = 700;
const SVG_HEIGHT = 400;

function layoutNodes(extensions: unknown[], workers: unknown[], schedules: unknown[], nodes: unknown[]): TopologyData {
  const topo: TopologyData = { nodes: [], edges: [] };
  const centerX = SVG_WIDTH / 2;
  const centerY = SVG_HEIGHT / 2;

  // Daemon hub
  topo.nodes.push({ id: 'daemon', type: 'node', label: 'Daemon', state: 'active', x: centerX, y: centerY });

  const placeRing = (
    items: Array<{ name?: string; id?: string; function_id?: string; state?: string; lifecycle_state?: string }>,
    type: TopologyNode['type'],
    radiusX: number,
    radiusY: number,
    startAngle: number,
    sweepAngle: number,
  ) => {
    const count = items.length;
    if (count === 0) return;

    items.forEach((item, i) => {
      const angle = startAngle + (count === 1 ? sweepAngle / 2 : (sweepAngle * i) / (count - 1));
      const rad = (angle * Math.PI) / 180;
      const x = centerX + radiusX * Math.cos(rad);
      const y = centerY + radiusY * Math.sin(rad);
      const id = `${type}-${item.name || item.id || item.function_id || i}`;
      const label = (item.name || item.id || item.function_id || `${type} ${i}`) as string;
      const state = (item.state || item.lifecycle_state || 'unknown') as string;

      topo.nodes.push({ id, type, label: truncateLabel(label), state, x, y });
      topo.edges.push({ from: 'daemon', to: id });
    });
  };

  const exts = (Array.isArray(extensions) ? extensions : []) as Array<{ name?: string; state?: string }>;
  const wkrs = (Array.isArray(workers) ? workers : []) as Array<{ id?: string; lifecycle_state?: string }>;
  const scheds = (Array.isArray(schedules) ? schedules : []) as Array<{ function_id?: string; state?: string }>;
  const clusterNodes = (Array.isArray(nodes) ? nodes : []) as Array<{ id?: string; name?: string; state?: string }>;

  placeRing(exts.slice(0, 12), 'extension', 220, 140, 180, 160);
  placeRing(wkrs.slice(0, 8), 'worker', 220, 140, 350, 100);
  placeRing(scheds.slice(0, 8), 'schedule', 220, 140, 90, 80);
  placeRing(clusterNodes.slice(0, 4), 'node', 160, 100, 10, 70);

  return topo;
}

function truncateLabel(label: string): string {
  if (label.length <= 14) return label;
  return label.slice(0, 12) + '...';
}

export const DaemonTopology: FC<SettingsProps> = () => {
  const [topology, setTopology] = useState<TopologyData | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [loadError, setLoadError] = useState('');
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const fetchTopology = useCallback(async () => {
    setLoadState('loading');
    setLoadError('');
    try {
      const [catalogRes, workersRes, schedulesRes, nodesRes] = await Promise.all([
        legion.daemon.catalog(),
        legion.daemon.workers(),
        legion.daemon.schedules(),
        legion.daemon.nodes(),
      ]);

      const extensions = catalogRes.ok && Array.isArray(catalogRes.data) ? catalogRes.data : [];
      const workers = workersRes.ok && Array.isArray(workersRes.data) ? workersRes.data : [];
      const schedules = schedulesRes.ok && Array.isArray(schedulesRes.data) ? schedulesRes.data : [];
      const nodes = nodesRes.ok && Array.isArray(nodesRes.data) ? nodesRes.data : [];

      const data = layoutNodes(extensions, workers, schedules, nodes);
      setTopology(data);
      setLoadState('loaded');
    } catch (err) {
      setLoadError(String(err));
      setLoadState('error');
    }
  }, []);

  useEffect(() => {
    fetchTopology();
  }, [fetchTopology]);

  if (loadState === 'idle' || loadState === 'loading') {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-8 justify-center">
        <LoaderIcon className="h-4 w-4 animate-spin" />
        Loading topology...
      </div>
    );
  }

  if (loadState === 'error') {
    return (
      <div className="space-y-4">
        <h3 className="text-sm font-semibold">Topology</h3>
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 space-y-3">
          <div className="flex items-start gap-2">
            <WifiOffIcon className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-medium text-destructive">Failed to load topology</p>
              <p className="text-[10px] text-muted-foreground mt-1">{loadError}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={fetchTopology}
            className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs hover:bg-muted transition-colors"
          >
            <RefreshCwIcon className="h-3 w-3" />
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!topology) return null;

  const legend = [
    { type: 'extension', label: 'Extensions' },
    { type: 'worker', label: 'Workers' },
    { type: 'schedule', label: 'Schedules' },
    { type: 'node', label: 'Nodes' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <NetworkIcon className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Topology</h3>
        </div>
        <button
          type="button"
          onClick={fetchTopology}
          className="flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] hover:bg-muted transition-colors"
        >
          <RefreshCwIcon className="h-3 w-3" />
          Refresh
        </button>
      </div>

      <div className="rounded-lg border border-border/50 bg-card/30 overflow-hidden">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
          className="w-full"
          style={{ minHeight: 300 }}
        >
          {/* Edges */}
          {topology.edges.map((edge) => {
            const from = topology.nodes.find((n) => n.id === edge.from);
            const to = topology.nodes.find((n) => n.id === edge.to);
            if (!from || !to) return null;
            const isHovered = hoveredNode === edge.from || hoveredNode === edge.to;
            return (
              <line
                key={`${edge.from}-${edge.to}`}
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                stroke={isHovered ? '#6366f1' : '#64748b40'}
                strokeWidth={isHovered ? 1.5 : 0.8}
                strokeDasharray={isHovered ? undefined : '4 2'}
              />
            );
          })}

          {/* Nodes */}
          {topology.nodes.map((node) => {
            const colors = NODE_COLORS[node.type] || NODE_COLORS.node;
            const isHub = node.id === 'daemon';
            const r = isHub ? NODE_RADIUS + 8 : NODE_RADIUS;
            const isHovered = hoveredNode === node.id;
            const isActive = node.state === 'active' || node.state === 'running' || node.state === 'bootstrap';

            return (
              <g
                key={node.id}
                onMouseEnter={() => setHoveredNode(node.id)}
                onMouseLeave={() => setHoveredNode(null)}
                style={{ cursor: 'pointer' }}
              >
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={r}
                  fill={isHub ? '#6366f120' : colors.bg}
                  stroke={isHovered ? '#6366f1' : isHub ? '#6366f180' : colors.border}
                  strokeWidth={isHovered ? 2 : 1}
                />
                {/* Active indicator dot */}
                {!isHub && (
                  <circle
                    cx={node.x + r * 0.65}
                    cy={node.y - r * 0.65}
                    r={3.5}
                    fill={isActive ? '#10b981' : '#64748b'}
                  />
                )}
                <text
                  x={node.x}
                  y={node.y + 1}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill={isHub ? '#6366f1' : colors.text}
                  fontSize={isHub ? 11 : 8}
                  fontWeight={isHub ? 700 : 500}
                  fontFamily="ui-monospace, monospace"
                >
                  {node.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 justify-center">
        {legend.map((item) => {
          const colors = NODE_COLORS[item.type];
          const count = topology.nodes.filter((n) => n.type === item.type).length;
          return (
            <div key={item.type} className="flex items-center gap-1.5">
              <CircleIcon className="h-2.5 w-2.5" style={{ color: colors.text, fill: colors.bg }} />
              <span className="text-[10px] text-muted-foreground">
                {item.label} ({count})
              </span>
            </div>
          );
        })}
      </div>

      {/* Stats summary */}
      <div className="grid grid-cols-4 gap-2">
        {legend.map((item) => {
          const itemNodes = topology.nodes.filter((n) => n.type === item.type);
          const activeCount = itemNodes.filter((n) => n.state === 'active' || n.state === 'running').length;
          return (
            <div key={item.type} className="rounded-lg border border-border/40 bg-muted/10 p-2 text-center">
              <p className="text-lg font-semibold font-mono">{itemNodes.length}</p>
              <p className="text-[10px] text-muted-foreground">{item.label}</p>
              {activeCount > 0 && (
                <p className="text-[9px] text-green-600 dark:text-green-400">{activeCount} active</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
