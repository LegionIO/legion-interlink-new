import { useState, useEffect, useCallback, type FC } from 'react';
import { RefreshCwIcon, LoaderIcon, WifiOffIcon, ChevronDownIcon, ChevronRightIcon, PauseIcon, PlayIcon, ArchiveIcon, XCircleIcon } from 'lucide-react';
import type { SettingsProps } from './shared';
import { legion } from '@/lib/ipc-client';

type LoadState = 'idle' | 'loading' | 'loaded' | 'error';

type Worker = {
  id: string;
  name: string;
  extension: string;
  lifecycle_state: string;
  health_status?: string;
  risk_tier?: string;
  last_heartbeat?: string;
  owner?: string;
  team?: string;
  entra_app_id?: string;
  trust_score?: number;
};

type WorkerDetail = Worker & {
  costs?: Record<string, unknown>;
};

const LIFECYCLE_BADGE: Record<string, string> = {
  bootstrap: 'bg-muted/50 text-muted-foreground border border-border/40',
  active:    'bg-green-500/10 text-green-700 dark:text-green-400 border border-green-500/20',
  paused:    'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border border-yellow-500/20',
  retired:   'bg-orange-500/10 text-orange-700 dark:text-orange-400 border border-orange-500/20',
  terminated:'bg-red-500/10 text-red-700 dark:text-red-400 border border-red-500/20',
};

const LifecycleBadge: FC<{ state: string }> = ({ state }) => {
  const cls = LIFECYCLE_BADGE[state] ?? LIFECYCLE_BADGE.bootstrap;
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${cls}`}>
      {state}
    </span>
  );
};

type LifecycleAction = 'pause' | 'resume' | 'retire' | 'terminate';

const WorkerCard: FC<{ worker: Worker }> = ({ worker }) => {
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<WorkerDetail | null>(null);
  const [detailState, setDetailState] = useState<LoadState>('idle');
  const [actionPending, setActionPending] = useState<LifecycleAction | null>(null);
  const [confirmAction, setConfirmAction] = useState<LifecycleAction | null>(null);
  const [actionError, setActionError] = useState('');

  const fetchDetail = useCallback(async () => {
    setDetailState('loading');
    try {
      const [workerRes, costsRes] = await Promise.all([
        legion.daemon.worker(worker.id),
        legion.daemon.workerCosts(worker.id),
      ]);
      const merged: WorkerDetail = {
        ...worker,
        ...((workerRes.ok && workerRes.data ? workerRes.data : {}) as Partial<WorkerDetail>),
        costs: costsRes.ok && costsRes.data ? (costsRes.data as Record<string, unknown>) : undefined,
      };
      setDetail(merged);
      setDetailState('loaded');
    } catch (err) {
      setDetailState('error');
      console.error('Failed to load worker detail:', err);
    }
  }, [worker]);

  const expand = useCallback(async () => {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    if (detail) return;
    await fetchDetail();
  }, [expanded, detail, fetchDetail]);

  const runAction = useCallback(async (action: LifecycleAction) => {
    setConfirmAction(null);
    setActionPending(action);
    setActionError('');
    try {
      const result = await legion.daemon.workerLifecycle(worker.id, { action });
      if (!result.ok) {
        setActionError(result.error ?? `Failed to ${action} worker`);
      } else {
        await fetchDetail();
      }
    } catch (err) {
      setActionError(String(err));
    } finally {
      setActionPending(null);
    }
  }, [worker.id, fetchDetail]);

  const d = detail ?? worker;
  const state = d.lifecycle_state ?? 'bootstrap';

  return (
    <div className="rounded-lg border bg-card/60">
      <button
        type="button"
        onClick={expand}
        className="w-full flex items-start gap-3 px-3 py-2.5 text-left hover:bg-muted/30 transition-colors rounded-lg"
      >
        <span className="mt-0.5 shrink-0 text-muted-foreground">
          {expanded ? <ChevronDownIcon className="h-3.5 w-3.5" /> : <ChevronRightIcon className="h-3.5 w-3.5" />}
        </span>
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold truncate">{worker.name}</span>
            <LifecycleBadge state={worker.lifecycle_state ?? 'bootstrap'} />
            {worker.health_status && (
              <span className="text-[10px] text-muted-foreground">health: {worker.health_status}</span>
            )}
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-[10px] text-muted-foreground font-mono">{worker.extension}</span>
            {worker.risk_tier && (
              <span className="text-[10px] text-muted-foreground">risk: {worker.risk_tier}</span>
            )}
            {worker.last_heartbeat && (
              <span className="text-[10px] text-muted-foreground">
                heartbeat: {worker.last_heartbeat}
              </span>
            )}
          </div>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border/30 px-3 py-2.5 space-y-2">
          {detailState === 'loading' && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
              <LoaderIcon className="h-3 w-3 animate-spin" /> Loading detail...
            </div>
          )}
          {(detailState === 'loaded' || detailState === 'idle') && (
            <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[10px]">
              <DetailRow label="Worker ID" value={d.id} mono />
              {d.owner && <DetailRow label="Owner" value={d.owner} />}
              {d.team && <DetailRow label="Team" value={d.team} />}
              {d.entra_app_id && <DetailRow label="Entra App ID" value={d.entra_app_id} mono />}
              {d.trust_score !== undefined && (
                <DetailRow label="Trust Score" value={String(d.trust_score)} />
              )}
              {detail?.costs && (
                <div className="col-span-2">
                  <span className="text-muted-foreground">Costs: </span>
                  <span className="font-mono">{JSON.stringify(detail.costs)}</span>
                </div>
              )}
            </div>
          )}
          {detailState === 'error' && (
            <p className="text-[10px] text-destructive">Failed to load worker detail.</p>
          )}

          {/* Lifecycle action buttons */}
          {(detailState === 'loaded' || detailState === 'idle') && (
            <div className="pt-1 border-t border-border/20 space-y-1.5">
              <div className="flex items-center gap-1.5 flex-wrap">
                {state === 'active' && (
                  <button
                    type="button"
                    disabled={actionPending !== null}
                    onClick={() => { void runAction('pause'); }}
                    className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs hover:bg-muted transition-colors disabled:opacity-50"
                  >
                    {actionPending === 'pause'
                      ? <LoaderIcon className="h-3 w-3 animate-spin" />
                      : <PauseIcon className="h-3 w-3" />}
                    Pause
                  </button>
                )}
                {state === 'paused' && (
                  <button
                    type="button"
                    disabled={actionPending !== null}
                    onClick={() => { void runAction('resume'); }}
                    className="inline-flex items-center gap-1 rounded-md border border-green-500/30 px-2 py-0.5 text-xs text-green-700 dark:text-green-400 hover:bg-green-500/10 transition-colors disabled:opacity-50"
                  >
                    {actionPending === 'resume'
                      ? <LoaderIcon className="h-3 w-3 animate-spin" />
                      : <PlayIcon className="h-3 w-3" />}
                    Resume
                  </button>
                )}
                {state !== 'retired' && state !== 'terminated' && (
                  confirmAction === 'retire' ? (
                    <span className="inline-flex items-center gap-1">
                      <span className="text-xs text-muted-foreground">Retire?</span>
                      <button
                        type="button"
                        disabled={actionPending !== null}
                        onClick={() => { void runAction('retire'); }}
                        className="inline-flex items-center gap-1 rounded-md border border-orange-500/40 px-2 py-0.5 text-xs text-orange-700 dark:text-orange-400 hover:bg-orange-500/10 transition-colors disabled:opacity-50"
                      >
                        {actionPending === 'retire' ? <LoaderIcon className="h-3 w-3 animate-spin" /> : 'Confirm'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmAction(null)}
                        className="inline-flex items-center rounded-md border px-2 py-0.5 text-xs hover:bg-muted transition-colors"
                      >
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={actionPending !== null}
                      onClick={() => setConfirmAction('retire')}
                      className="inline-flex items-center gap-1 rounded-md border border-orange-500/30 px-2 py-0.5 text-xs text-orange-700 dark:text-orange-400 hover:bg-orange-500/10 transition-colors disabled:opacity-50"
                    >
                      <ArchiveIcon className="h-3 w-3" />
                      Retire
                    </button>
                  )
                )}
                {state !== 'terminated' && (
                  confirmAction === 'terminate' ? (
                    <span className="inline-flex items-center gap-1">
                      <span className="text-xs text-muted-foreground">Terminate?</span>
                      <button
                        type="button"
                        disabled={actionPending !== null}
                        onClick={() => { void runAction('terminate'); }}
                        className="inline-flex items-center gap-1 rounded-md border border-destructive/40 px-2 py-0.5 text-xs text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
                      >
                        {actionPending === 'terminate' ? <LoaderIcon className="h-3 w-3 animate-spin" /> : 'Confirm'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmAction(null)}
                        className="inline-flex items-center rounded-md border px-2 py-0.5 text-xs hover:bg-muted transition-colors"
                      >
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={actionPending !== null}
                      onClick={() => setConfirmAction('terminate')}
                      className="inline-flex items-center gap-1 rounded-md border border-destructive/30 px-2 py-0.5 text-xs text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
                    >
                      <XCircleIcon className="h-3 w-3" />
                      Terminate
                    </button>
                  )
                )}
              </div>
              {actionError && (
                <p className="text-[10px] text-destructive">{actionError}</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const DetailRow: FC<{ label: string; value: string; mono?: boolean }> = ({ label, value, mono }) => (
  <div>
    <span className="text-muted-foreground">{label}: </span>
    <span className={mono ? 'font-mono' : ''}>{value}</span>
  </div>
);

export const DaemonWorkers: FC<SettingsProps> = () => {
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [loadError, setLoadError] = useState('');

  const fetchWorkers = useCallback(async () => {
    setLoadState('loading');
    setLoadError('');
    try {
      const result = await legion.daemon.workers();
      if (result.ok && Array.isArray(result.data)) {
        setWorkers(result.data as Worker[]);
        setLoadState('loaded');
      } else {
        setLoadError(result.error ?? 'Failed to fetch workers');
        setLoadState('error');
      }
    } catch (err) {
      setLoadError(String(err));
      setLoadState('error');
    }
  }, []);

  useEffect(() => {
    fetchWorkers();
  }, [fetchWorkers]);

  if (loadState === 'idle' || loadState === 'loading') {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-8 justify-center">
        <LoaderIcon className="h-4 w-4 animate-spin" />
        Loading workers...
      </div>
    );
  }

  if (loadState === 'error') {
    return (
      <div className="space-y-4">
        <h3 className="text-sm font-semibold">Digital Workers</h3>
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 space-y-3">
          <div className="flex items-start gap-2">
            <WifiOffIcon className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-medium text-destructive">Failed to load workers</p>
              <p className="text-[10px] text-muted-foreground mt-1">{loadError}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={fetchWorkers}
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
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Digital Workers</h3>
        <button
          type="button"
          onClick={fetchWorkers}
          className="flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] hover:bg-muted transition-colors"
        >
          <RefreshCwIcon className="h-3 w-3" />
          Refresh
        </button>
      </div>

      {workers.length === 0 ? (
        <p className="text-xs text-muted-foreground py-4 text-center">No workers registered.</p>
      ) : (
        <div className="space-y-2">
          {workers.map((w) => (
            <WorkerCard key={w.id} worker={w} />
          ))}
        </div>
      )}
    </div>
  );
};
