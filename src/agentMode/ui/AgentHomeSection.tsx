import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SearchBar } from "@/components/ui/SearchBar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatCompactRelativeTime } from "@/utils/formatRelativeTime";
import { ChevronRight, Plus } from "lucide-react";
import React, {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/**
 * Shared building blocks for the Agent Home landing section bodies (Projects,
 * Recent Chats): a few inline rows plus a "View all" popover with search. That
 * structure lives here once so each section supplies only its data and row click
 * behavior. The section title/count/collapse now live in the shelf chip above
 * the panel (see {@link AgentHomeShelf}); this file is just the row and view-all
 * primitives.
 */

/** Rows shown inline before the rest collapse behind the "View all" popover. */
export const INLINE_LIMIT = 3;

/**
 * Rows rendered per page in the View-all popover. The list grows by this much
 * each time the scroll sentinel enters view, mirroring the chat history popover
 * so large lists (hundreds of chats) don't all render at once.
 */
const VIEW_ALL_PAGE_SIZE = 50;

interface AgentHomeCreateRowProps {
  label: string;
  onClick: () => void;
}

/**
 * Leading "create" action shared by the section bodies (New project / New chat).
 * An accent tile + accent label, shaped like the colored item tiles below so
 * both panels open with a same-height first row (keeps the tabbed shelf from
 * jumping when you switch between Projects and Recent Chats).
 */
export const AgentHomeCreateRow = memo(function AgentHomeCreateRow({
  label,
  onClick,
}: AgentHomeCreateRowProps): React.ReactElement {
  return (
    <Button
      type="button"
      variant="ghost2"
      onClick={onClick}
      aria-label={label}
      className="tw-h-auto tw-min-h-9 tw-w-full tw-justify-start tw-gap-2 tw-rounded-md tw-px-2 tw-py-1.5 hover:tw-bg-modifier-hover"
    >
      <span className="tw-flex tw-size-6 tw-shrink-0 tw-items-center tw-justify-center tw-rounded-md tw-bg-interactive-accent-hsl/10">
        <Plus className="tw-size-4 tw-text-accent" />
      </span>
      <span className="tw-text-ui-small tw-font-medium tw-text-accent">{label}</span>
    </Button>
  );
});

interface AgentHomeListRowProps {
  label: string;
  /** Timestamp in ms; rendered as a compact relative label (e.g. "40m"). */
  timeMs: number;
  onClick: () => void;
  /**
   * Indent the label by one leading-slot width so an icon-less row still lines
   * up under sibling rows that carry a leading icon/tile. Ignored when `icon` or
   * `leading` is set (that element already fills the leading slot).
   */
  indent?: boolean;
  /**
   * Optional leading icon — informational, e.g. the backend brand a chat ran on.
   * Rows that need a richer marker than a single glyph use `leading` instead.
   */
  icon?: React.ComponentType<{ className?: string }>;
  /**
   * Custom leading element, rendered in place of `icon` when set. Lets a row
   * supply a richer marker than a single monochrome glyph — e.g. the project
   * tile (tinted square + colored folder). Takes precedence over `icon`.
   */
  leading?: React.ReactNode;
}

/**
 * Generic clickable list row: optional leading icon/element + truncated label +
 * relative time. The leading slot is filled by `leading` (a rich marker like the
 * project tile) or `icon` (a single glyph, e.g. a chat's backend brand). A row
 * with neither can `indent` so its text still aligns under siblings that do
 * (`tw-pl-6` ≈ icon width + gap).
 */
export const AgentHomeListRow = memo(function AgentHomeListRow({
  label,
  timeMs,
  onClick,
  indent = false,
  icon: Icon,
  leading,
}: AgentHomeListRowProps): React.ReactElement {
  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        "tw-flex tw-min-h-9 tw-w-full tw-cursor-pointer tw-items-center tw-gap-2 tw-rounded-md tw-px-2 tw-py-1.5",
        "tw-text-left tw-transition-colors hover:tw-bg-modifier-hover"
      )}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
    >
      {leading ?? (Icon && <Icon className="tw-size-4 tw-shrink-0 tw-text-muted" />)}
      <span
        className={cn(
          "tw-min-w-0 tw-flex-1 tw-truncate tw-text-ui-small tw-text-normal",
          indent && !Icon && !leading && "tw-pl-6"
        )}
        title={label}
      >
        {label}
      </span>
      <span
        className="tw-shrink-0 tw-whitespace-nowrap tw-text-xs tw-text-muted"
        title={new Date(timeMs).toLocaleString()}
      >
        {formatCompactRelativeTime(timeMs)}
      </span>
    </div>
  );
});

interface AgentHomeViewAllProps<TItem> {
  /** Full item set the popover searches over (already sorted by the caller). */
  items: TItem[];
  total: number;
  /** Lowercase noun for the trigger, e.g. "projects" → "View all projects (5)". */
  label: string;
  popoverTitle: string;
  searchValue: string;
  onSearch: (value: string) => void;
  /** Pure filter over the full list for the current query. */
  filter: (items: TItem[], query: string) => TItem[];
  searchPlaceholder: string;
  emptyMessage: string;
  /** Renders one result row; `close` dismisses the popover after selection. */
  renderRow: (item: TItem, close: () => void) => React.ReactNode;
}

/**
 * "View all" trigger + in-pane popover with search over the full list. Generic
 * over the item type so both projects and chats reuse it without the primitive
 * knowing either domain.
 */
export function AgentHomeViewAll<TItem>({
  items,
  total,
  label,
  popoverTitle,
  searchValue,
  onSearch,
  filter,
  searchPlaceholder,
  emptyMessage,
  renderRow,
}: AgentHomeViewAllProps<TItem>): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [displayCount, setDisplayCount] = useState(VIEW_ALL_PAGE_SIZE);
  const observerRef = useRef<IntersectionObserver | null>(null);

  const filteredItems = useMemo(() => filter(items, searchValue), [filter, items, searchValue]);
  // Page the filtered list so a long result set renders incrementally.
  const visibleItems = useMemo(
    () => filteredItems.slice(0, displayCount),
    [filteredItems, displayCount]
  );

  // Reset paging when the popover opens or the query changes (otherwise a prior
  // scroll position would leave the new list pre-expanded). useLayoutEffect runs
  // the reset before paint to avoid a one-frame spike at the stale count.
  useLayoutEffect(() => {
    if (open) setDisplayCount(VIEW_ALL_PAGE_SIZE);
  }, [open, searchValue]);

  // Latest paging state for the observer callback, so it reads current values
  // without re-creating the observer on every render.
  const pagingRef = useRef({ displayCount: VIEW_ALL_PAGE_SIZE, total: 0 });
  useEffect(() => {
    pagingRef.current = { displayCount, total: filteredItems.length };
  }, [displayCount, filteredItems.length]);

  // Callback ref (not useRef + effect) because the sentinel lives inside
  // PopoverContent, which Radix only mounts when open — a [] effect would latch
  // a null ref before first open and never re-run. Unmount cleanup rides the
  // same path: React invokes the callback with null, disconnecting the observer.
  const sentinelRef = useCallback((node: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting) return;
        const { displayCount: current, total } = pagingRef.current;
        if (current < total) {
          setDisplayCount((prev) => Math.min(prev + VIEW_ALL_PAGE_SIZE, total));
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(node);
    observerRef.current = observer;
  }, []);

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    // Reason: reset the transient filter so reopening starts from the full list.
    if (!nextOpen) onSearch("");
  };
  const close = () => handleOpenChange(false);

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <div
          role="button"
          tabIndex={0}
          className={cn(
            "tw-flex tw-cursor-pointer tw-items-center tw-justify-between tw-rounded-md tw-px-2 tw-py-1.5",
            "tw-text-xs tw-text-accent tw-transition-colors hover:tw-bg-modifier-hover hover:tw-text-accent-hover"
          )}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setOpen(true);
            }
          }}
        >
          {/* Left-aligned to the leading-tile column (no indent), matching the
              create row. The count is omitted — the tab already shows it. */}
          <span>View all {label}</span>
          <ChevronRight className="tw-size-3 tw-shrink-0" />
        </div>
      </PopoverTrigger>
      <PopoverContent align="start" side="bottom" className="tw-w-72 tw-p-0">
        <div className="tw-flex tw-max-h-80 tw-flex-col">
          <div className="tw-flex tw-shrink-0 tw-items-center tw-gap-2 tw-border-b tw-border-solid tw-border-border tw-p-2">
            <span className="tw-text-ui-small tw-font-medium tw-text-normal">{popoverTitle}</span>
            <span className="tw-text-xs tw-text-muted">{total}</span>
          </div>
          <div className="tw-shrink-0 tw-p-2">
            <SearchBar value={searchValue} onChange={onSearch} placeholder={searchPlaceholder} />
          </div>
          {/* min-h keeps the scroll region a stable height when results are
              few (matches the chat history popover); the parent's max-h-80 caps
              it so long lists scroll instead of growing unbounded. */}
          <ScrollArea className="tw-min-h-32 tw-flex-1 tw-overflow-y-auto">
            <div className="tw-flex tw-flex-col tw-gap-0.5 tw-p-2 tw-pt-0">
              {filteredItems.length === 0 ? (
                <div className="tw-py-6 tw-text-center tw-text-xs tw-text-muted">
                  {emptyMessage}
                </div>
              ) : (
                <>
                  {visibleItems.map((item) => renderRow(item, close))}
                  {/* Sentinel: scrolling it into view pages in the next chunk.
                      The trailing hint mirrors the chat history popover. */}
                  <div ref={sentinelRef} className="tw-h-1" />
                  {displayCount < filteredItems.length && (
                    <div className="tw-py-1 tw-text-center tw-text-xs tw-text-muted">
                      Showing {displayCount} of {filteredItems.length} — scroll for more
                    </div>
                  )}
                </>
              )}
            </div>
          </ScrollArea>
        </div>
      </PopoverContent>
    </Popover>
  );
}
