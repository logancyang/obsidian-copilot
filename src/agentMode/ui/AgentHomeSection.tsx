import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SearchBar } from "@/components/ui/SearchBar";
import { cn } from "@/lib/utils";
import { formatCompactRelativeTime } from "@/utils/formatRelativeTime";
import { ChevronRight } from "lucide-react";
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
 * Shared building blocks for the Agent Home landing sections (Projects, Recent
 * Chats). Both render the same shape — a titled section, a few inline rows, and
 * a "View all" popover with search — so the structure lives here once and each
 * section supplies only its icon, data, and row click behavior.
 */

/** Rows shown inline before the rest collapse behind the "View all" popover. */
export const INLINE_LIMIT = 3;

/**
 * Rows rendered per page in the View-all popover. The list grows by this much
 * each time the scroll sentinel enters view, mirroring the chat history popover
 * so large lists (hundreds of chats) don't all render at once.
 */
const VIEW_ALL_PAGE_SIZE = 50;

interface AgentHomeSectionProps {
  /** Leading section icon (lucide element, sized by the caller). */
  icon: React.ReactNode;
  title: string;
  count: number;
  /** Optional trailing header control (e.g. a create button). */
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/** Titled section header (icon + title + count + optional action) plus body. */
export const AgentHomeSection = memo(function AgentHomeSection({
  icon,
  title,
  count,
  action,
  children,
  className,
}: AgentHomeSectionProps): React.ReactElement {
  return (
    <div className={cn("tw-flex tw-flex-col tw-gap-1", className)}>
      <div className="tw-flex tw-items-center tw-gap-2 tw-py-1">
        {icon}
        <span className="tw-text-ui-small tw-font-semibold tw-text-normal">{title}</span>
        <span className="tw-text-xs tw-font-normal tw-text-muted">({count})</span>
        {action && <div className="tw-ml-auto tw-flex tw-items-center">{action}</div>}
      </div>
      {children}
    </div>
  );
});

interface AgentHomeListRowProps {
  label: string;
  /** Timestamp in ms; rendered as a compact relative label (e.g. "40m"). */
  timeMs: number;
  onClick: () => void;
  /**
   * Indent the label to line up under the section title's text (past its icon).
   * On for inline rows that sit below a titled section; off inside the View-all
   * popover where there's no section icon to align against. Ignored when `icon`
   * is set (the icon itself fills the leading slot).
   */
  indent?: boolean;
  /**
   * Optional leading icon. Unlike the section's type icon (which would just
   * repeat per row), this is informational — e.g. the backend brand a chat ran
   * on. Projects don't pass one; the section header already conveys their type.
   */
  icon?: React.ComponentType<{ className?: string }>;
}

/**
 * Generic clickable list row: optional leading icon + truncated label + relative
 * time. Rows usually omit the icon — the section header carries the type icon,
 * so repeating it only adds noise. An icon is passed only when it's
 * informational (e.g. a chat's backend brand). Icon-less inline rows indent
 * (`tw-pl-6` ≈ icon width + gap) so their text still aligns under the title.
 */
export const AgentHomeListRow = memo(function AgentHomeListRow({
  label,
  timeMs,
  onClick,
  indent = false,
  icon: Icon,
}: AgentHomeListRowProps): React.ReactElement {
  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        "tw-flex tw-w-full tw-cursor-pointer tw-items-center tw-gap-2 tw-rounded-md tw-px-2 tw-py-1.5",
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
      {Icon && <Icon className="tw-size-4 tw-shrink-0 tw-text-muted" />}
      <span
        className={cn(
          "tw-min-w-0 tw-flex-1 tw-truncate tw-text-ui-small tw-text-normal",
          indent && !Icon && "tw-pl-6"
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
            "tw-text-xs tw-text-muted tw-transition-colors hover:tw-bg-modifier-hover hover:tw-text-normal"
          )}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setOpen(true);
            }
          }}
        >
          {/* pl-6 keeps the trigger text aligned with the inline rows above. */}
          <span className="tw-pl-6">
            View all {label} ({total})
          </span>
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
