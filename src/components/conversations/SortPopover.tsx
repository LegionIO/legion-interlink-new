import { useEffect, useRef, useState, useLayoutEffect, type FC } from 'react';
import { createPortal } from 'react-dom';
import { CheckIcon, ArrowUpIcon, ArrowDownIcon } from 'lucide-react';
import type { SortPreference, SortField, SortDirection } from './useConversationPreferences';

type SortPopoverProps = {
  sort: SortPreference;
  onSortChange: (sort: SortPreference) => void;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
};

const SORT_OPTIONS: Array<{ field: SortField; label: string; defaultDir: SortDirection }> = [
  { field: 'latest-updated', label: 'Latest updated', defaultDir: 'desc' },
  { field: 'first-created', label: 'First created', defaultDir: 'asc' },
  { field: 'alphabetical', label: 'Alphabetical', defaultDir: 'asc' },
];

export const SortPopover: FC<SortPopoverProps> = ({ sort, onSortChange, onClose, anchorRef }) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Position the popover relative to the anchor button
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    setPos({ top: rect.bottom + 8, left: rect.left });
  }, [anchorRef]);

  useEffect(() => {
    const handlePointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        onClose();
      }
    };
    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [onClose]);

  const handleSelect = (option: (typeof SORT_OPTIONS)[number]) => {
    if (sort.field === option.field) {
      onSortChange({ field: option.field, direction: sort.direction === 'asc' ? 'desc' : 'asc' });
    } else {
      onSortChange({ field: option.field, direction: option.defaultDir });
    }
  };

  if (!pos) return null;

  return createPortal(
    <div
      ref={rootRef}
      style={{ top: pos.top, left: pos.left }}
      className="fixed z-[9999] w-[200px] rounded-2xl border border-border/70 bg-popover/95 p-1.5 shadow-[0_16px_40px_rgba(5,4,15,0.28)] backdrop-blur-xl"
    >
      <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/60">
        Sort by
      </div>
      {SORT_OPTIONS.map((option) => {
        const isActive = sort.field === option.field;
        const DirectionIcon = sort.direction === 'asc' ? ArrowUpIcon : ArrowDownIcon;

        return (
          <button
            key={option.field}
            type="button"
            onClick={() => handleSelect(option)}
            className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm transition-colors ${
              isActive ? 'bg-primary/12 text-foreground' : 'text-foreground/80 hover:bg-muted'
            }`}
          >
            <span className="w-4 shrink-0">
              {isActive && <CheckIcon className="h-3.5 w-3.5" />}
            </span>
            <span className="flex-1 text-left font-medium">{option.label}</span>
            {isActive && (
              <DirectionIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            )}
          </button>
        );
      })}
    </div>,
    document.body,
  );
};
