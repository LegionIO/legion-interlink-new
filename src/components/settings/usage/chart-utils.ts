// Shared formatting and chart utilities for the Usage dashboard.

export function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString('en-US');
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

export function formatDateShort(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// SVG arc path for donut chart segments
export function describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number): string {
  const startRad = ((startAngle - 90) * Math.PI) / 180;
  const endRad = ((endAngle - 90) * Math.PI) / 180;
  const x1 = cx + r * Math.cos(startRad);
  const y1 = cy + r * Math.sin(startRad);
  const x2 = cx + r * Math.cos(endRad);
  const y2 = cy + r * Math.sin(endRad);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`;
}

// Fallback-safe CSS colors for model charts
const MODEL_COLORS_FALLBACK = [
  '#5b7bd5', '#4da67a', '#d4873e', '#c75b9b',
  '#8fae3f', '#3da5a5', '#d44d4d', '#63b54c',
];

export function getModelColorFallback(index: number): string {
  return MODEL_COLORS_FALLBACK[index % MODEL_COLORS_FALLBACK.length];
}
