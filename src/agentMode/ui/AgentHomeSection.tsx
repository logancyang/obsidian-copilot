import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatCompactRelativeTime } from "@/utils/formatRelativeTime";
import { Plus } from "lucide-react";
import React, { memo } from "react";

interface AgentHomeCreateRowProps {
  label: string;
  /** Receives the row's button element so a caller can anchor a popover to it. */
  onClick: (anchor: HTMLElement) => void;
}

/**
 * Leading "create" action shared by the section bodies (New project / New chat).
 * An accent tile + accent label with the same leading-slot dimensions as item
 * icons below, so both panels open with a same-height first row (keeps the
 * tabbed shelf from jumping when you switch between Projects and Recent Chats).
 */
export const AgentHomeCreateRow = memo(function AgentHomeCreateRow({
  label,
  onClick,
}: AgentHomeCreateRowProps): React.ReactElement {
  return (
    <Button
      type="button"
      variant="ghost2"
      onClick={(e) => onClick(e.currentTarget)}
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
   * Optional leading icon — centered in the same leading slot as create-row
   * tiles. Rows that need a richer marker than a single glyph use `leading`
   * instead.
   */
  icon?: React.ComponentType<{ className?: string }>;
  /**
   * Custom leading element, rendered in place of `icon` when set. Lets a row
   * supply a richer marker than a single monochrome glyph. Takes precedence
   * over `icon`.
   */
  leading?: React.ReactNode;
  /**
   * Optional control that **replaces** the relative time on hover / keyboard
   * focus — e.g. a project row's inline action cluster — mirroring the
   * chat-history rows (the time is the resting right-edge element; the control
   * takes its slot when the row is active). The row carries `tw-group`, so the
   * swap is pure CSS: the time hides and this slot shows on `group-hover` /
   * `group-focus-within`. Pointer/keyboard events inside the slot are kept from
   * bubbling to the row's `onClick`, so activating a control never also fires
   * the row action.
   */
  trailing?: React.ReactNode;
}

/**
 * Generic clickable list row: optional leading icon/element + truncated label +
 * relative time. The leading slot is filled by `leading` (a custom marker) or
 * a centered `icon`. A row with neither can `indent` so its text still aligns
 * under siblings that do (`tw-pl-6` ≈ icon width + gap).
 */
export const AgentHomeListRow = memo(function AgentHomeListRow({
  label,
  timeMs,
  onClick,
  indent = false,
  icon: Icon,
  leading,
  trailing,
}: AgentHomeListRowProps): React.ReactElement {
  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        "tw-group tw-flex tw-min-h-9 tw-w-full tw-cursor-pointer tw-items-center tw-gap-2 tw-rounded-md tw-px-2 tw-py-1.5",
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
      {leading ??
        (Icon && (
          <span className="tw-flex tw-size-6 tw-shrink-0 tw-items-center tw-justify-center">
            <Icon className="tw-size-4 tw-text-muted" />
          </span>
        ))}
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
        className={cn(
          "tw-shrink-0 tw-whitespace-nowrap tw-text-xs tw-text-muted",
          // Reason: only when a `trailing` control exists does it replace the
          // time on hover/focus — a row without one keeps the time always shown.
          trailing && "group-focus-within:tw-hidden group-hover:tw-hidden"
        )}
        title={new Date(timeMs).toLocaleString()}
      >
        {formatCompactRelativeTime(timeMs)}
      </span>
      {trailing && (
        // Reason: the slot owns independent controls (e.g. an action cluster),
        // so stop pointer/keyboard events from bubbling to the row's onClick —
        // otherwise activating a control would also trigger the row action.
        // Hidden at rest; takes the time's slot on hover/focus so the row's
        // right edge never shows both at once.
        <span
          className="tw-hidden tw-shrink-0 tw-items-center group-focus-within:tw-flex group-hover:tw-flex"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          {trailing}
        </span>
      )}
    </div>
  );
});

interface AgentHomePreviewListProps {
  children: React.ReactNode;
}

/** Shared bounded scroll region for Agent Home projects and chats. */
export function AgentHomePreviewList({ children }: AgentHomePreviewListProps): React.ReactElement {
  return (
    // Radix overlays its scrollbar; the gutter keeps row actions readable.
    // https://github.com/logancyang/obsidian-copilot/issues/3017
    <ScrollArea className="tw-min-h-0 tw-flex-1 tw-overflow-y-auto tw-pr-2.5">
      {children}
    </ScrollArea>
  );
}
