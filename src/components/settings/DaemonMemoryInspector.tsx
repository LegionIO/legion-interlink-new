import { useState, useEffect, useCallback, useRef, type FC } from 'react';
import { BrainCircuitIcon, RefreshCwIcon, Loader2Icon, AlertCircleIcon, TrashIcon, SearchIcon, PencilIcon, CheckIcon, XIcon } from 'lucide-react';
import type { SettingsProps } from './shared';
import { legion } from '@/lib/ipc-client';

interface MemoryEntry {
  id: string;
  type: string;
  content: string;
  metadata?: Record<string, unknown>;
  score?: number;
  created_at?: string;
  updated_at?: string;
  tags?: string[];
  source?: string;
}

interface MemoryStats {
  working?: number;
  observational?: number;
  semantic?: number;
  total?: number;
  embedding_model?: string;
  dimensions?: number;
}

const STORE_TYPES = ['all', 'working', 'observational', 'semantic'] as const;

export const DaemonMemoryInspector: FC<SettingsProps> = () => {
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [storeFilter, setStoreFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(debounceRef.current);
  }, [search]);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    const filters: Record<string, string> = { limit: '100' };
    if (storeFilter !== 'all') filters.type = storeFilter;
    if (debouncedSearch) filters.query = debouncedSearch;

    const [entriesRes, statsRes] = await Promise.all([
      legion.daemon.memoryEntries(filters),
      legion.daemon.memoryStats(),
    ]);

    if (entriesRes.ok && entriesRes.data) {
      const data = Array.isArray(entriesRes.data) ? entriesRes.data : (entriesRes.data as { entries?: MemoryEntry[] }).entries || [];
      setEntries(data as MemoryEntry[]);
      setError(null);
    } else {
      setError(entriesRes.error || 'Failed to fetch memories');
    }

    if (statsRes.ok && statsRes.data) {
      setStats(statsRes.data as MemoryStats);
    }

    setLoading(false);
  }, [storeFilter, debouncedSearch]);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  const handleDelete = async (id: string) => {
    await legion.daemon.memoryEntryDelete(id);
    setEntries((prev) => prev.filter((e) => e.id !== id));
    if (expanded === id) setExpanded(null);
  };

  const handleSaveEdit = async (id: string) => {
    await legion.daemon.memoryEntryUpdate(id, { content: editContent });
    setEntries((prev) => prev.map((e) => e.id === id ? { ...e, content: editContent } : e));
    setEditing(null);
  };

  if (loading) return <div className="flex justify-center py-12"><Loader2Icon className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (error && entries.length === 0) return (
    <div className="flex flex-col items-center gap-4 py-12">
      <AlertCircleIcon className="h-8 w-8 text-muted-foreground/40" />
      <p className="text-sm text-muted-foreground">{error}</p>
      <button type="button" onClick={fetchEntries} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Retry</button>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BrainCircuitIcon className="h-5 w-5 text-primary" />
          <h3 className="text-sm font-semibold">Memory Inspector</h3>
        </div>
        <button type="button" onClick={fetchEntries} className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted/50">
          <RefreshCwIcon className="h-4 w-4" />
        </button>
      </div>

      {/* Stats cards */}
      {stats && (
        <div className="grid grid-cols-4 gap-3">
          {(['working', 'observational', 'semantic'] as const).map((type) => (
            <div key={type} className="rounded-lg border border-border/50 bg-card/30 p-3">
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{type}</p>
              <p className="mt-1 text-lg font-bold">{stats[type] ?? '—'}</p>
            </div>
          ))}
          <div className="rounded-lg border border-border/50 bg-card/30 p-3">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Total</p>
            <p className="mt-1 text-lg font-bold">{stats.total ?? '—'}</p>
            {stats.embedding_model && <p className="text-[10px] text-muted-foreground">{stats.embedding_model}</p>}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <SearchIcon className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search memories..."
            className="w-full rounded-lg border border-border/50 bg-card/50 py-2 pl-9 pr-3 text-xs outline-none placeholder:text-muted-foreground/60 focus:border-primary/50"
          />
        </div>
        <div className="flex gap-1">
          {STORE_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => setStoreFilter(type)}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${storeFilter === type ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {type === 'all' ? 'All' : type.charAt(0).toUpperCase() + type.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Entries */}
      <div className="space-y-2">
        {entries.length === 0 ? (
          <p className="py-8 text-center text-xs text-muted-foreground">No memory entries found</p>
        ) : entries.map((entry) => (
          <div key={entry.id} className="rounded-lg border border-border/50 bg-card/30 overflow-hidden">
            <button
              type="button"
              className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-card/50 transition-colors"
              onClick={() => setExpanded(expanded === entry.id ? null : entry.id)}
            >
              <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                entry.type === 'working' ? 'bg-blue-400' :
                entry.type === 'observational' ? 'bg-amber-400' :
                entry.type === 'semantic' ? 'bg-purple-400' : 'bg-gray-400'
              }`} />
              <div className="min-w-0 flex-1">
                <p className="text-xs line-clamp-2">{entry.content}</p>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                  <span className="rounded bg-muted/50 px-1.5 py-0.5">{entry.type}</span>
                  {entry.score != null && <span>score: {entry.score.toFixed(3)}</span>}
                  {entry.source && <span>{entry.source}</span>}
                  {entry.created_at && <span>{new Date(entry.created_at).toLocaleDateString()}</span>}
                </div>
                {entry.tags?.length ? (
                  <div className="mt-1 flex gap-1">
                    {entry.tags.slice(0, 5).map((t) => (
                      <span key={t} className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] text-primary">{t}</span>
                    ))}
                  </div>
                ) : null}
              </div>
            </button>
            {expanded === entry.id && (
              <div className="border-t border-border/30 px-4 py-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] text-muted-foreground select-all">{entry.id}</span>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => { setEditing(entry.id); setEditContent(entry.content); }}
                      className="rounded-md p-1 text-muted-foreground hover:bg-muted/50"
                      title="Edit"
                    >
                      <PencilIcon className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(entry.id)}
                      className="rounded-md p-1 text-red-400 hover:bg-red-500/10"
                      title="Delete"
                    >
                      <TrashIcon className="h-3 w-3" />
                    </button>
                  </div>
                </div>
                {editing === entry.id ? (
                  <div className="space-y-2">
                    <textarea
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      className="w-full rounded border border-border/50 bg-card/50 p-2 text-xs outline-none focus:border-primary/50"
                      rows={4}
                    />
                    <div className="flex gap-2">
                      <button type="button" onClick={() => handleSaveEdit(entry.id)} className="flex items-center gap-1 rounded bg-primary px-2 py-1 text-[10px] text-primary-foreground"><CheckIcon className="h-3 w-3" />Save</button>
                      <button type="button" onClick={() => setEditing(null)} className="flex items-center gap-1 rounded border px-2 py-1 text-[10px]"><XIcon className="h-3 w-3" />Cancel</button>
                    </div>
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap text-xs">{entry.content}</p>
                )}
                {entry.metadata && Object.keys(entry.metadata).length > 0 && (
                  <div>
                    <span className="text-[10px] text-muted-foreground">Metadata</span>
                    <pre className="mt-1 max-h-24 overflow-auto rounded border border-border/30 bg-muted/20 p-2 text-[10px] font-mono">{JSON.stringify(entry.metadata, null, 2)}</pre>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
