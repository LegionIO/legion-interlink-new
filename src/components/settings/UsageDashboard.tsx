import { useState, useEffect, useCallback, type FC } from 'react';
import { RefreshCwIcon, Loader2Icon, DownloadIcon, AlertTriangleIcon } from 'lucide-react';
import type { SettingsProps } from './shared';
import { app } from '@/lib/ipc-client';
import { UsageSummaryCards } from './usage/UsageSummaryCards';
import { UsageTimeSeriesChart } from './usage/UsageTimeSeriesChart';
import { UsageModelBreakdown } from './usage/UsageModelBreakdown';
import { UsageConversationTable } from './usage/UsageConversationTable';
import { UsageModalityBreakdown } from './usage/UsageModalityBreakdown';

type Period = 'daily' | 'weekly' | 'monthly';

export const UsageDashboard: FC<SettingsProps> = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<Record<string, unknown> | null>(null);
  const [modelData, setModelData] = useState<Record<string, unknown>[]>([]);
  const [timeSeries, setTimeSeries] = useState<Record<string, unknown>[]>([]);
  const [conversations, setConversations] = useState<Record<string, unknown>[]>([]);
  const [convTotal, setConvTotal] = useState(0);
  const [convOffset, setConvOffset] = useState(0);
  const [nonLlmEvents, setNonLlmEvents] = useState<Record<string, unknown>[]>([]);
  const [period, setPeriod] = useState<Period>('daily');
  const [convSortBy, setConvSortBy] = useState('totalTokens');
  const [convSortDir, setConvSortDir] = useState('desc');
  const [convSearch, setConvSearch] = useState('');
  const [exporting, setExporting] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [summaryRes, modelRes, timeRes, convRes, evtRes] = await Promise.all([
        app.usage.summary(),
        app.usage.byModel(),
        app.usage.timeSeries({ period, days: 90 }),
        app.usage.byConversation({
          offset: convOffset,
          limit: 25,
          sortBy: convSortBy,
          sortDir: convSortDir,
          search: convSearch || undefined,
        }),
        app.usage.nonLlmEvents(),
      ]);

      setSummary(summaryRes as Record<string, unknown>);
      setModelData(modelRes as Record<string, unknown>[]);
      setTimeSeries(timeRes as Record<string, unknown>[]);
      const convData = convRes as { conversations: Record<string, unknown>[]; total: number };
      setConversations(convData.conversations ?? []);
      setConvTotal(convData.total ?? 0);
      setNonLlmEvents((evtRes ?? []) as Record<string, unknown>[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load usage data');
    } finally {
      setLoading(false);
    }
  }, [period, convOffset, convSortBy, convSortDir, convSearch]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  // Listen for close-settings event from conversation navigation
  useEffect(() => {
    const handler = () => {
      // The SettingsPanel listens for this too — but in case it doesn't,
      // we don't need to do anything here since navigation already happened
    };
    window.addEventListener('close-settings', handler);
    return () => window.removeEventListener('close-settings', handler);
  }, []);

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      await app.usage.exportCsv();
    } finally {
      setExporting(false);
    }
  }, []);

  const handlePeriodChange = useCallback((p: Period) => {
    setPeriod(p);
  }, []);

  const handleConvPageChange = useCallback((offset: number) => {
    setConvOffset(offset);
  }, []);

  const handleConvSort = useCallback((sortBy: string, sortDir: string) => {
    setConvSortBy(sortBy);
    setConvSortDir(sortDir);
    setConvOffset(0);
  }, []);

  const handleConvSearch = useCallback((query: string) => {
    setConvSearch(query);
    setConvOffset(0);
  }, []);

  if (error && !summary) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Usage</h3>
          <button
            type="button"
            onClick={() => void fetchAll()}
            className="rounded-md p-1 hover:bg-muted/60"
          >
            <RefreshCwIcon className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 text-xs">
          <div className="flex items-center gap-2 text-red-400">
            <AlertTriangleIcon className="h-4 w-4" />
            <span>{error}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Usage</h3>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting || loading}
            className="flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[10px] hover:bg-muted transition-colors disabled:opacity-50"
          >
            <DownloadIcon className="h-3 w-3" />
            Export CSV
          </button>
          <button
            type="button"
            onClick={() => void fetchAll()}
            disabled={loading}
            className="rounded-md p-1 hover:bg-muted/60 disabled:opacity-50"
          >
            <RefreshCwIcon className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {loading && !summary ? (
        <div className="flex items-center justify-center py-12">
          <Loader2Icon className="h-5 w-5 animate-spin text-primary" />
        </div>
      ) : (
        <>
          {/* Summary Cards */}
          {summary && <UsageSummaryCards data={summary as never} />}

          {/* Time Series Chart */}
          <UsageTimeSeriesChart
            data={timeSeries as never[]}
            period={period}
            onPeriodChange={handlePeriodChange}
          />

          {/* Model Breakdown */}
          <UsageModelBreakdown data={modelData as never[]} />

          {/* Conversation Table */}
          <UsageConversationTable
            conversations={conversations as never[]}
            total={convTotal}
            offset={convOffset}
            onPageChange={handleConvPageChange}
            onSort={handleConvSort}
            onSearch={handleConvSearch}
          />

          {/* Non-LLM Modality Breakdown */}
          <UsageModalityBreakdown events={nonLlmEvents as never[]} />
        </>
      )}
    </div>
  );
};
