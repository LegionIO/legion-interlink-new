import { useState, useEffect, useCallback, type FC } from 'react';
import {
  RefreshCwIcon,
  LoaderIcon,
  WifiOffIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react';
import { type SettingsProps } from './shared';
import { legion } from '@/lib/ipc-client';

type LoadState = 'idle' | 'loading' | 'loaded' | 'error';

interface Webhook {
  id: string;
  url: string;
  event_types: string[];
  max_retries: number;
  enabled: boolean;
}

export const DaemonWebhooks: FC<SettingsProps> = () => {
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [loadError, setLoadError] = useState('');

  const [formUrl, setFormUrl] = useState('');
  const [formSecret, setFormSecret] = useState('');
  const [formEvents, setFormEvents] = useState('');
  const [formRetries, setFormRetries] = useState('3');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const fetchWebhooks = useCallback(async () => {
    setLoadState('loading');
    setLoadError('');
    try {
      const result = await legion.daemon.webhooks();
      if (result.ok) {
        setWebhooks((result.data as Webhook[]) ?? []);
        setLoadState('loaded');
      } else {
        setLoadError(result.error || 'Failed to fetch webhooks');
        setLoadState('error');
      }
    } catch (err) {
      setLoadError(String(err));
      setLoadState('error');
    }
  }, []);

  useEffect(() => {
    fetchWebhooks();
  }, [fetchWebhooks]);

  const handleRegister = useCallback(async () => {
    if (!formUrl.trim()) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      const eventTypes = formEvents.split(',').map((s) => s.trim()).filter(Boolean);
      const result = await legion.daemon.webhookCreate({
        url: formUrl.trim(),
        secret: formSecret.trim() || undefined,
        event_types: eventTypes,
        max_retries: parseInt(formRetries, 10) || 3,
      });
      if (result.ok) {
        setFormUrl('');
        setFormSecret('');
        setFormEvents('');
        setFormRetries('3');
        await fetchWebhooks();
      } else {
        setSubmitError(result.error || 'Failed to register webhook');
      }
    } catch (err) {
      setSubmitError(String(err));
    } finally {
      setSubmitting(false);
    }
  }, [formUrl, formSecret, formEvents, formRetries, fetchWebhooks]);

  const handleDelete = useCallback(async (id: string) => {
    try {
      const result = await legion.daemon.webhookDelete(id);
      if (result.ok) {
        setWebhooks((prev) => prev.filter((w) => w.id !== id));
      }
    } catch {
      // silently ignore
    }
  }, []);

  if (loadState === 'idle' || loadState === 'loading') {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-8 justify-center">
        <LoaderIcon className="h-4 w-4 animate-spin" />
        Loading webhooks...
      </div>
    );
  }

  if (loadState === 'error') {
    return (
      <div className="space-y-4">
        <h3 className="text-sm font-semibold">Webhooks</h3>
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 space-y-3">
          <div className="flex items-start gap-2">
            <WifiOffIcon className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-medium text-destructive">Failed to load webhooks</p>
              <p className="text-[10px] text-muted-foreground mt-1">{loadError}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={fetchWebhooks}
            className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs hover:bg-muted transition-colors"
          >
            <RefreshCwIcon className="h-3 w-3" />
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Webhooks</h3>
        <button
          type="button"
          onClick={fetchWebhooks}
          className="flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] hover:bg-muted transition-colors"
        >
          <RefreshCwIcon className="h-3 w-3" />
          Refresh
        </button>
      </div>

      {/* Webhook list */}
      <div className="space-y-2">
        {webhooks.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">No webhooks registered.</p>
        ) : (
          webhooks.map((wh) => (
            <div key={wh.id} className="rounded-lg border p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-1 min-w-0">
                  <p className="text-xs font-mono truncate">{wh.url}</p>
                  <div className="flex flex-wrap gap-1">
                    {wh.event_types.map((ev) => (
                      <span
                        key={ev}
                        className="inline-flex rounded-full border border-border/40 bg-muted/40 px-2 py-0.5 text-[10px] font-mono"
                      >
                        {ev}
                      </span>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground">
                      Max retries: {wh.max_retries}
                    </span>
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium border ${
                      wh.enabled
                        ? 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20'
                        : 'bg-muted/50 text-muted-foreground border-border/40'
                    }`}>
                      {wh.enabled ? 'enabled' : 'disabled'}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleDelete(wh.id)}
                  className="shrink-0 rounded-md border border-destructive/30 p-1.5 text-destructive hover:bg-destructive/10 transition-colors"
                  title="Delete webhook"
                >
                  <Trash2Icon className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Register form */}
      <fieldset className="rounded-lg border p-3 space-y-3">
        <legend className="text-xs font-semibold px-1">Register Webhook</legend>
        <div>
          <label className="text-[10px] text-muted-foreground block mb-0.5">URL *</label>
          <input
            type="url"
            value={formUrl}
            onChange={(e) => setFormUrl(e.target.value)}
            placeholder="https://example.com/hook"
            className="w-full rounded-xl border border-border/40 bg-muted/30 px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground block mb-0.5">Secret (optional)</label>
          <input
            type="password"
            value={formSecret}
            onChange={(e) => setFormSecret(e.target.value)}
            placeholder="Signing secret"
            className="w-full rounded-xl border border-border/40 bg-muted/30 px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground block mb-0.5">Event Types (comma-separated)</label>
          <input
            type="text"
            value={formEvents}
            onChange={(e) => setFormEvents(e.target.value)}
            placeholder="task.complete, task.failed"
            className="w-full rounded-xl border border-border/40 bg-muted/30 px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground block mb-0.5">Max Retries</label>
          <input
            type="number"
            min={0}
            max={10}
            value={formRetries}
            onChange={(e) => setFormRetries(e.target.value)}
            className="w-24 rounded-xl border border-border/40 bg-muted/30 px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        {submitError && (
          <p className="text-[10px] text-destructive">{submitError}</p>
        )}
        <button
          type="button"
          onClick={handleRegister}
          disabled={submitting || !formUrl.trim()}
          className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs hover:bg-muted transition-colors disabled:opacity-50"
        >
          {submitting ? <LoaderIcon className="h-3 w-3 animate-spin" /> : <PlusIcon className="h-3 w-3" />}
          Register Webhook
        </button>
      </fieldset>
    </div>
  );
};
