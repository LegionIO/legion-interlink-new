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

interface TenantDetail extends Tenant {
  created_at?: string;
  updated_at?: string;
  description?: string;
  owner?: string;
  tags?: string[];
  settings?: Record<string, unknown>;
  [key: string]: unknown;
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
  const [detailState, setDetailState] = useState<LoadState>('idle');
  const [detailError, setDetailError] = useState('');
  const [detail, setDetail] = useState<TenantDetail | null>(null);

  const fetchDetail = useCallback(async () => {
    setDetailState('loading');
    setDetailError('');
    try {
      const result = await legion.daemon.tenant(tenant.tenant_id);
      if (result.ok) {
        setDetail((result.data as TenantDetail) ?? null);
        setDetailState('loaded');
      } else {
        setDetailError(result.error ?? 'Failed to fetch tenant details');
        setDetailState('error');
      }
    } catch (err) {
      setDetailError(String(err));
      setDetailState('error');
    }
  }, [tenant.tenant_id]);

  const handleToggle = useCallback(() => {
    setExpanded((v) => {
      const next = !v;
      if (next && detailState === 'idle') {
        void fetchDetail();
      }
      return next;
    });
  }, [detailState, fetchDetail]);

  // Merge list-level data with detail data so all fields are available
  const merged: TenantDetail = { ...tenant, ...(detail ?? {}) };
  const quota = merged.quota;

  // Extra fields from detail (exclude known base fields already displayed above)
  const knownKeys = new Set([
    'tenant_id', 'name', 'max_workers', 'worker_count', 'status', 'quota',
    'owner', 'description', 'created_at', 'updated_at', 'tags', 'settings',
  ]);
  const extraEntries = Object.entries(merged).filter(
    ([k, v]) => !knownKeys.has(k) && v !== undefined && v !== null,
  );

  return (
    <div className="rounded-lg border overflow-hidden">
      <button
        type="button"
        onClick={handleToggle}
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
          {detailState === 'loading' && (
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground py-1">
              <LoaderIcon className="h-3 w-3 animate-spin shrink-0" />
              Loading details...
            </div>
          )}

          {detailState === 'error' && (
            <div className="flex items-start gap-1.5">
              <WifiOffIcon className="h-3 w-3 text-destructive shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-[10px] text-destructive">Failed to load details</p>
                <p className="text-[10px] text-muted-foreground truncate">{detailError}</p>
              </div>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); void fetchDetail(); }}
                className="ml-auto shrink-0 rounded border px-2 py-0.5 text-[10px] hover:bg-muted transition-colors"
              >
                Retry
              </button>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[10px] text-muted-foreground mb-0.5">Max Workers</p>
              <p className="text-xs font-mono">{merged.max_workers}</p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground mb-0.5">Active Workers</p>
              <p className="text-xs font-mono">{merged.worker_count ?? '—'}</p>
            </div>
            {merged.owner !== undefined && (
              <div>
                <p className="text-[10px] text-muted-foreground mb-0.5">Owner</p>
                <p className="text-xs font-mono truncate">{String(merged.owner)}</p>
              </div>
            )}
            {merged.description !== undefined && (
              <div className="col-span-2">
                <p className="text-[10px] text-muted-foreground mb-0.5">Description</p>
                <p className="text-xs">{String(merged.description)}</p>
              </div>
            )}
            {merged.created_at !== undefined && (
              <div>
                <p className="text-[10px] text-muted-foreground mb-0.5">Created</p>
                <p className="text-xs font-mono">{String(merged.created_at)}</p>
              </div>
            )}
            {merged.updated_at !== undefined && (
              <div>
                <p className="text-[10px] text-muted-foreground mb-0.5">Updated</p>
                <p className="text-xs font-mono">{String(merged.updated_at)}</p>
              </div>
            )}
          </div>

          {merged.tags !== undefined && merged.tags.length > 0 && (
            <div>
              <p className="text-[10px] text-muted-foreground mb-1">Tags</p>
              <div className="flex flex-wrap gap-1">
                {merged.tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex rounded-full px-2 py-0.5 text-[10px] border bg-muted/30"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {quota && (
            <div>
              <p className="text-[10px] text-muted-foreground mb-1">Quota</p>
              <div className="grid grid-cols-2 gap-3">
                {quota.max_tasks !== undefined && (
                  <div>
                    <p className="text-[10px] text-muted-foreground mb-0.5">Max Tasks</p>
                    <p className="text-xs font-mono">{quota.max_tasks}</p>
                  </div>
                )}
                {quota.used_tasks !== undefined && (
                  <div>
                    <p className="text-[10px] text-muted-foreground mb-0.5">Used Tasks</p>
                    <p className="text-xs font-mono">{quota.used_tasks}</p>
                  </div>
                )}
                {Object.entries(quota)
                  .filter(([k]) => k !== 'max_tasks' && k !== 'used_tasks')
                  .map(([k, v]) => (
                    <div key={k}>
                      <p className="text-[10px] text-muted-foreground mb-0.5 capitalize">{k.replace(/_/g, ' ')}</p>
                      <p className="text-xs font-mono">{String(v)}</p>
                    </div>
                  ))
                }
              </div>
            </div>
          )}

          {merged.settings !== undefined && (
            <div>
              <p className="text-[10px] text-muted-foreground mb-1">Settings</p>
              <pre className="text-[10px] font-mono bg-muted/30 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
                {JSON.stringify(merged.settings, null, 2)}
              </pre>
            </div>
          )}

          {extraEntries.length > 0 && (
            <div>
              <p className="text-[10px] text-muted-foreground mb-1">Additional Fields</p>
              <div className="grid grid-cols-2 gap-3">
                {extraEntries.map(([k, v]) => (
                  <div key={k} className={typeof v === 'object' ? 'col-span-2' : ''}>
                    <p className="text-[10px] text-muted-foreground mb-0.5 capitalize">{k.replace(/_/g, ' ')}</p>
                    <p className="text-xs font-mono break-all">
                      {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                    </p>
                  </div>
                ))}
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
