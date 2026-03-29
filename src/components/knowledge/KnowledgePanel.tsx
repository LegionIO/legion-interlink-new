import { useState, useEffect, useCallback } from 'react';
import { BookOpenIcon, SearchIcon, TableIcon, UploadIcon, FolderSyncIcon, HeartPulseIcon, MagnetIcon, XIcon, RefreshCwIcon, AlertCircleIcon, Loader2Icon } from 'lucide-react';
import { legion } from '@/lib/ipc-client';
import { QueryTab } from './QueryTab';
import { BrowseTab } from './BrowseTab';
import { IngestTab } from './IngestTab';
import { MonitorsTab } from './MonitorsTab';
import { HealthTab } from './HealthTab';
import { AbsorbTab } from './AbsorbTab';
import { KnowledgeDropZone } from './KnowledgeDropZone';

type KnowledgeTab = 'query' | 'browse' | 'ingest' | 'absorb' | 'monitors' | 'health';

const tabs: { key: KnowledgeTab; label: string; icon: typeof SearchIcon }[] = [
  { key: 'query', label: 'Query', icon: SearchIcon },
  { key: 'browse', label: 'Browse', icon: TableIcon },
  { key: 'ingest', label: 'Ingest', icon: UploadIcon },
  { key: 'absorb', label: 'Absorb', icon: MagnetIcon },
  { key: 'monitors', label: 'Monitors', icon: FolderSyncIcon },
  { key: 'health', label: 'Health', icon: HeartPulseIcon },
];

interface Props {
  onClose: () => void;
}

export function KnowledgePanel({ onClose }: Props) {
  const [activeTab, setActiveTab] = useState<KnowledgeTab>('query');
  const [daemonOk, setDaemonOk] = useState<boolean | null>(null);
  const [statusText, setStatusText] = useState('');

  const checkDaemon = useCallback(async () => {
    const result = await legion.knowledge.status();
    setDaemonOk(result.ok);
    if (result.ok && result.data) {
      const d = result.data as { available?: boolean; data_connected?: boolean };
      setStatusText(d.available === true ? 'Connected' : 'Unavailable');
    } else {
      setStatusText(result.error || 'Unavailable');
    }
  }, []);

  useEffect(() => { checkDaemon(); }, [checkDaemon]);

  return (
    <KnowledgeDropZone>
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/50 px-6 py-4">
        <div className="flex items-center gap-3">
          <BookOpenIcon className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold">Knowledge</h1>
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
              <p className="mt-1 text-sm text-muted-foreground">Knowledge features require the Legion daemon to be running.</p>
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
            {activeTab === 'query' && <QueryTab />}
            {activeTab === 'browse' && <BrowseTab />}
            {activeTab === 'ingest' && <IngestTab />}
            {activeTab === 'absorb' && <AbsorbTab />}
            {activeTab === 'monitors' && <MonitorsTab />}
            {activeTab === 'health' && <HealthTab />}
          </>
        )}
      </div>
    </div>
    </KnowledgeDropZone>
  );
}
