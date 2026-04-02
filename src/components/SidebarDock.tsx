import {
  useState,
  useRef,
  useCallback,
  type FC,
  type ReactNode,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { Tooltip } from '@/components/ui/Tooltip';
import { cn } from '@/lib/utils';

/* ── Types ────────────────────────────────────────────── */

export interface DockItem {
  /** Unique key */
  id: string;
  /** Tooltip label */
  label: string;
  /** Icon element (rendered inside the button) */
  icon: ReactNode;
  /** Click handler */
  onClick: () => void;
  /** Whether this item is currently "active" (highlighted) */
  active?: boolean;
  /** Optional badge (e.g. notification count) */
  badge?: ReactNode;
}

interface SidebarDockProps {
  items: DockItem[];
  /** Element pinned to the right edge, outside the scrollable area (e.g. ThemeToggle) */
  trailing?: ReactNode;
  className?: string;
}

/* ── Magnification math ───────────────────────────────── */

/**
 * Kept modest (1.25×) so Lucide SVG icons stay crisp — they're vector but the
 * browser rasterises at the base size before CSS-scaling, so large factors
 * introduce visible blur on non-retina displays.
 */
const MAX_SCALE = 1.25;
/** How many pixels away the effect reaches (in either direction) */
const INFLUENCE_RADIUS = 70;

function getScale(distance: number): number {
  if (distance > INFLUENCE_RADIUS) return 1;
  // cosine-based falloff — smooth ease at edges
  const ratio = distance / INFLUENCE_RADIUS;
  const boost = (MAX_SCALE - 1) * (0.5 * (1 + Math.cos(Math.PI * ratio)));
  return 1 + boost;
}

/* ── Component ────────────────────────────────────────── */

export const SidebarDock: FC<SidebarDockProps> = ({ items, trailing, className }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [mouseX, setMouseX] = useState<number | null>(null);

  const handleMouseMove = useCallback((e: ReactMouseEvent) => {
    if (!scrollRef.current) return;
    const rect = scrollRef.current.getBoundingClientRect();
    setMouseX(e.clientX - rect.left + scrollRef.current.scrollLeft);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setMouseX(null);
  }, []);

  return (
    <div
      className={cn(
        'flex items-end border-t border-sidebar-border/80',
        className,
      )}
    >
      {/* ── Scrollable icon area ──
           IMPORTANT: Do NOT use justify-center here. When the icons overflow,
           justify-center pushes content equally left and right — but only the
           right overflow is reachable via scroll. The left side gets clipped
           with no way to scroll to it. Instead we use margin:auto on the inner
           wrapper to centre when there's room, and left-align when overflowing. */}
      <div
        ref={scrollRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        className="dock-scroll min-w-0 flex-1 overflow-x-auto pb-2 pt-3"
        style={{
          scrollbarWidth: 'none',
        }}
      >
        <div className="flex w-max items-end gap-0.5 px-2 mx-auto">
          {items.map((item, idx) => (
            <DockIcon
              key={item.id}
              item={item}
              index={idx}
              totalItems={items.length}
              mouseX={mouseX}
              containerRef={scrollRef}
            />
          ))}
        </div>
      </div>

      {/* ── Fixed trailing element (e.g. theme toggle) ── */}
      {trailing && (
        <div className="flex shrink-0 items-center border-l border-sidebar-border/40 px-1.5 pb-2 pt-3">
          {trailing}
        </div>
      )}
    </div>
  );
};

/* ── Individual dock icon ─────────────────────────────── */

interface DockIconProps {
  item: DockItem;
  index: number;
  totalItems: number;
  mouseX: number | null;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

const DockIcon: FC<DockIconProps> = ({ item, mouseX, containerRef }) => {
  const btnRef = useRef<HTMLButtonElement>(null);

  // Compute scale based on distance from cursor
  let scale = 1;
  if (mouseX !== null && btnRef.current && containerRef.current) {
    const btnRect = btnRef.current.getBoundingClientRect();
    const containerRect = containerRef.current.getBoundingClientRect();
    // Account for scroll position so the calculation stays correct when scrolled
    const btnCenter =
      btnRect.left + btnRect.width / 2 - containerRect.left + containerRef.current.scrollLeft;
    scale = getScale(Math.abs(mouseX - btnCenter));
  }

  return (
    <Tooltip content={item.label} side="top" sideOffset={6}>
      <button
        ref={btnRef}
        type="button"
        onClick={item.onClick}
        className={cn(
          'titlebar-no-drag relative flex shrink-0 items-center justify-center rounded-xl p-1.5 transition-colors',
          'hover:bg-sidebar-accent/80',
          'origin-bottom will-change-transform',
          item.active
            ? 'bg-primary/15 text-primary'
            : 'text-muted-foreground',
        )}
        style={{
          transform: `scale(${scale})`,
          transition: mouseX !== null
            ? 'transform 0.15s cubic-bezier(0.22, 1, 0.36, 1)'
            : 'transform 0.3s cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      >
        {item.icon}
        {item.badge}
      </button>
    </Tooltip>
  );
};
