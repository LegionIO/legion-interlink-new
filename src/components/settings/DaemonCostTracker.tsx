import { useState, useEffect, useCallback, type FC } from 'react';
import { DollarSignIcon, TrendingUpIcon, AlertTriangleIcon, BarChart3Icon, RefreshCwIcon, Loader2Icon } from 'lucide-react';
import { legion } from '@/lib/ipc-client';
import type { SettingsProps } from './shared';

interface ModelCost {
  model: string;
  provider?: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost_usd: number;
  request_count: number;
}

interface RollupEntry {
  period: string;
  cost_usd: number;
  total_tokens: number;
  request_count: number;
}

interface MeteringData {
  total_cost_usd: number;
  total_tokens: number;
  total_requests: number;
  period_start?: string;
  period_end?: string;
}

function fmt(n: number, decimals = 2): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(decimals);
}

function fmtUsd(n: number): string {
  return `$${n.toFixed(4)}`;
}

const CostCard: FC<{ label: string; value: string; sub?: string; icon: FC<{ className?: string }> }> = ({ label, value, sub, icon: Icon }) => (
  <div className="rounded-xl border border-border/40 bg-card/60 p-3">
    <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
      <Icon className="h-3.5 w-3.5" />
      {label}
    </div>
    <p className="mt-1 text-lg font-semibold">{value}</p>
    {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
  </div>
);

const ModelCostRow: FC<{ model: ModelCost; maxCost: number }> = ({ model, maxCost }) => {
  const pct = maxCost > 0 ? (model.cost_usd / maxCost) * 100 : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium truncate max-w-[200px]" title={model.model}>{model.model}</span>
        <span className="shrink-0 font-mono text-muted-foreground">{fmtUsd(model.cost_usd)}</span>
      </div>
      <div className="flex items-center gap-3">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted/30">
          <div className="h-full rounded-full bg-primary/70 transition-all" style={{ width: `${pct}%` }} />
        </div>
        <span className="shrink-0 text-[10px] text-muted-foreground">{fmt(model.total_tokens, 0)} tok</span>
      </div>
      <div className="flex gap-3 text-[10px] text-muted-foreground">
        <span>{fmt(model.input_tokens, 0)} in</span>
        <span>{fmt(model.output_tokens, 0)} out</span>
        <span>{model.request_count} req</span>
      </div>
    </div>
  );
};

const RollupChart: FC<{ data: RollupEntry[] }> = ({ data }) => {
  if (!data.length) return <p className="text-xs text-muted-foreground">No trend data available.</p>;
  const maxCost = Math.max(...data.map((d) => d.cost_usd), 0.01);

  return (
    <div className="flex items-end gap-1" style={{ height: 120 }}>
      {data.map((entry) => {
        const h = Math.max((entry.cost_usd / maxCost) * 100, 4);
        return (
          <div key={entry.period} className="group relative flex flex-1 flex-col items-center">
            <div
              className="w-full rounded-t bg-primary/60 transition-all hover:bg-primary/80"
              style={{ height: `${h}%` }}
            />
            <span className="mt-1 text-[8px] text-muted-foreground truncate w-full text-center">
              {entry.period.slice(-5)}
            </span>
            <div className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 rounded bg-popover px-2 py-1 text-[10px] shadow-lg border border-border/40 whitespace-nowrap z-10">
              {fmtUsd(entry.cost_usd)} &middot; {fmt(entry.total_tokens, 0)} tok
            </div>
          </div>
        );
      })}
    </div>
  );
};

const PERIODS = ['daily', 'weekly', 'monthly'] as const;
type Period = typeof PERIODS[number];

export const DaemonCostTracker: FC<SettingsProps> = () => {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<MeteringData | null>(null);
  const [byModel, setByModel] = useState<ModelCost[]>([]);
  const [rollup, setRollup] = useState<RollupEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>('daily');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [mRes, modelRes, rollupRes] = await Promise.all([
        legion.daemon.metering(),
        legion.daemon.meteringByModel(),
        legion.daemon.meteringRollup({ period }),
      ]);

      if (mRes.ok && mRes.data) {
        setSummary(mRes.data as MeteringData);
      }
      if (modelRes.ok && modelRes.data) {
        const arr = Array.isArray(modelRes.data) ? modelRes.data : (modelRes.data as { models?: ModelCost[] }).models || [];
        setByModel(arr as ModelCost[]);
      }
      if (rollupRes.ok && rollupRes.data) {
        const arr = Array.isArray(rollupRes.data) ? rollupRes.data : (rollupRes.data as { rollup?: RollupEntry[] }).rollup || [];
        setRollup(arr as RollupEntry[]);
      }

      if (!mRes.ok && !modelRes.ok) {
        setError(mRes.error || modelRes.error || 'Failed to load metering data');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load cost data');
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => { void refresh(); }, [refresh]);

  if (error && !summary) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Cost Tracking</h3>
          <button type="button" onClick={() => void refresh()} className="rounded-md p-1 hover:bg-muted/60">
            <RefreshCwIcon className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 text-xs">
          <div className="flex items-center gap-2 text-red-400">
            <AlertTriangleIcon className="h-4 w-4" />
            <span>{error}</span>
          </div>
          <p className="mt-2 text-muted-foreground">Make sure the Legion daemon is running and the metering endpoint is available.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Cost Tracking</h3>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="rounded-md p-1 hover:bg-muted/60 disabled:opacity-50"
        >
          <RefreshCwIcon className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {loading && !summary ? (
        <div className="flex items-center justify-center py-12">
          <Loader2Icon className="h-5 w-5 animate-spin text-primary" />
        </div>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-3 gap-3">
            <CostCard
              icon={DollarSignIcon}
              label="Total Cost"
              value={fmtUsd(summary?.total_cost_usd ?? 0)}
              sub={summary?.period_start ? `Since ${summary.period_start.slice(0, 10)}` : undefined}
            />
            <CostCard
              icon={BarChart3Icon}
              label="Total Tokens"
              value={fmt(summary?.total_tokens ?? 0, 0)}
              sub={`${summary?.total_requests ?? 0} requests`}
            />
            <CostCard
              icon={TrendingUpIcon}
              label="Avg / Request"
              value={summary && summary.total_requests > 0
                ? fmtUsd(summary.total_cost_usd / summary.total_requests)
                : '$0.00'}
              sub={summary && summary.total_requests > 0
                ? `${fmt((summary.total_tokens ?? 0) / summary.total_requests, 0)} tok/req`
                : undefined}
            />
          </div>

          {/* Usage trend chart */}
          {rollup.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-medium text-muted-foreground">Usage Trend</h4>
                <div className="flex gap-1">
                  {PERIODS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPeriod(p)}
                      className={`rounded-md px-2 py-1 text-[10px] font-medium transition-colors ${
                        period === p
                          ? 'bg-primary/15 text-primary'
                          : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                      }`}
                    >
                      {p.charAt(0).toUpperCase() + p.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="rounded-xl border border-border/40 bg-card/40 p-4">
                <RollupChart data={rollup.slice(-14)} />
              </div>
            </div>
          )}

          {/* Per-model breakdown */}
          <div className="space-y-3">
            <h4 className="text-xs font-medium text-muted-foreground">Cost by Model</h4>
            {byModel.length === 0 ? (
              <p className="text-xs text-muted-foreground">No per-model data available yet.</p>
            ) : (
              <div className="space-y-4 rounded-xl border border-border/40 bg-card/40 p-4">
                {byModel
                  .sort((a, b) => b.cost_usd - a.cost_usd)
                  .map((m) => (
                    <ModelCostRow key={m.model} model={m} maxCost={byModel[0]?.cost_usd ?? 1} />
                  ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
