import type { FC } from 'react';
import { formatTokenCount } from './chart-utils';

type TimeSeriesBucket = {
  period: string;
  tokens: number;
  requests: number;
};

const PERIODS = ['daily', 'weekly', 'monthly'] as const;
type Period = (typeof PERIODS)[number];

function formatPeriodLabel(period: string, periodType: Period): string {
  if (periodType === 'monthly') {
    const d = new Date(period + '-01');
    return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
  }
  const d = new Date(period);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export const UsageTimeSeriesChart: FC<{
  data: TimeSeriesBucket[];
  period: Period;
  onPeriodChange: (p: Period) => void;
}> = ({ data, period, onPeriodChange }) => {
  if (!data.length) {
    return (
      <div className="space-y-2">
        <ChartHeader period={period} onPeriodChange={onPeriodChange} />
        <p className="text-xs text-muted-foreground py-4 text-center">No usage data yet.</p>
      </div>
    );
  }

  const displayed = data.slice(-90);
  const maxVal = Math.max(...displayed.map((d) => d.tokens), 1);

  return (
    <div className="space-y-2">
      <ChartHeader period={period} onPeriodChange={onPeriodChange} />
      <div className="rounded-xl border border-border/40 bg-card/40 p-4">
        <div className="flex items-end gap-[2px]" style={{ height: 140 }}>
          {displayed.map((entry) => {
            const h = Math.max((entry.tokens / maxVal) * 100, 3);
            return (
              <div key={entry.period} className="group relative flex flex-1 flex-col items-center">
                <div
                  className="w-full rounded-t bg-primary/60 transition-all duration-300 hover:bg-primary/80"
                  style={{ height: `${h}%` }}
                />
                <span className="mt-1 text-[7px] text-muted-foreground truncate w-full text-center">
                  {formatPeriodLabel(entry.period, period)}
                </span>
                {/* Hover tooltip */}
                <div className="pointer-events-none absolute -top-10 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 rounded bg-popover px-2 py-1 text-[10px] shadow-lg border border-border/40 whitespace-nowrap z-10 transition-opacity">
                  <span className="font-medium">{formatTokenCount(entry.tokens)} tok</span>
                  <span className="text-muted-foreground"> · {entry.requests} req</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

const ChartHeader: FC<{
  period: Period;
  onPeriodChange: (p: Period) => void;
}> = ({ period, onPeriodChange }) => (
  <div className="flex items-center justify-between">
    <h4 className="text-xs font-medium text-muted-foreground">Tokens Over Time</h4>
    <div className="flex gap-1">
      {PERIODS.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onPeriodChange(p)}
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
);
