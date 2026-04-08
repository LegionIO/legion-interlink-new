import { useState, useMemo, useCallback, type FC } from 'react';
import { ChevronUpIcon, ChevronDownIcon, SearchIcon } from 'lucide-react';
import { formatTokenCount, formatDateShort } from './chart-utils';
import { app } from '@/lib/ipc-client';

type ConversationRow = {
  id: string;
  title: string | null;
  modelKey: string | null;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  messageCount: number;
  createdAt: string;
  lastMessageAt: string | null;
};

type SortKey = 'title' | 'modelKey' | 'totalTokens' | 'inputTokens' | 'outputTokens' | 'messageCount' | 'createdAt';

const PAGE_SIZE = 25;

export const UsageConversationTable: FC<{
  conversations: ConversationRow[];
  total: number;
  offset: number;
  onPageChange: (offset: number) => void;
  onSort: (sortBy: string, sortDir: string) => void;
  onSearch: (query: string) => void;
}> = ({ conversations, total, offset, onPageChange, onSort, onSearch }) => {
  const [sortKey, setSortKey] = useState<SortKey>('totalTokens');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [searchInput, setSearchInput] = useState('');
  const [searchTimer, setSearchTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  const handleSort = useCallback(
    (key: SortKey) => {
      const newDir = sortKey === key && sortDir === 'desc' ? 'asc' : 'desc';
      setSortKey(key);
      setSortDir(newDir);
      onSort(key, newDir);
    },
    [sortKey, sortDir, onSort],
  );

  const handleSearchInput = useCallback(
    (value: string) => {
      setSearchInput(value);
      if (searchTimer) clearTimeout(searchTimer);
      setSearchTimer(
        setTimeout(() => {
          onSearch(value);
        }, 400),
      );
    },
    [onSearch, searchTimer],
  );

  const handleNavigate = useCallback(async (conversationId: string) => {
    try {
      await app.conversations.setActiveId(conversationId);
      window.dispatchEvent(new CustomEvent('close-settings'));
    } catch {
      // Ignore navigation errors
    }
  }, []);

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  const SortHeader: FC<{ label: string; field: SortKey; className?: string }> = useMemo(
    () =>
      function SortHeaderInner({ label, field, className }) {
        const active = sortKey === field;
        return (
          <button
            type="button"
            onClick={() => handleSort(field)}
            className={`flex items-center gap-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground transition-colors ${className ?? ''}`}
          >
            {label}
            {active &&
              (sortDir === 'asc' ? (
                <ChevronUpIcon className="h-3 w-3" />
              ) : (
                <ChevronDownIcon className="h-3 w-3" />
              ))}
          </button>
        );
      },
    [sortKey, sortDir, handleSort],
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-medium text-muted-foreground">By Conversation</h4>
        {/* Search */}
        <div className="flex items-center gap-1.5 rounded-xl border border-border/70 bg-card/80 px-2.5 py-1.5">
          <SearchIcon className="h-3 w-3 text-muted-foreground" />
          <input
            type="text"
            className="bg-transparent text-xs outline-none w-[160px] placeholder:text-muted-foreground/50"
            placeholder="Search conversations..."
            value={searchInput}
            onChange={(e) => handleSearchInput(e.target.value)}
          />
        </div>
      </div>

      <div className="rounded-xl border border-border/40 bg-card/40 overflow-hidden">
        {/* Header row */}
        <div className="grid grid-cols-[1fr_120px_80px_80px_80px_60px_80px] gap-2 px-3 py-2 border-b border-border/30 bg-muted/20">
          <SortHeader label="Conversation" field="title" />
          <SortHeader label="Model" field="modelKey" />
          <SortHeader label="Total" field="totalTokens" />
          <SortHeader label="In" field="inputTokens" />
          <SortHeader label="Out" field="outputTokens" />
          <SortHeader label="Msgs" field="messageCount" />
          <SortHeader label="Date" field="createdAt" />
        </div>

        {/* Rows */}
        {conversations.length === 0 ? (
          <p className="text-xs text-muted-foreground py-6 text-center">
            {searchInput ? 'No matching conversations.' : 'No conversations with usage data.'}
          </p>
        ) : (
          conversations.map((conv, i) => (
            <div
              key={conv.id}
              className={`grid grid-cols-[1fr_120px_80px_80px_80px_60px_80px] gap-2 px-3 py-2 text-xs items-center transition-colors hover:bg-muted/30 ${
                i % 2 === 0 ? 'bg-card/20' : ''
              }`}
            >
              <button
                type="button"
                className="truncate text-left text-primary/80 hover:text-primary hover:underline"
                title={conv.title ?? conv.id}
                onClick={() => handleNavigate(conv.id)}
              >
                {conv.title || conv.id.slice(0, 12) + '...'}
              </button>
              <span className="truncate text-muted-foreground" title={conv.modelKey ?? ''}>
                {conv.modelKey ?? '—'}
              </span>
              <span className="tabular-nums">{formatTokenCount(conv.totalTokens)}</span>
              <span className="tabular-nums text-muted-foreground">{formatTokenCount(conv.inputTokens)}</span>
              <span className="tabular-nums text-muted-foreground">{formatTokenCount(conv.outputTokens)}</span>
              <span className="tabular-nums text-muted-foreground">{conv.messageCount}</span>
              <span className="text-muted-foreground" title={conv.createdAt}>
                {formatDateShort(conv.lastMessageAt ?? conv.createdAt)}
              </span>
            </div>
          ))
        )}

        {/* Pagination */}
        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between px-3 py-2 border-t border-border/30 bg-muted/10">
            <span className="text-[10px] text-muted-foreground">
              {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={currentPage <= 1}
                onClick={() => onPageChange(Math.max(0, offset - PAGE_SIZE))}
                className="rounded px-2 py-1 text-[10px] hover:bg-muted/50 disabled:opacity-30 transition-colors"
              >
                Prev
              </button>
              <span className="text-[10px] text-muted-foreground tabular-nums">
                {currentPage} / {totalPages}
              </span>
              <button
                type="button"
                disabled={currentPage >= totalPages}
                onClick={() => onPageChange(offset + PAGE_SIZE)}
                className="rounded px-2 py-1 text-[10px] hover:bg-muted/50 disabled:opacity-30 transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
