import { useState, useEffect, useCallback, type FC } from 'react';
import {
  RefreshCwIcon,
  LoaderIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  Trash2Icon,
} from 'lucide-react';
import { legion } from '@/lib/ipc-client';

const PAGE_SIZE = 50;

interface KnowledgeEntry {
  id: string;
  content: string;
  confidence: number;
  source?: string;
  tags?: string[];
  created_at?: string;
}

type LoadState = 'idle' | 'loading' | 'loaded' | 'error';

function confidenceBadgeClass(confidence: number): string {
  if (confidence >= 0.8) {
    return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20';
  }
  if (confidence >= 0.5) {
    return 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20';
  }
  return 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20';
}

function formatConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

const ConfidenceBadge: FC<{ confidence: number }> = ({ confidence }) => (
  <span
    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium shrink-0 ${confidenceBadgeClass(confidence)}`}
  >
    {formatConfidence(confidence)}
  </span>
);

interface EntryRowProps {
  entry: KnowledgeEntry;
  expanded: boolean;
  onToggle: () => void;
  onDelete: (id: string) => void;
}

const EntryRow: FC<EntryRowProps> = ({ entry, expanded, onToggle, onDelete }) => {
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleting(true);
    try {
      const res = await legion.knowledge.delete(entry.id);
      if (res.ok) {
        onDelete(entry.id);
      }
    } catch {
      // silently ignore — entry stays in list
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div>
      {/* Collapsed row */}
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onToggle(); }}
        className="flex items-start gap-2 px-3 py-2.5 cursor-pointer hover:bg-muted/30 transition-colors"
      >
        {/* Chevron */}
        <span className="text-muted-foreground mt-0.5 shrink-0">
          {expanded
            ? <ChevronDownIcon className="h-3 w-3" />
            : <ChevronRightIcon className="h-3 w-3" />}
        </span>

        {/* Confidence */}
        <ConfidenceBadge confidence={entry.confidence} />

        {/* Content preview */}
        <span className="flex-1 text-xs text-foreground leading-relaxed min-w-0">
          {truncate(entry.content, 80)}
        </span>

        {/* Source */}
        {entry.source && (
          <span className="text-[10px] text-muted-foreground shrink-0 max-w-[100px] truncate" title={entry.source}>
            {entry.source}
          </span>
        )}

        {/* Tags */}
        {entry.tags && entry.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 shrink-0 max-w-[120px]">
            {entry.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="rounded-full border border-border/50 bg-muted/50 px-1.5 py-0.5 text-[10px] text-muted-foreground"
              >
                {tag}
              </span>
            ))}
            {entry.tags.length > 3 && (
              <span className="text-[10px] text-muted-foreground">+{entry.tags.length - 3}</span>
            )}
          </div>
        )}

        {/* Delete button */}
        <button
          type="button"
          onClick={handleDelete}
          disabled={deleting}
          title="Delete entry"
          className="ml-1 shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-500 disabled:opacity-40"
        >
          {deleting
            ? <LoaderIcon className="h-3 w-3 animate-spin" />
            : <Trash2Icon className="h-3 w-3" />}
        </button>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="px-3 pb-3 pt-1 space-y-2 border-t border-border/30 bg-muted/10">
          <pre className="whitespace-pre-wrap rounded-md border border-border/40 bg-muted/30 p-2 text-xs font-mono leading-relaxed max-h-48 overflow-auto">
            {entry.content}
          </pre>
          {entry.created_at && (
            <p className="text-[10px] text-muted-foreground">
              Created: {new Date(entry.created_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export function BrowseTab() {
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [loadError, setLoadError] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchEntries = useCallback(async (tag: string, source: string, pg: number) => {
    setLoadState('loading');
    setLoadError('');
    try {
      const filters: { tag?: string; source?: string; page?: string; per_page?: string } = {
        page: String(pg),
        per_page: String(PAGE_SIZE),
      };
      if (tag.trim()) filters.tag = tag.trim();
      if (source.trim()) filters.source = source.trim();

      const res = await legion.knowledge.browse(filters);
      if (res.ok) {
        const raw = res.data;
        let list: KnowledgeEntry[];
        if (Array.isArray(raw)) {
          list = raw as KnowledgeEntry[];
        } else if (raw && typeof raw === 'object' && 'entries' in (raw as object)) {
          list = ((raw as { entries: unknown }).entries as KnowledgeEntry[]) ?? [];
        } else {
          list = [];
        }
        setEntries(list);
        setLoadState('loaded');
      } else {
        setLoadError(res.error || 'Failed to fetch entries');
        setLoadState('error');
      }
    } catch (err) {
      setLoadError(String(err));
      setLoadState('error');
    }
  }, []);

  // Fetch on mount and whenever filters or page change
  useEffect(() => {
    void fetchEntries(tagFilter, sourceFilter, page);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tagFilter, sourceFilter, page]);

  // Reset to page 1 when filters change
  const handleTagChange = (value: string) => {
    setTagFilter(value);
    setPage(1);
  };

  const handleSourceChange = (value: string) => {
    setSourceFilter(value);
    setPage(1);
  };

  const handleRefresh = () => {
    void fetchEntries(tagFilter, sourceFilter, page);
  };

  const handleDelete = (id: string) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
    if (expandedId === id) setExpandedId(null);
  };

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  const hasPrev = page > 1;
  const hasNext = entries.length === PAGE_SIZE;

  return (
    <div className="space-y-4 p-6">
      {/* Filter bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <input
          type="text"
          value={tagFilter}
          onChange={(e) => handleTagChange(e.target.value)}
          placeholder="Filter by tag…"
          className="rounded-xl border border-border/70 bg-card/80 px-3 py-1.5 text-xs outline-none placeholder:text-muted-foreground/60 min-w-[140px]"
        />
        <input
          type="text"
          value={sourceFilter}
          onChange={(e) => handleSourceChange(e.target.value)}
          placeholder="Filter by source…"
          className="rounded-xl border border-border/70 bg-card/80 px-3 py-1.5 text-xs outline-none placeholder:text-muted-foreground/60 min-w-[140px]"
        />
        <button
          type="button"
          onClick={handleRefresh}
          title="Refresh"
          className="flex items-center gap-1 rounded-md border px-2 py-1.5 text-[10px] hover:bg-muted transition-colors"
        >
          <RefreshCwIcon className={`h-3 w-3 ${loadState === 'loading' ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Loading state */}
      {loadState === 'loading' && (
        <div className="flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground">
          <LoaderIcon className="h-4 w-4 animate-spin" />
          Loading entries…
        </div>
      )}

      {/* Error state */}
      {loadState === 'error' && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4">
          <p className="text-xs font-medium text-red-500">Failed to load entries</p>
          <p className="mt-1 text-[10px] text-muted-foreground">{loadError}</p>
          <button
            type="button"
            onClick={handleRefresh}
            className="mt-3 flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs hover:bg-muted transition-colors"
          >
            <RefreshCwIcon className="h-3 w-3" />
            Retry
          </button>
        </div>
      )}

      {/* Empty state */}
      {loadState === 'loaded' && entries.length === 0 && (
        <p className="py-10 text-center text-xs text-muted-foreground italic">
          No knowledge entries found.
        </p>
      )}

      {/* Entry list */}
      {loadState === 'loaded' && entries.length > 0 && (
        <>
          <div className="rounded-lg border border-border/50 overflow-hidden">
            {/* Column header */}
            <div className="grid grid-cols-[1rem_4rem_1fr_6rem_auto_2rem] gap-x-2 px-3 py-1.5 bg-muted/40 border-b border-border/40 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide items-center">
              <span />
              <span>Score</span>
              <span>Content</span>
              <span>Source</span>
              <span>Tags</span>
              <span />
            </div>
            <div className="divide-y divide-border/30">
              {entries.map((entry) => (
                <EntryRow
                  key={entry.id}
                  entry={entry}
                  expanded={expandedId === entry.id}
                  onToggle={() => toggleExpand(entry.id)}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={!hasPrev}
              className="rounded-md border px-3 py-1.5 text-xs hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Prev
            </button>
            <span className="text-[10px] text-muted-foreground">Page {page}</span>
            <button
              type="button"
              onClick={() => setPage((p) => p + 1)}
              disabled={!hasNext}
              className="rounded-md border px-3 py-1.5 text-xs hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </>
      )}
    </div>
  );
}
