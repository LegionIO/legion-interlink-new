import { useState, useEffect, useCallback } from 'react';
import { PuzzleIcon, StoreIcon, PackageIcon, XIcon, RefreshCwIcon, AlertCircleIcon, Loader2Icon } from 'lucide-react';
import { legion } from '@/lib/ipc-client';
import { BrowseTab } from './BrowseTab';
import { InstalledTab } from './InstalledTab';

type MarketplaceTab = 'browse' | 'installed';

const tabs: { key: MarketplaceTab; label: string; icon: typeof StoreIcon }[] = [
  { key: 'browse', label: 'Browse', icon: StoreIcon },
  { key: 'installed', label: 'Installed', icon: PackageIcon },
];

interface Props {
  onClose: () => void;
}

export function MarketplacePanel({ onClose }: Props) {
  const [activeTab, setActiveTab] = useState<MarketplaceTab>('browse');
  const [daemonOk, setDaemonOk] = useState<boolean | null>(null);
  const [statusText, setStatusText] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  const checkDaemon = useCallback(async () => {
    const result = await legion.daemon.catalog();
    setDaemonOk(result.ok);
    if (result.ok && result.data) {
      const count = Array.isArray(result.data) ? result.data.length : 0;
      setStatusText(`${count} extensions loaded`);
    } else {
      setStatusText(result.error || 'Unavailable');
    }
  }, []);

  useEffect(() => { checkDaemon(); }, [checkDaemon]);

  const handleInstalled = () => {
    setRefreshKey((k) => k + 1);
    checkDaemon();
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/50 px-6 py-4">
        <div className="flex items-center gap-3">
          <PuzzleIcon className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold">Extensions</h1>
          {daemonOk !== null && (
            <span className={`flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${daemonOk ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${daemonOk ? 'bg-emerald-400' : 'bg-red-400'}`} />
              {statusText}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={checkDaemon} className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted/50" title="Refresh status">
            <RefreshCwIcon className="h-4 w-4" />
          </button>
          <button type="button" onClick={onClose} className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted/50" title="Close">
            <XIcon className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border/50 px-6">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setActiveTab(key)}
            className={`flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${
              activeTab === key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {!daemonOk && daemonOk !== null ? (
          <div className="flex flex-col items-center justify-center gap-4 p-12 text-center">
            <AlertCircleIcon className="h-10 w-10 text-muted-foreground/50" />
            <div>
              <p className="font-medium text-foreground">Daemon not connected</p>
              <p className="mt-1 text-sm text-muted-foreground">Extension management requires the Legion daemon to be running.</p>
            </div>
            <button type="button" onClick={checkDaemon} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">
              Retry
            </button>
          </div>
        ) : daemonOk === null ? (
          <div className="flex items-center justify-center p-12">
            <Loader2Icon className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {activeTab === 'browse' && <BrowseTab key={refreshKey} onInstalled={handleInstalled} />}
            {activeTab === 'installed' && <InstalledTab key={refreshKey} />}
          </>
        )}
      </div>
    </div>
  );
}
