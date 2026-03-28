import { useState, useEffect, useRef, useCallback, type FC } from 'react';
import { XIcon, ChevronUpIcon, ChevronDownIcon, SearchIcon } from 'lucide-react';

type SearchBarProps = {
  visible: boolean;
  onClose: () => void;
  /** The scrollable viewport element to search within */
  viewportRef: React.RefObject<HTMLElement | null>;
};

const HIGHLIGHT_CLASS = 'search-highlight';
const ACTIVE_HIGHLIGHT_CLASS = 'search-highlight-active';

export const SearchBar: FC<SearchBarProps> = ({ visible, onClose, viewportRef }) => {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const highlightEls = useRef<HTMLElement[]>([]);

  // Focus input when search bar becomes visible
  useEffect(() => {
    if (visible) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      clearHighlights();
      setQuery('');
      setActiveIndex(0);
    }
  }, [visible]);

  const clearHighlights = useCallback(() => {
    for (const el of highlightEls.current) {
      const parent = el.parentNode;
      if (parent) {
        parent.replaceChild(document.createTextNode(el.textContent ?? ''), el);
        parent.normalize();
      }
    }
    highlightEls.current = [];
  }, []);

  const performSearch = useCallback((searchText: string) => {
    clearHighlights();
    setActiveIndex(0);

    if (!searchText.trim() || !viewportRef.current) return;

    const viewport = viewportRef.current;
    const text = searchText.toLowerCase();
    const walker = document.createTreeWalker(viewport, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        // Skip script/style/input elements
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        const tag = parent.tagName;
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'INPUT' || tag === 'TEXTAREA') {
          return NodeFilter.FILTER_REJECT;
        }
        // Skip if inside the search bar itself
        if (parent.closest('[data-search-bar]')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    // Find all text node ranges that match
    const foundRanges: { node: Text; start: number; end: number }[] = [];
    let textNode: Text | null;
    while ((textNode = walker.nextNode() as Text | null)) {
      const content = textNode.textContent?.toLowerCase() ?? '';
      let idx = 0;
      while ((idx = content.indexOf(text, idx)) !== -1) {
        foundRanges.push({ node: textNode, start: idx, end: idx + text.length });
        idx += text.length;
      }
    }

    if (foundRanges.length === 0) return;

    // Wrap matches in highlight spans (process in reverse to not invalidate offsets)
    const newHighlights: HTMLElement[] = [];
    // Group by node
    const byNode = new Map<Text, { start: number; end: number }[]>();
    for (const r of foundRanges) {
      if (!byNode.has(r.node)) byNode.set(r.node, []);
      byNode.get(r.node)!.push(r);
    }

    for (const [node, ranges] of byNode) {
      // Process ranges in reverse order within each node
      const sorted = [...ranges].sort((a, b) => b.start - a.start);
      for (const range of sorted) {
        const span = document.createElement('mark');
        span.className = HIGHLIGHT_CLASS;
        const matchRange = document.createRange();
        matchRange.setStart(node, range.start);
        matchRange.setEnd(node, range.end);
        matchRange.surroundContents(span);
        newHighlights.unshift(span);
      }
    }

    highlightEls.current = newHighlights;
    if (newHighlights.length > 0) {
      setActiveIndex(0);
      scrollToHighlight(newHighlights[0]);
    }
  }, [viewportRef, clearHighlights]);

  // Update search on query change (debounced)
  useEffect(() => {
    const timer = setTimeout(() => performSearch(query), 200);
    return () => clearTimeout(timer);
  }, [query, performSearch]);

  // Update active highlight styling
  useEffect(() => {
    for (let i = 0; i < highlightEls.current.length; i++) {
      const el = highlightEls.current[i];
      if (i === activeIndex) {
        el.classList.add(ACTIVE_HIGHLIGHT_CLASS);
      } else {
        el.classList.remove(ACTIVE_HIGHLIGHT_CLASS);
      }
    }
    if (highlightEls.current[activeIndex]) {
      scrollToHighlight(highlightEls.current[activeIndex]);
    }
  }, [activeIndex]);

  const scrollToHighlight = (el: HTMLElement) => {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const goNext = () => {
    if (highlightEls.current.length === 0) return;
    setActiveIndex((prev) => (prev + 1) % highlightEls.current.length);
  };

  const goPrev = () => {
    if (highlightEls.current.length === 0) return;
    setActiveIndex((prev) => (prev - 1 + highlightEls.current.length) % highlightEls.current.length);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'Enter') {
      if (e.shiftKey) goPrev();
      else goNext();
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => clearHighlights();
  }, [clearHighlights]);

  if (!visible) return null;

  return (
    <div
      data-search-bar
      className="mx-auto mt-4 flex w-full max-w-5xl items-center gap-2 rounded-2xl border border-border/70 bg-card/85 px-4 py-2 shadow-[0_10px_30px_rgba(5,4,15,0.12)]"
    >
      <SearchIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Search in conversation..."
        className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
      />
      {query && (
        <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
          {highlightEls.current.length > 0
            ? `${activeIndex + 1} / ${highlightEls.current.length}`
            : 'No results'}
        </span>
      )}
      <button type="button" onClick={goPrev} disabled={highlightEls.current.length === 0} className="p-1 rounded hover:bg-muted disabled:opacity-30 transition-colors" title="Previous (Shift+Enter)">
        <ChevronUpIcon className="h-3.5 w-3.5 text-muted-foreground" />
      </button>
      <button type="button" onClick={goNext} disabled={highlightEls.current.length === 0} className="p-1 rounded hover:bg-muted disabled:opacity-30 transition-colors" title="Next (Enter)">
        <ChevronDownIcon className="h-3.5 w-3.5 text-muted-foreground" />
      </button>
      <button type="button" onClick={onClose} className="p-1 rounded hover:bg-muted transition-colors" title="Close (Esc)">
        <XIcon className="h-3.5 w-3.5 text-muted-foreground" />
      </button>
    </div>
  );
};
