import { useState, type FC } from 'react';
import { formatTokenCount, describeArc, getModelColorFallback } from './chart-utils';

type ModelData = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  requestCount: number;
  conversationCount: number;
};

// ── Donut Chart ──────────────────────────────────────────────────────────────

const DONUT_SIZE = 200;
const DONUT_RADIUS = 70;
const DONUT_STROKE = 24;

const DonutChart: FC<{ data: ModelData[] }> = ({ data }) => {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const totalTokens = data.reduce((s, d) => s + d.totalTokens, 0);
  if (totalTokens === 0) return null;

  // Build arc segments — limit to top 8 + "Other"
  const sorted = [...data].sort((a, b) => b.totalTokens - a.totalTokens);
  const top = sorted.slice(0, 8);
  const otherTokens = sorted.slice(8).reduce((s, d) => s + d.totalTokens, 0);
  if (otherTokens > 0) {
    top.push({
      model: 'Other',
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: otherTokens,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      requestCount: sorted.slice(8).reduce((s, d) => s + d.requestCount, 0),
      conversationCount: sorted.slice(8).reduce((s, d) => s + d.conversationCount, 0),
    });
  }

  const cx = DONUT_SIZE / 2;
  const cy = DONUT_SIZE / 2;
  let currentAngle = 0;

  const segments = top.map((entry, i) => {
    const fraction = entry.totalTokens / totalTokens;
    const sweep = fraction * 360;
    const clampedSweep = Math.min(sweep, 359.99);
    const startAngle = currentAngle;
    const endAngle = currentAngle + clampedSweep;
    currentAngle += sweep;

    return {
      entry,
      index: i,
      path: describeArc(cx, cy, DONUT_RADIUS, startAngle, endAngle),
      color: getModelColorFallback(i),
      fraction,
    };
  });

  const hovered = hoveredIdx !== null ? top[hoveredIdx] : null;

  return (
    <div className="flex items-center gap-6">
      <svg
        width={DONUT_SIZE}
        height={DONUT_SIZE}
        viewBox={`0 0 ${DONUT_SIZE} ${DONUT_SIZE}`}
        className="shrink-0"
      >
        {segments.map((seg) => (
          <path
            key={seg.index}
            d={seg.path}
            fill="none"
            stroke={seg.color}
            strokeWidth={hoveredIdx === seg.index ? DONUT_STROKE + 4 : DONUT_STROKE}
            strokeLinecap="round"
            className="transition-all duration-200"
            style={{ opacity: hoveredIdx !== null && hoveredIdx !== seg.index ? 0.35 : 1 }}
            onMouseEnter={() => setHoveredIdx(seg.index)}
            onMouseLeave={() => setHoveredIdx(null)}
          />
        ))}
        {/* Center text */}
        <text
          x={cx}
          y={cy - 6}
          textAnchor="middle"
          className="fill-foreground text-lg font-semibold"
          style={{ fontSize: 18 }}
        >
          {formatTokenCount(totalTokens)}
        </text>
        <text
          x={cx}
          y={cy + 12}
          textAnchor="middle"
          className="fill-muted-foreground"
          style={{ fontSize: 10 }}
        >
          total tokens
        </text>
      </svg>

      {/* Legend */}
      <div className="space-y-1.5 min-w-0 flex-1">
        {segments.map((seg) => (
          <div
            key={seg.index}
            className={`flex items-center gap-2 text-xs rounded-md px-1.5 py-0.5 transition-colors ${
              hoveredIdx === seg.index ? 'bg-muted/40' : ''
            }`}
            onMouseEnter={() => setHoveredIdx(seg.index)}
            onMouseLeave={() => setHoveredIdx(null)}
          >
            <span
              className="h-2.5 w-2.5 rounded-full shrink-0"
              style={{ backgroundColor: seg.color }}
            />
            <span className="truncate max-w-[120px] font-medium" title={seg.entry.model}>
              {seg.entry.model}
            </span>
            <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">
              {Math.round(seg.fraction * 100)}%
            </span>
          </div>
        ))}
      </div>

      {/* Hover detail card */}
      {hovered && (
        <div className="shrink-0 w-[140px] rounded-xl border border-border/40 bg-card/60 p-2.5 space-y-1">
          <p className="text-[10px] font-medium truncate">{hovered.model}</p>
          <p className="text-sm font-semibold tabular-nums">{formatTokenCount(hovered.totalTokens)}</p>
          <div className="text-[10px] text-muted-foreground space-y-0.5">
            <p>{formatTokenCount(hovered.inputTokens)} in · {formatTokenCount(hovered.outputTokens)} out</p>
            <p>{hovered.requestCount} messages</p>
            <p>{hovered.conversationCount} conversations</p>
          </div>
        </div>
      )}
    </div>
  );
};

// ── Model Bar Row ────────────────────────────────────────────────────────────

const ModelBarRow: FC<{ model: ModelData; maxTokens: number; index: number }> = ({ model, maxTokens, index }) => {
  const pct = maxTokens > 0 ? (model.totalTokens / maxTokens) * 100 : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium truncate max-w-[200px]" title={model.model}>
          {model.model}
        </span>
        <span className="shrink-0 font-mono text-muted-foreground tabular-nums">
          {formatTokenCount(model.totalTokens)}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted/30">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${pct}%`, backgroundColor: getModelColorFallback(index) }}
          />
        </div>
      </div>
      <div className="flex gap-3 text-[10px] text-muted-foreground">
        <span>{formatTokenCount(model.inputTokens)} in</span>
        <span>{formatTokenCount(model.outputTokens)} out</span>
        {model.cacheReadTokens > 0 && <span>{formatTokenCount(model.cacheReadTokens)} cached</span>}
        <span>{model.requestCount} msg</span>
        <span>{model.conversationCount} conv</span>
      </div>
    </div>
  );
};

// ── Composed Component ───────────────────────────────────────────────────────

export const UsageModelBreakdown: FC<{ data: ModelData[] }> = ({ data }) => {
  // Filter out models with 0 tokens
  const filtered = data.filter((m) => m.totalTokens > 0);

  if (!filtered.length) {
    return (
      <div className="space-y-2">
        <h4 className="text-xs font-medium text-muted-foreground">By Model</h4>
        <p className="text-xs text-muted-foreground py-4 text-center">No model usage data yet.</p>
      </div>
    );
  }

  const sorted = [...filtered].sort((a, b) => b.totalTokens - a.totalTokens);
  const maxTokens = sorted[0]?.totalTokens ?? 1;

  return (
    <div className="space-y-4">
      <h4 className="text-xs font-medium text-muted-foreground">By Model</h4>

      {/* Donut chart */}
      <div className="rounded-xl border border-border/40 bg-card/40 p-4">
        <DonutChart data={filtered} />
      </div>

      {/* Per-model bars */}
      <div className="space-y-4 rounded-xl border border-border/40 bg-card/40 p-4">
        {sorted.map((m, i) => (
          <ModelBarRow key={m.model} model={m} maxTokens={maxTokens} index={i} />
        ))}
      </div>
    </div>
  );
};
