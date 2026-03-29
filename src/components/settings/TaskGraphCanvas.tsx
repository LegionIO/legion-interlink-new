import { useState, useMemo, type FC } from 'react';

export interface GraphNode {
  id: string;
  label: string;
  status: string;
  runner?: string;
  function?: string;
  created_at?: string;
  parent_id?: string | null;
  depends_on?: string[];
}

interface Props {
  nodes: GraphNode[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

const STATUS_COLORS: Record<string, { fill: string; stroke: string; text: string }> = {
  running:   { fill: '#1d4ed8', stroke: '#3b82f6', text: '#93c5fd' },
  completed: { fill: '#166534', stroke: '#22c55e', text: '#86efac' },
  failed:    { fill: '#991b1b', stroke: '#ef4444', text: '#fca5a5' },
  pending:   { fill: '#854d0e', stroke: '#eab308', text: '#fde68a' },
};

const DEFAULT_COLOR = { fill: '#374151', stroke: '#6b7280', text: '#d1d5db' };

interface LayoutNode {
  node: GraphNode;
  x: number;
  y: number;
  layer: number;
}

interface LayoutEdge {
  from: LayoutNode;
  to: LayoutNode;
}

function buildLayout(nodes: GraphNode[]): { layoutNodes: LayoutNode[]; edges: LayoutEdge[]; width: number; height: number } {
  if (nodes.length === 0) return { layoutNodes: [], edges: [], width: 400, height: 200 };

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  // Build adjacency: parent → children
  const children = new Map<string, string[]>();
  const hasParent = new Set<string>();

  for (const node of nodes) {
    const parents: string[] = [];
    if (node.parent_id && nodeMap.has(node.parent_id)) parents.push(node.parent_id);
    if (node.depends_on) {
      for (const dep of node.depends_on) {
        if (nodeMap.has(dep) && dep !== node.parent_id) parents.push(dep);
      }
    }
    for (const p of parents) {
      if (!children.has(p)) children.set(p, []);
      children.get(p)!.push(node.id);
      hasParent.add(node.id);
    }
  }

  // Assign layers via BFS from roots
  const layers = new Map<string, number>();
  const roots = nodes.filter((n) => !hasParent.has(n.id));
  if (roots.length === 0) {
    // Circular or all have parents — just treat first node as root
    roots.push(nodes[0]);
  }

  const queue: string[] = [];
  for (const r of roots) {
    layers.set(r.id, 0);
    queue.push(r.id);
  }

  while (queue.length > 0) {
    const id = queue.shift()!;
    const layer = layers.get(id)!;
    for (const childId of children.get(id) || []) {
      const existing = layers.get(childId);
      if (existing === undefined || existing < layer + 1) {
        layers.set(childId, layer + 1);
        queue.push(childId);
      }
    }
  }

  // Assign unvisited nodes to layer 0
  for (const node of nodes) {
    if (!layers.has(node.id)) layers.set(node.id, 0);
  }

  // Group by layer
  const layerGroups = new Map<number, GraphNode[]>();
  for (const node of nodes) {
    const l = layers.get(node.id)!;
    if (!layerGroups.has(l)) layerGroups.set(l, []);
    layerGroups.get(l)!.push(node);
  }

  const NODE_W = 160;
  const NODE_H = 80;
  const LAYER_GAP = 120;
  const NODE_GAP = 30;
  const PAD = 40;

  const maxLayer = Math.max(...layerGroups.keys(), 0);
  const maxNodesInLayer = Math.max(...[...layerGroups.values()].map((g) => g.length), 1);

  const layoutNodes: LayoutNode[] = [];
  const layoutMap = new Map<string, LayoutNode>();

  for (const [layer, group] of layerGroups) {
    const totalWidth = group.length * NODE_W + (group.length - 1) * NODE_GAP;
    const startX = (maxNodesInLayer * NODE_W + (maxNodesInLayer - 1) * NODE_GAP - totalWidth) / 2 + PAD;

    group.forEach((node, i) => {
      const ln: LayoutNode = {
        node,
        x: startX + i * (NODE_W + NODE_GAP),
        y: PAD + layer * (NODE_H + LAYER_GAP),
        layer,
      };
      layoutNodes.push(ln);
      layoutMap.set(node.id, ln);
    });
  }

  // Build edges
  const edges: LayoutEdge[] = [];
  for (const node of nodes) {
    const to = layoutMap.get(node.id);
    if (!to) continue;
    const parents: string[] = [];
    if (node.parent_id && nodeMap.has(node.parent_id)) parents.push(node.parent_id);
    if (node.depends_on) {
      for (const dep of node.depends_on) {
        if (nodeMap.has(dep) && dep !== node.parent_id) parents.push(dep);
      }
    }
    for (const pid of parents) {
      const from = layoutMap.get(pid);
      if (from) edges.push({ from, to });
    }
  }

  const width = Math.max(maxNodesInLayer * (NODE_W + NODE_GAP) + PAD * 2, 400);
  const height = (maxLayer + 1) * (NODE_H + LAYER_GAP) + PAD * 2;

  return { layoutNodes, edges, width, height };
}

export const TaskGraphCanvas: FC<Props> = ({ nodes, selectedId, onSelect }) => {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const { layoutNodes, edges, width, height } = useMemo(() => buildLayout(nodes), [nodes]);

  const NODE_W = 160;
  const NODE_H = 48;

  if (nodes.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
        No tasks to display
      </div>
    );
  }

  return (
    <div className="overflow-auto rounded-lg border border-border/30 bg-card/10">
      <svg width={width} height={height} className="min-w-full">
        <defs>
          <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="#6b7280" />
          </marker>
        </defs>

        {/* Edges */}
        {edges.map((edge, i) => {
          const x1 = edge.from.x + NODE_W / 2;
          const y1 = edge.from.y + NODE_H;
          const x2 = edge.to.x + NODE_W / 2;
          const y2 = edge.to.y;
          const midY = (y1 + y2) / 2;

          return (
            <path
              key={i}
              d={`M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`}
              fill="none"
              stroke="#4b5563"
              strokeWidth="1.5"
              markerEnd="url(#arrowhead)"
              opacity={0.6}
            />
          );
        })}

        {/* Nodes */}
        {layoutNodes.map((ln) => {
          const colors = STATUS_COLORS[ln.node.status] || DEFAULT_COLOR;
          const isSelected = ln.node.id === selectedId;
          const isHovered = ln.node.id === hoveredId;
          const shortId = ln.node.id.slice(0, 8);
          const label = ln.node.label || ln.node.function || ln.node.runner || shortId;

          return (
            <g
              key={ln.node.id}
              className="cursor-pointer"
              onClick={() => onSelect(isSelected ? null : ln.node.id)}
              onMouseEnter={() => setHoveredId(ln.node.id)}
              onMouseLeave={() => setHoveredId(null)}
            >
              {/* Selection glow */}
              {isSelected && (
                <rect
                  x={ln.x - 3} y={ln.y - 3}
                  width={NODE_W + 6} height={NODE_H + 6}
                  rx={10} ry={10}
                  fill="none" stroke={colors.stroke} strokeWidth="2" opacity={0.5}
                />
              )}
              {/* Node background */}
              <rect
                x={ln.x} y={ln.y}
                width={NODE_W} height={NODE_H}
                rx={8} ry={8}
                fill={colors.fill}
                stroke={colors.stroke}
                strokeWidth={isHovered ? 2 : 1}
                opacity={isHovered ? 1 : 0.85}
              />
              {/* Running pulse */}
              {ln.node.status === 'running' && (
                <rect
                  x={ln.x} y={ln.y}
                  width={NODE_W} height={NODE_H}
                  rx={8} ry={8}
                  fill="none" stroke={colors.stroke} strokeWidth="2"
                >
                  <animate attributeName="opacity" values="0.6;0.1;0.6" dur="2s" repeatCount="indefinite" />
                </rect>
              )}
              {/* Label */}
              <text
                x={ln.x + NODE_W / 2} y={ln.y + 18}
                textAnchor="middle" fontSize="11" fontWeight="600"
                fill={colors.text}
                className="pointer-events-none select-none"
              >
                {label.length > 20 ? label.slice(0, 18) + '...' : label}
              </text>
              {/* Status + ID */}
              <text
                x={ln.x + NODE_W / 2} y={ln.y + 34}
                textAnchor="middle" fontSize="9"
                fill={colors.text} opacity={0.7}
                className="pointer-events-none select-none"
              >
                {ln.node.status} · {shortId}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
};
