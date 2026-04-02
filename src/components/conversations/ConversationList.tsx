import { useEffect, useMemo, useRef, useState, useCallback, type FC } from 'react';
import { PlusIcon, SearchIcon, Trash2Icon, MessageSquareIcon, LoaderIcon, XIcon, PanelTopOpenIcon, SlidersHorizontalIcon, MonitorIcon, PinIcon } from 'lucide-react';
import { app } from '@/lib/ipc-client';
import { EditableInput } from '@/components/EditableInput';
import { useComputerUse } from '@/providers/ComputerUseProvider';
import type { ConversationRecord } from '@/providers/RuntimeProvider';
import type { ComputerSession } from '../../../shared/computer-use';
import { TriggerWorkflows } from './TriggerWorkflows';
import { GaiaPresenceIndicator } from './GaiaPresenceIndicator';
import { GaiaThreadEntry } from './GaiaThreadEntry';
import { useConversationPreferences } from './useConversationPreferences';
import { SortPopover } from './SortPopover';
import { FilterPopover } from './FilterPopover';

type ConversationSummary = Pick<
  ConversationRecord,
  'id' | 'title' | 'fallbackTitle' | 'createdAt' | 'updatedAt' | 'lastMessageAt' |
  'messageCount' | 'userMessageCount' | 'runStatus' | 'hasUnread' | 'lastAssistantUpdateAt'
> & {
  /** Computed server-side: true if any message contains a tool-call content part */
  hasToolCalls?: boolean;
};

type ConversationListProps = {
  activeConversationId: string | null;
  activeThreadMode?: 'chat' | 'computer';
  onSwitchConversation: (id: string) => void;
  onNewConversation: () => Promise<void> | void;
};

function formatRelativeTime(timestamp: string | null): string {
  if (!timestamp) return 'No messages';
  const diffMs = Date.now() - new Date(timestamp).getTime();
  if (diffMs < 60_000) return 'just now';
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`;
  if (diffMs < 604_800_000) return `${Math.floor(diffMs / 86_400_000)}d ago`;
  return `${Math.floor(diffMs / 604_800_000)}w ago`;
}

function getDisplayTitle(conv: ConversationSummary, computerSessions?: ComputerSession[]): string {
  // Prefer chat-based titles
  const chatTitle = conv.title?.trim() || conv.fallbackTitle?.trim();
  if (chatTitle) return chatTitle;

  // Fall back to computer-use session goal
  if (computerSessions?.length) {
    const goal = computerSessions[0].goal;
    if (goal) return goal.length > 50 ? goal.slice(0, 47).trimEnd() + '...' : goal;
  }

  return 'New Conversation';
}

const TypingBubble: FC = () => (
  <div className="flex items-center gap-0.5 px-1">
    <div className="h-1 w-1 rounded-full bg-primary animate-bounce [animation-delay:0ms]" />
    <div className="h-1 w-1 rounded-full bg-primary animate-bounce [animation-delay:150ms]" />
    <div className="h-1 w-1 rounded-full bg-primary animate-bounce [animation-delay:300ms]" />
  </div>
);

/** Pulsing monitor icon — shown when a computer-use session is actively running */
const ComputerActiveIndicator: FC = () => (
  <div className="flex items-center gap-1 px-0.5" title="Computer session running">
    <span className="relative flex h-2 w-2">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-500" />
    </span>
    <MonitorIcon className="h-3 w-3 text-blue-500" />
  </div>
);

/** Static green dot — shown when a computer-use session has completed */
const ComputerCompletedIndicator: FC = () => (
  <div className="flex items-center gap-1 px-0.5" title="Computer session completed">
    <div className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]" />
  </div>
);

/**
 * Double-click-confirm hook: first click arms, second click within timeout executes.
 * Returns { armed, onClick, reset }.
 */
function useDoubleClickConfirm(onConfirm: () => void, timeoutMs = 2500) {
  const [armed, setArmed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reset = useCallback(() => {
    setArmed(false);
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
  }, []);

  const onClick = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (armed) {
      reset();
      onConfirm();
    } else {
      setArmed(true);
      timerRef.current = setTimeout(reset, timeoutMs);
    }
  }, [armed, onConfirm, reset, timeoutMs]);

  // Cleanup on unmount
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  return { armed, onClick, reset };
}

/** Per-conversation delete button with single-click delete */
const ConversationDeleteButton: FC<{ onDelete: () => Promise<void>; isDeleting: boolean }> = ({ onDelete, isDeleting }) => {
  if (isDeleting) {
    return <LoaderIcon className="h-3 w-3 animate-spin text-muted-foreground shrink-0" />;
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        void onDelete();
      }}
      className="shrink-0 rounded p-0.5 opacity-0 transition-all group-hover:opacity-100 hover:bg-destructive/10"
      title="Delete conversation"
      aria-label="Delete conversation"
    >
      <Trash2Icon className="h-3 w-3 text-muted-foreground hover:text-destructive" />
    </button>
  );
};

export const ConversationList: FC<ConversationListProps> = ({
  activeConversationId,
  activeThreadMode,
  onSwitchConversation,
  onNewConversation,
}) => {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(__BRAND_APP_SLUG + ':pinned-conversations') || '[]')); } catch { return new Set(); }
  });
  const { sessionsByConversation } = useComputerUse();
  const [sortOpen, setSortOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const sortButtonRef = useRef<HTMLButtonElement>(null);
  const filterButtonRef = useRef<HTMLButtonElement>(null);
  const { sort, setSort, filter, setFilter, activeFilterCount, clearFilters, isDefaultSort } = useConversationPreferences();

  const togglePin = useCallback((id: string) => {
    setPinnedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      localStorage.setItem(__BRAND_APP_SLUG + ':pinned-conversations', JSON.stringify([...next]));
      return next;
    });
  }, []);

  /** Get the computer-use session status for a conversation */
  const getComputerStatus = useCallback((conversationId: string): 'running' | 'completed' | null => {
    const sessions = sessionsByConversation.get(conversationId);
    if (!sessions?.length) return null;
    const latest = sessions[0]; // sorted by updatedAt desc
    if (latest.status === 'running' || latest.status === 'starting' || latest.status === 'awaiting-approval') return 'running';
    if (latest.status === 'completed' && !latest.completionSeen) return 'completed';
    return null;
  }, [sessionsByConversation]);

  // Mark computer-use sessions as seen when the user is viewing the Computer tab
  useEffect(() => {
    if (!activeConversationId || activeThreadMode !== 'computer') return;
    const sessions = sessionsByConversation.get(activeConversationId);
    const hasUnseen = sessions?.some((s) => s.status === 'completed' && !s.completionSeen);
    if (hasUnseen) {
      void app.computerUse.markSessionsSeen(activeConversationId);
    }
  }, [activeConversationId, activeThreadMode, sessionsByConversation]);

  const loadConversations = async () => {
    try {
      const list = await app.conversations.list() as ConversationSummary[];

      // Detect conversations that were removed since last load (auto-cleanup)
      // and animate them out before removing from state
      setConversations((prev) => {
        const newIds = new Set(list.map((c) => c.id));
        const vanished = prev.filter((c) => !newIds.has(c.id) && !removingIds.has(c.id));

        if (vanished.length > 0) {
          // Mark vanished items for animation
          setRemovingIds((ids) => {
            const next = new Set(ids);
            for (const c of vanished) next.add(c.id);
            return next;
          });
          // After animation, remove them from state
          setTimeout(() => {
            setRemovingIds((ids) => {
              const next = new Set(ids);
              for (const c of vanished) next.delete(c.id);
              return next;
            });
            setConversations((current) =>
              current.filter((c) => !vanished.some((v) => v.id === c.id)),
            );
          }, 300);
          // Keep old items in list during animation
          return prev;
        }

        return list;
      });
    } catch {
      // IPC not ready
    }
  };

  useEffect(() => {
    loadConversations();
    const interval = setInterval(loadConversations, 1500);
    return () => clearInterval(interval);
  }, []);

  const isSearchActive = searchQuery.trim().length > 0;
  const hasActiveFilters = activeFilterCount > 0;

  const processedConversations = useMemo(() => {
    let result = [...conversations];

    // Stage 1: Apply filters
    if (hasActiveFilters) {
      result = result.filter((conv) => {
        if (filter.hasToolCalls === true && !conv.hasToolCalls) return false;
        if (filter.hasComputerUse === true && !sessionsByConversation.has(conv.id)) return false;
        if (filter.messageCountMin != null && conv.messageCount < filter.messageCountMin) return false;
        if (filter.messageCountMax != null && conv.messageCount > filter.messageCountMax) return false;
        if (filter.createdAfter && conv.createdAt.slice(0, 10) < filter.createdAfter) return false;
        if (filter.createdBefore && conv.createdAt.slice(0, 10) > filter.createdBefore) return false;
        const effectiveUpdated = conv.lastAssistantUpdateAt ?? conv.lastMessageAt ?? conv.updatedAt;
        if (filter.updatedAfter && (effectiveUpdated ?? '').slice(0, 10) < filter.updatedAfter) return false;
        if (filter.updatedBefore && (effectiveUpdated ?? '').slice(0, 10) > filter.updatedBefore) return false;
        return true;
      });
    }

    // Stage 2: Apply text search
    if (isSearchActive) {
      const q = searchQuery.toLowerCase();
      result = result.filter((c) =>
        getDisplayTitle(c, sessionsByConversation.get(c.id)).toLowerCase().includes(q),
      );
    }

    // Stage 3: Apply sort
    result.sort((a, b) => {
      let cmp = 0;
      switch (sort.field) {
        case 'latest-updated': {
          const aAt = a.lastAssistantUpdateAt ?? a.lastMessageAt ?? a.updatedAt ?? a.createdAt;
          const bAt = b.lastAssistantUpdateAt ?? b.lastMessageAt ?? b.updatedAt ?? b.createdAt;
          cmp = aAt.localeCompare(bAt);
          break;
        }
        case 'first-created':
          cmp = a.createdAt.localeCompare(b.createdAt);
          break;
        case 'alphabetical': {
          const aTitle = getDisplayTitle(a, sessionsByConversation.get(a.id)).toLowerCase();
          const bTitle = getDisplayTitle(b, sessionsByConversation.get(b.id)).toLowerCase();
          cmp = aTitle.localeCompare(bTitle);
          break;
        }
      }
      return sort.direction === 'desc' ? -cmp : cmp;
    });

    return result;
  }, [conversations, filter, hasActiveFilters, searchQuery, isSearchActive, sort, sessionsByConversation]);

  const handleDelete = async (id: string) => {
    const shouldCreateReplacementThread = id === activeConversationId;
    setDeletingId(id);

    try {
      await app.conversations.delete(id);

      if (shouldCreateReplacementThread) {
        await onNewConversation();
      }

      await loadConversations();
    } finally {
      setDeletingId(null);
    }
  };

  const handleDeleteBulk = async () => {
    const idsToDelete = processedConversations.map((c) => c.id);

    for (const id of idsToDelete) {
      await app.conversations.delete(id);
    }

    if (activeConversationId && idsToDelete.includes(activeConversationId)) {
      await onNewConversation();
    }

    await loadConversations();
  };

  const handleClearUnread = async (id: string) => {
    const conv = await app.conversations.get(id) as ConversationRecord | null;
    if (conv?.hasUnread) {
      await app.conversations.put({ ...conv, hasUnread: false });
    }
    onSwitchConversation(id);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-sidebar-border/70 px-4 py-3">
        <button
          type="button"
          onClick={() => {
            void onNewConversation();
          }}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent/80"
        >
          <PlusIcon className="h-4 w-4 text-primary" />
          New thread
        </button>
      </div>

      <div className="flex items-center justify-between px-4 pb-2 pt-4">
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Threads</span>
        <div className="flex items-center gap-1 text-muted-foreground">
          <button
            ref={sortButtonRef}
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => { setSortOpen((p) => !p); setFilterOpen(false); }}
            className={`rounded-md p-1.5 transition-colors hover:bg-sidebar-accent/80 ${!isDefaultSort ? 'text-primary' : ''}`}
            title="Sort threads"
          >
            <PanelTopOpenIcon className="h-4 w-4" />
          </button>
          <div className="relative">
            <button
              ref={filterButtonRef}
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => { setFilterOpen((p) => !p); setSortOpen(false); }}
              className="rounded-md p-1.5 transition-colors hover:bg-sidebar-accent/80"
              title="Filter threads"
            >
              <SlidersHorizontalIcon className="h-4 w-4" />
            </button>
            {activeFilterCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground pointer-events-none">
                {activeFilterCount > 9 ? '9+' : activeFilterCount}
              </span>
            )}
          </div>
          {sortOpen && (
            <SortPopover sort={sort} onSortChange={setSort} onClose={() => setSortOpen(false)} anchorRef={sortButtonRef} />
          )}
          {filterOpen && (
            <FilterPopover
              filter={filter}
              onFilterChange={setFilter}
              activeFilterCount={activeFilterCount}
              onClear={clearFilters}
              onClose={() => setFilterOpen(false)}
              anchorRef={filterButtonRef}
            />
          )}
        </div>
      </div>

      <div className="px-3 pb-3">
        <div className="flex items-center gap-2 rounded-xl border border-sidebar-border/70 bg-sidebar-accent/45 px-3 py-2">
          <SearchIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <EditableInput
            placeholder="Search..."
            value={searchQuery}
            onChange={setSearchQuery}
            className="flex-1 bg-transparent text-xs"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="shrink-0 p-0.5 rounded hover:bg-sidebar-accent transition-colors"
            >
              <XIcon className="h-3 w-3 text-muted-foreground" />
            </button>
          )}
        </div>
      </div>

      <div className="px-2 pb-2 border-b border-sidebar-border">
        <GaiaThreadEntry
          activeConversationId={activeConversationId}
          onSelect={onSwitchConversation}
        />
      </div>

      <TriggerWorkflows onSelectConversation={onSwitchConversation} />

      <div className="flex-1 overflow-y-auto px-3">
        {(() => {
          const pinned = processedConversations.filter((c) => pinnedIds.has(c.id));
          const unpinned = processedConversations.filter((c) => !pinnedIds.has(c.id));
          const sections: Array<{ label?: string; items: ConversationSummary[] }> = [];
          if (pinned.length > 0) sections.push({ label: 'Pinned', items: pinned });
          sections.push({ items: unpinned });

          return sections.map((section, si) => (
            <div key={si}>
              {section.label && (
                <div className="flex items-center gap-2 px-1 pb-1 pt-2">
                  <PinIcon className="h-2.5 w-2.5 text-primary/60" />
                  <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/60">{section.label}</span>
                </div>
              )}
              {section.items.map((conv) => {
                const isActive = conv.id === activeConversationId;
                const isRunning = conv.runStatus === 'running';
                const hasUnread = conv.hasUnread && !isActive;
                const isRemoving = removingIds.has(conv.id);
                const computerStatus = getComputerStatus(conv.id);
                const isPinned = pinnedIds.has(conv.id);

                return (
                  <div
                    key={conv.id}
                    className={`overflow-hidden transition-all duration-300 ease-in-out ${
                      isRemoving ? 'max-h-0 opacity-0 mb-0' : 'max-h-24 opacity-100 mb-1.5'
                    }`}
                  >
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => handleClearUnread(conv.id)}
                    onKeyDown={(e) => e.key === 'Enter' && handleClearUnread(conv.id)}
                    className={`
                      flex w-full items-start gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm transition-all group cursor-pointer relative
                      ${isActive ? 'shadow-[inset_0_0_0_1px_var(--app-active-item-ring)]' : 'hover:bg-sidebar-accent/65'}
                      ${hasUnread && !isActive ? 'bg-sidebar-accent/45' : ''}
                    `}
                    style={isActive ? { backgroundColor: 'var(--app-active-item)' } : undefined}
                  >
                    <MessageSquareIcon className={`mt-0.5 h-4 w-4 shrink-0 ${hasUnread ? 'text-primary' : 'text-muted-foreground'}`} />
                    <div className="flex-1 min-w-0">
                      <span className={`line-clamp-2 text-sm ${hasUnread ? 'font-semibold text-sidebar-foreground' : 'font-medium text-sidebar-foreground/95'}`}>
                        {getDisplayTitle(conv, sessionsByConversation.get(conv.id))}
                      </span>
                      <span className="mt-1 block text-[12px] text-muted-foreground">
                        {isRunning ? 'Running now' : formatRelativeTime(conv.lastAssistantUpdateAt ?? conv.lastMessageAt)}
                        {conv.messageCount > 0 && ` · ${conv.messageCount} msgs`}
                      </span>
                    </div>
                    <div className="ml-1 flex shrink-0 flex-col items-center gap-1">
                      {hasUnread && <div className="h-2 w-2 rounded-full bg-primary shadow-[0_0_10px_rgba(197,194,245,0.38)]" />}
                      {isRunning && <TypingBubble />}
                      {computerStatus === 'running' && <ComputerActiveIndicator />}
                      {computerStatus === 'completed' && !(isActive && activeThreadMode === 'computer') && <ComputerCompletedIndicator />}
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); togglePin(conv.id); }}
                        className={`shrink-0 rounded p-0.5 transition-all ${isPinned ? 'opacity-100 text-primary' : 'opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-primary'}`}
                        title={isPinned ? 'Unpin' : 'Pin to top'}
                      >
                        <PinIcon className="h-3 w-3" />
                      </button>
                      <ConversationDeleteButton
                        onDelete={() => handleDelete(conv.id)}
                        isDeleting={deletingId === conv.id}
                      />
                    </div>
                  </div>
                  </div>
                );
              })}
            </div>
          ));
        })()}

        {processedConversations.length === 0 && (
          <p className="text-xs text-muted-foreground p-3 text-center">
            {searchQuery || hasActiveFilters ? 'No matching conversations' : 'No conversations yet'}
          </p>
        )}
      </div>

      {/* Delete all / delete searched — bottom of sidebar */}
      {processedConversations.length > 0 && (
        <div className="border-t border-sidebar-border/70 p-3">
          <BulkDeleteButton
            label={isSearchActive || hasActiveFilters ? `Delete ${processedConversations.length} shown` : 'Delete all chats'}
            onConfirm={handleDeleteBulk}
          />
        </div>
      )}

      <GaiaPresenceIndicator />
    </div>
  );
};

/** Bulk delete button with double-click confirm */
const BulkDeleteButton: FC<{ label: string; onConfirm: () => Promise<void> }> = ({ label, onConfirm }) => {
  const [isDeleting, setIsDeleting] = useState(false);
  const { armed, onClick } = useDoubleClickConfirm(async () => {
    setIsDeleting(true);
    await onConfirm();
    setIsDeleting(false);
  });

  if (isDeleting) {
    return (
      <div className="flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs text-muted-foreground">
        <LoaderIcon className="h-3.5 w-3.5 animate-spin" />
        Deleting...
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs transition-all ${
        armed
          ? 'bg-destructive text-destructive-foreground font-medium'
          : 'text-muted-foreground hover:bg-sidebar-accent hover:text-foreground'
      }`}
    >
      <Trash2Icon className="h-3.5 w-3.5" />
      {armed ? 'Click again to confirm' : label}
    </button>
  );
};
