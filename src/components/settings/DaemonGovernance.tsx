import { useState, useEffect, useCallback, type FC } from 'react';
import {
  RefreshCwIcon,
  LoaderIcon,
  WifiOffIcon,
  CheckIcon,
  XIcon,
} from 'lucide-react';
import { type SettingsProps } from './shared';
import { app } from '@/lib/ipc-client';

type LoadState = 'idle' | 'loading' | 'loaded' | 'error';
type ApprovalStatus = 'pending' | 'approved' | 'rejected' | string;

interface Approval {
  id: string;
  type: string;
  requester: string;
  tenant: string;
  status: ApprovalStatus;
  created_at?: string;
  [key: string]: unknown;
}

const StatusBadge: FC<{ status: ApprovalStatus }> = ({ status }) => {
  const styles: Record<string, string> = {
    pending: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20',
    approved: 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20',
    rejected: 'bg-destructive/10 text-destructive border-destructive/20',
  };
  const style = styles[status] ?? 'bg-muted/50 text-muted-foreground border-border/40';
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium border ${style}`}>
      {status}
    </span>
  );
};

const ApprovalRow: FC<{
  approval: Approval;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  actionPending: boolean;
}> = ({ approval, onApprove, onReject, actionPending }) => {
  const isPending = approval.status === 'pending';

  return (
    <div className="rounded-lg border p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium">{approval.type}</span>
            <StatusBadge status={approval.status} />
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[10px] text-muted-foreground">
              Requester: <span className="font-mono">{approval.requester}</span>
            </span>
            <span className="text-[10px] text-muted-foreground">
              Tenant: <span className="font-mono">{approval.tenant}</span>
            </span>
          </div>
          {approval.created_at && (
            <p className="text-[10px] text-muted-foreground">{approval.created_at}</p>
          )}
        </div>

        {isPending && (
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => onApprove(approval.id)}
              disabled={actionPending}
              title="Approve"
              className="flex items-center gap-1 rounded-md border border-green-500/30 bg-green-500/5 px-2 py-1 text-[10px] text-green-700 dark:text-green-400 hover:bg-green-500/15 transition-colors disabled:opacity-50"
            >
              {actionPending
                ? <LoaderIcon className="h-3 w-3 animate-spin" />
                : <CheckIcon className="h-3 w-3" />
              }
              Approve
            </button>
            <button
              type="button"
              onClick={() => onReject(approval.id)}
              disabled={actionPending}
              title="Reject"
              className="flex items-center gap-1 rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1 text-[10px] text-destructive hover:bg-destructive/15 transition-colors disabled:opacity-50"
            >
              {actionPending
                ? <LoaderIcon className="h-3 w-3 animate-spin" />
                : <XIcon className="h-3 w-3" />
              }
              Reject
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export const DaemonGovernance: FC<SettingsProps> = () => {
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [loadError, setLoadError] = useState('');
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');

  const fetchApprovals = useCallback(async () => {
    setLoadState('loading');
    setLoadError('');
    try {
      const result = await app.daemon.governanceApprovals();
      if (result.ok) {
        const raw = result.data;
        const list = Array.isArray(raw) ? raw : Array.isArray((raw as Record<string, unknown>)?.approvals) ? (raw as { approvals: unknown[] }).approvals : [];
        setApprovals(list as Approval[]);
        setLoadState('loaded');
      } else {
        setLoadError(result.error || 'Failed to fetch approvals');
        setLoadState('error');
      }
    } catch (err) {
      setLoadError(String(err));
      setLoadState('error');
    }
  }, []);

  useEffect(() => {
    fetchApprovals();
  }, [fetchApprovals]);

  const handleApprove = useCallback(async (id: string) => {
    setPendingAction(id);
    setActionError('');
    try {
      const result = await app.daemon.governanceApprove(id, { reviewer_id: 'desktop' });
      if (result.ok) {
        setApprovals((prev) =>
          prev.map((a) => (a.id === id ? { ...a, status: 'approved' } : a)),
        );
      } else {
        setActionError(result.error || 'Failed to approve');
      }
    } catch (err) {
      setActionError(String(err));
    } finally {
      setPendingAction(null);
    }
  }, []);

  const handleReject = useCallback(async (id: string) => {
    setPendingAction(id);
    setActionError('');
    try {
      const result = await app.daemon.governanceReject(id, { reviewer_id: 'desktop' });
      if (result.ok) {
        setApprovals((prev) =>
          prev.map((a) => (a.id === id ? { ...a, status: 'rejected' } : a)),
        );
      } else {
        setActionError(result.error || 'Failed to reject');
      }
    } catch (err) {
      setActionError(String(err));
    } finally {
      setPendingAction(null);
    }
  }, []);

  if (loadState === 'idle' || loadState === 'loading') {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-8 justify-center">
        <LoaderIcon className="h-4 w-4 animate-spin" />
        Loading governance approvals...
      </div>
    );
  }

  if (loadState === 'error') {
    return (
      <div className="space-y-4">
        <h3 className="text-sm font-semibold">Governance</h3>
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 space-y-3">
          <div className="flex items-start gap-2">
            <WifiOffIcon className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-medium text-destructive">Failed to load approvals</p>
              <p className="text-[10px] text-muted-foreground mt-1">{loadError}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={fetchApprovals}
            className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs hover:bg-muted transition-colors"
          >
            <RefreshCwIcon className="h-3 w-3" />
            Retry
          </button>
        </div>
      </div>
    );
  }

  const pendingCount = approvals.filter((a) => a.status === 'pending').length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">Governance</h3>
          {pendingCount > 0 && (
            <span className="inline-flex rounded-full bg-amber-500/20 border border-amber-500/30 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
              {pendingCount} pending
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={fetchApprovals}
          className="flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] hover:bg-muted transition-colors"
        >
          <RefreshCwIcon className="h-3 w-3" />
          Refresh
        </button>
      </div>

      {actionError && (
        <p className="text-[10px] text-destructive">{actionError}</p>
      )}

      {approvals.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">No approvals found.</p>
      ) : (
        <div className="space-y-2">
          {approvals.map((approval) => (
            <ApprovalRow
              key={approval.id}
              approval={approval}
              onApprove={handleApprove}
              onReject={handleReject}
              actionPending={pendingAction === approval.id}
            />
          ))}
        </div>
      )}
    </div>
  );
};
