import { useState, useEffect, useCallback, type FC } from 'react';
import {
  RefreshCwIcon,
  LoaderIcon,
  WifiOffIcon,
  TrendingUpIcon,
} from 'lucide-react';
import { type SettingsProps } from './shared';
import { legion } from '@/lib/ipc-client';

type LoadState = 'idle' | 'loading' | 'loaded' | 'error';
type ForecastState = 'idle' | 'loading' | 'loaded' | 'error';

interface CapacityData {
  total_workers: number;
  active_workers: number;
  available_slots: number;
  utilization_percent: number;
  [key: string]: unknown;
}

interface ForecastEntry {
  date: string;
  projected_workers?: number;
  projected_utilization?: number;
  [key: string]: unknown;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' ? value : fallback;
}

const UtilizationBar: FC<{ percent: number }> = ({ percent }) => {
  const clamped = Math.min(100, Math.max(0, percent));
  const color =
    clamped >= 90
      ? 'bg-red-500'
      : clamped >= 70
      ? 'bg-amber-500'
      : 'bg-green-500';

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground">Utilization</span>
        <span className="text-[10px] font-mono font-medium">{clamped.toFixed(1)}%</span>
      </div>
      <div className="h-2 rounded-full bg-muted/50 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
};

export const DaemonCapacity: FC<SettingsProps> = () => {
  const [capacity, setCapacity] = useState<CapacityData | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [loadError, setLoadError] = useState('');

  const [forecast, setForecast] = useState<ForecastEntry[]>([]);
  const [forecastState, setForecastState] = useState<ForecastState>('idle');
  const [forecastError, setForecastError] = useState('');

  const fetchCapacity = useCallback(async () => {
    setLoadState('loading');
    setLoadError('');
    try {
      const result = await legion.daemon.capacity();
      if (result.ok) {
        setCapacity(result.data as CapacityData);
        setLoadState('loaded');
      } else {
        setLoadError(result.error || 'Failed to fetch capacity');
        setLoadState('error');
      }
    } catch (err) {
      setLoadError(String(err));
      setLoadState('error');
    }
  }, []);

  const fetchForecast = useCallback(async () => {
    setForecastState('loading');
    setForecastError('');
    try {
      const result = await legion.daemon.capacityForecast({ days: '7' });
      if (result.ok) {
        setForecast((result.data as ForecastEntry[]) ?? []);
        setForecastState('loaded');
      } else {
        setForecastError(result.error || 'Failed to fetch forecast');
        setForecastState('error');
      }
    } catch (err) {
      setForecastError(String(err));
      setForecastState('error');
    }
  }, []);

  useEffect(() => {
    fetchCapacity();
  }, [fetchCapacity]);

  if (loadState === 'idle' || loadState === 'loading') {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-8 justify-center">
        <LoaderIcon className="h-4 w-4 animate-spin" />
        Loading capacity...
      </div>
    );
  }

  if (loadState === 'error') {
    return (
      <div className="space-y-4">
        <h3 className="text-sm font-semibold">Capacity</h3>
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 space-y-3">
          <div className="flex items-start gap-2">
            <WifiOffIcon className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-medium text-destructive">Failed to load capacity</p>
              <p className="text-[10px] text-muted-foreground mt-1">{loadError}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={fetchCapacity}
            className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs hover:bg-muted transition-colors"
          >
            <RefreshCwIcon className="h-3 w-3" />
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!capacity) return null;

  const totalWorkers = asNumber(capacity.total_workers);
  const activeWorkers = asNumber(capacity.active_workers);
  const availableSlots = asNumber(capacity.available_slots);
  const utilizationPercent = asNumber(capacity.utilization_percent);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Capacity</h3>
        <button
          type="button"
          onClick={fetchCapacity}
          className="flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] hover:bg-muted transition-colors"
        >
          <RefreshCwIcon className="h-3 w-3" />
          Refresh
        </button>
      </div>

      {/* Overview cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border p-3 space-y-1">
          <p className="text-[10px] text-muted-foreground">Total Workers</p>
          <p className="text-xl font-semibold font-mono">{totalWorkers}</p>
        </div>
        <div className="rounded-lg border p-3 space-y-1">
          <p className="text-[10px] text-muted-foreground">Active</p>
          <p className="text-xl font-semibold font-mono">{activeWorkers}</p>
        </div>
        <div className="rounded-lg border p-3 space-y-1">
          <p className="text-[10px] text-muted-foreground">Available Slots</p>
          <p className="text-xl font-semibold font-mono">{availableSlots}</p>
        </div>
      </div>

      <UtilizationBar percent={utilizationPercent} />

      {/* Forecast */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold">7-Day Forecast</p>
          <button
            type="button"
            onClick={fetchForecast}
            disabled={forecastState === 'loading'}
            className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[10px] hover:bg-muted transition-colors disabled:opacity-50"
          >
            {forecastState === 'loading'
              ? <LoaderIcon className="h-3 w-3 animate-spin" />
              : <TrendingUpIcon className="h-3 w-3" />
            }
            Forecast
          </button>
        </div>

        {forecastState === 'error' && (
          <p className="text-[10px] text-destructive">{forecastError}</p>
        )}

        {forecastState === 'loaded' && forecast.length > 0 && (
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/40">
                <tr>
                  <th className="px-3 py-2 text-left text-[10px] font-medium text-muted-foreground">Date</th>
                  <th className="px-3 py-2 text-right text-[10px] font-medium text-muted-foreground">Workers</th>
                  <th className="px-3 py-2 text-right text-[10px] font-medium text-muted-foreground">Utilization</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {forecast.map((entry, i) => (
                  <tr key={i} className="hover:bg-muted/20">
                    <td className="px-3 py-1.5 font-mono text-[10px]">{entry.date}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-[10px]">
                      {entry.projected_workers ?? '—'}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono text-[10px]">
                      {entry.projected_utilization !== undefined
                        ? `${entry.projected_utilization.toFixed(1)}%`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {forecastState === 'loaded' && forecast.length === 0 && (
          <p className="text-[10px] text-muted-foreground italic">No forecast data available.</p>
        )}
      </div>
    </div>
  );
};
