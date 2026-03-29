import { useState, useEffect, useCallback, type FC } from 'react';
import {
  RefreshCwIcon,
  LoaderIcon,
  WifiOffIcon,
  ChevronDownIcon,
  ChevronRightIcon,
} from 'lucide-react';
import { type SettingsProps } from './shared';
import { legion } from '@/lib/ipc-client';

type LoadState = 'idle' | 'loading' | 'loaded' | 'error';

interface TenantQuota {
  max_tasks?: number;
  used_tasks?: number;
  [key: string]: unknown;
}

interface Tenant {
  tenant_id: string;
  name: string;
  max_workers: number;
  worker_count?: number;
  status: 'active' | 'suspended' | string;
  quota?: TenantQuota;
}

const StatusBadge: FC<{ status: string }> = ({ status }) => {
  const isActive = status === 'active';
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium border ${
      isActive
        ? 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20'
        : 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20'
    }`}>
      {status}
    </span>
  );
};

const TenantCard: FC<{ tenant: Tenant }> = ({ tenant }) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-muted/40 transition-colors text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          {expanded
            ? <ChevronDownIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            : <ChevronRightIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          }
          <div className="min-w-0">
            <p className="text-xs font-medium truncate">{tenant.name}</p>
            <p className="text-[10px] text-muted-foreground font-mono">{tenant.tenant_id}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-2">
          <span className="text-[10px] text-muted-foreground">
            {tenant.max_workers} workers
          </span>
          <StatusBadge status={tenant.status} />
        </div>
      </button>

      {expanded && (
        <div className="border-t px-3 py-2.5 space-y-2 bg-muted/10">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[10px] text-muted-foreground mb-0.5">Max Workers</p>
              <p className="text-xs font-mono">{tenant.max_workers}</p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground mb-0.5">Active Workers</p>
              <p className="text-xs font-mono">{tenant.worker_count ?? '—'}</p>
            </div>
          </div>
          {tenant.quota && (
            <div>
              <p className="text-[10px] text-muted-foreground mb-1">Quota</p>
              <div className="grid grid-cols-2 gap-3">
                {tenant.quota.max_tasks !== undefined && (
                  <div>
                    <p className="text-[10px] text-muted-foreground mb-0.5">Max Tasks</p>
                    <p className="text-xs font-mono">{tenant.quota.max_tasks}</p>
                  </div>
                )}
                {tenant.quota.used_tasks !== undefined && (
                  <div>
                    <p className="text-[10px] text-muted-foreground mb-0.5">Used Tasks</p>
                    <p className="text-xs font-mono">{tenant.quota.used_tasks}</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export const DaemonTenants: FC<SettingsProps> = () => {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [loadError, setLoadError] = useState('');

  const fetchTenants = useCallback(async () => {
    setLoadState('loading');
    setLoadError('');
    try {
      const result = await legion.daemon.tenants();
      if (result.ok) {
        setTenants((result.data as Tenant[]) ?? []);
        setLoadState('loaded');
      } else {
        setLoadError(result.error || 'Failed to fetch tenants');
        setLoadState('error');
      }
    } catch (err) {
      setLoadError(String(err));
      setLoadState('error');
    }
  }, []);

  useEffect(() => {
    fetchTenants();
  }, [fetchTenants]);

  if (loadState === 'idle' || loadState === 'loading') {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-8 justify-center">
        <LoaderIcon className="h-4 w-4 animate-spin" />
        Loading tenants...
      </div>
    );
  }

  if (loadState === 'error') {
    return (
      <div className="space-y-4">
        <h3 className="text-sm font-semibold">Tenants</h3>
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 space-y-3">
          <div className="flex items-start gap-2">
            <WifiOffIcon className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-medium text-destructive">Failed to load tenants</p>
              <p className="text-[10px] text-muted-foreground mt-1">{loadError}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={fetchTenants}
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
        <h3 className="text-sm font-semibold">Tenants</h3>
        <button
          type="button"
          onClick={fetchTenants}
          className="flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] hover:bg-muted transition-colors"
        >
          <RefreshCwIcon className="h-3 w-3" />
          Refresh
        </button>
      </div>

      {tenants.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">No tenants configured.</p>
      ) : (
        <div className="space-y-2">
          {tenants.map((tenant) => (
            <TenantCard key={tenant.tenant_id} tenant={tenant} />
          ))}
        </div>
      )}
    </div>
  );
};
