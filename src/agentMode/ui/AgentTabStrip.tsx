import { backendRegistry } from "@/agentMode/backends/registry";
import { TruncatedText } from "@/components/TruncatedText";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { logError } from "@/logger";
import type { AgentSession, AgentSessionStatus } from "@/agentMode/session/AgentSession";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import type { BackendDescriptor } from "@/agentMode/session/types";
import { Loader2, MoreHorizontal, Plus, X } from "lucide-react";
import React from "react";

interface Props {
  manager: AgentSessionManager;
}

const TAB_GAP_PX = 4;
const TAB_WIDTH_PX = 128; // tw-w-32.
const PLUS_BUTTON_PX = 28 + TAB_GAP_PX; // new-session button + leading gap.
const OVERFLOW_BUTTON_PX = 28 + TAB_GAP_PX; // 3-dot trigger + leading gap.

/**
 * Decide how many fixed-width tabs fit in `stripWidth` without overlapping
 * the trailing `+` button or, when overflow is needed, the 3-dot trigger.
 * Pure: no DOM, no React. Returns a value in `[1, sessionCount]` unless
 * `sessionCount` is 0.
 */
export function computeVisibleCount(stripWidth: number, sessionCount: number): number {
  if (sessionCount === 0) return 0;

  const fits = (limitPx: number): number => {
    if (limitPx < TAB_WIDTH_PX) return 0;
    return Math.min(sessionCount, Math.floor((limitPx + TAB_GAP_PX) / (TAB_WIDTH_PX + TAB_GAP_PX)));
  };

  const noOverflowBudget = stripWidth - PLUS_BUTTON_PX;
  const noOverflowCount = fits(noOverflowBudget);
  if (noOverflowCount >= sessionCount) return sessionCount;

  const withOverflowBudget = noOverflowBudget - OVERFLOW_BUTTON_PX;
  return Math.max(1, fits(withOverflowBudget));
}

interface PartitionInput<T extends { internalId: string }> {
  sessions: readonly T[];
  visibleCount: number;
  activeId: string | null;
}

interface Partition<T> {
  visibleSessions: T[];
  overflowSessions: T[];
}

/**
 * Split `sessions` into the visible row and the overflow dropdown given
 * `visibleCount`, then pin the active session into the visible row by
 * swapping it with the last visible slot when it would otherwise be hidden.
 * Pure: no DOM, no React.
 */
export function partitionSessions<T extends { internalId: string }>({
  sessions,
  visibleCount,
  activeId,
}: PartitionInput<T>): Partition<T> {
  if (sessions.length === 0) return { visibleSessions: [], overflowSessions: [] };
  const visible = sessions.slice(0, visibleCount);
  const overflow = sessions.slice(visibleCount);
  if (activeId && overflow.some((s) => s.internalId === activeId)) {
    const activeFromOverflow = overflow.find((s) => s.internalId === activeId)!;
    const otherOverflow = overflow.filter((s) => s.internalId !== activeId);
    const displaced = visible[visible.length - 1];
    const swappedVisible = [...visible.slice(0, -1), activeFromOverflow];
    return {
      visibleSessions: swappedVisible,
      overflowSessions: displaced ? [displaced, ...otherOverflow] : otherOverflow,
    };
  }
  return { visibleSessions: visible, overflowSessions: overflow };
}

/**
 * Live `(status, label, descriptor, displayLabel)` view of a session.
 * Subscribes once so per-session status / label changes don't require a
 * global manager notify and don't multiply listeners on the session.
 */
function useSessionDisplay(session: AgentSession) {
  const [, setTick] = React.useState(0);
  React.useEffect(
    () =>
      session.subscribe({
        onMessagesChanged: () => {},
        onStatusChanged: () => setTick((v) => v + 1),
        onLabelChanged: () => setTick((v) => v + 1),
        onNeedsAttentionChanged: () => setTick((v) => v + 1),
      }),
    [session]
  );
  const label = session.getLabel();
  const descriptor = backendRegistry[session.backendId] as BackendDescriptor | undefined;
  return {
    status: session.getStatus(),
    label,
    needsAttention: session.getNeedsAttention(),
    descriptor,
    displayLabel: label ?? descriptor?.displayName ?? "Session",
  };
}

/**
 * In-panel tab strip rendered above `<AgentChat />`. Shows one tab per
 * session with the backend's brand icon (hover swaps to an X close
 * affordance), a subtle bottom-border highlight on the active tab, and
 * a 3-dot overflow dropdown when there are more tabs than fit. Hidden
 * when no sessions exist — the surrounding router renders the empty-
 * state UI in that case.
 */
export const AgentTabStrip: React.FC<Props> = ({ manager }) => {
  const [, setTick] = React.useState(0);
  React.useEffect(() => manager.subscribe(() => setTick((v) => v + 1)), [manager]);

  // Scope the strip to the active workspace: a project shows only its own
  // sessions, the global workspace shows the global ones. `getSessions()` stays
  // reserved for whole-pool consumers (draft prune / auto-spawn), per §2.4.
  const sessions = manager.getSessionsForScope(manager.getActiveProjectId());
  const activeId = manager.getActiveSession()?.internalId ?? null;
  const isCreating = manager.getIsStarting();
  const [renamingId, setRenamingId] = React.useState<string | null>(null);

  const stripRef = React.useRef<HTMLDivElement | null>(null);
  const [stripWidth, setStripWidth] = React.useState(0);

  React.useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    // ResizeObserver fires once on observe() with the initial size, so no
    // synchronous primer is needed.
    const ro = new ResizeObserver(() => {
      const nextWidth = strip.clientWidth;
      setStripWidth((currentWidth) => (currentWidth === nextWidth ? currentWidth : nextWidth));
    });
    ro.observe(strip);
    return () => ro.disconnect();
  }, []);

  const visibleCount = React.useMemo(
    () => computeVisibleCount(stripWidth, sessions.length),
    [stripWidth, sessions.length]
  );

  const { visibleSessions, overflowSessions } = React.useMemo(
    () => partitionSessions({ sessions, visibleCount, activeId }),
    [sessions, visibleCount, activeId]
  );

  const handleNew = React.useCallback(() => {
    if (manager.getIsStarting()) return;
    manager.createSession().catch((e) => logError("[AgentMode] createSession failed", e));
  }, [manager]);

  const handleClose = React.useCallback(
    (id: string) => {
      manager.closeSession(id).catch((e) => logError("[AgentMode] closeSession failed", e));
    },
    [manager]
  );

  if (sessions.length === 0) return null;

  return (
    <div
      ref={stripRef}
      className="tw-relative tw-flex tw-w-full tw-items-stretch tw-gap-1 tw-overflow-hidden tw-px-2"
    >
      <div role="tablist" className="tw-flex tw-min-w-0 tw-items-stretch tw-gap-1">
        {visibleSessions.map((session) => (
          <SessionTab
            key={session.internalId}
            session={session}
            isActive={session.internalId === activeId}
            isRenaming={renamingId === session.internalId}
            onActivate={() => manager.setActiveSession(session.internalId)}
            onClose={() => handleClose(session.internalId)}
            onStartRename={() => setRenamingId(session.internalId)}
            onSubmitRename={(label) => {
              manager.renameSession(session.internalId, label);
              setRenamingId(null);
            }}
            onCancelRename={() => setRenamingId(null)}
          />
        ))}
      </div>
      {overflowSessions.length > 0 && (
        <OverflowMenu
          sessions={overflowSessions}
          activeId={activeId}
          onActivate={(id) => manager.setActiveSession(id)}
          onClose={handleClose}
        />
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost2"
            size="icon"
            onClick={handleNew}
            disabled={isCreating}
            aria-label="New agent session"
            className="tw-my-1 tw-shrink-0"
          >
            <Plus className="tw-size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>New agent session</TooltipContent>
      </Tooltip>
    </div>
  );
};

interface TabProps {
  session: AgentSession;
  isActive: boolean;
  isRenaming: boolean;
  onActivate: () => void;
  onClose: () => void;
  onStartRename: () => void;
  onSubmitRename: (label: string) => void;
  onCancelRename: () => void;
}

const SessionTab: React.FC<TabProps> = ({
  session,
  isActive,
  isRenaming,
  onActivate,
  onClose,
  onStartRename,
  onSubmitRename,
  onCancelRename,
}) => {
  const { status, label, needsAttention, descriptor, displayLabel } = useSessionDisplay(session);

  const [menuOpen, setMenuOpen] = React.useState(false);

  if (isRenaming) {
    // Keyed on session id so a switch to renaming a different tab remounts
    // the input with a fresh draft seeded from that session's label.
    return (
      <RenameInput
        key={session.internalId}
        initialValue={label ?? ""}
        onSubmit={onSubmitRename}
        onCancel={onCancelRename}
      />
    );
  }

  return (
    <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen} modal={false}>
      <DropdownMenuTrigger asChild>
        <div
          role="tab"
          aria-selected={isActive}
          tabIndex={0}
          onPointerDown={(e) => {
            // DropdownMenuTrigger opens on primary-button pointerDown; suppress
            // that so left-click only activates the tab. The menu opens via
            // onContextMenu below.
            if (e.button !== 2) e.preventDefault();
          }}
          onClick={onActivate}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onActivate();
            }
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenuOpen(true);
          }}
          className={cn(
            "tw-group tw-flex tw-h-7 tw-w-32 tw-min-w-0 tw-shrink-0 tw-cursor-pointer tw-items-center tw-gap-1.5",
            "tw-my-1 tw-rounded-sm tw-px-2 tw-text-xs tw-transition-colors",
            "focus-visible:tw-outline-none focus-visible:tw-ring-1 focus-visible:tw-ring-ring",
            isActive
              ? "tw-border-interactive-accent tw-text-normal tw-bg-interactive-accent/10"
              : "tw-border-transparent tw-text-faint hover:tw-bg-modifier-hover hover:tw-text-normal"
          )}
        >
          <BrandIcon
            descriptor={descriptor}
            status={status}
            needsAttention={needsAttention}
            onCloseOnHover={onClose}
          />
          <TruncatedText
            className="tw-min-w-0 tw-flex-1 !tw-text-current"
            tooltipContent={displayLabel}
          >
            {displayLabel}
          </TruncatedText>
        </div>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="tw-w-32">
        <DropdownMenuItem onSelect={onStartRename}>Rename</DropdownMenuItem>
        <DropdownMenuItem onSelect={onClose}>Close</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

interface RenameInputProps {
  initialValue: string;
  onSubmit: (label: string) => void;
  onCancel: () => void;
}

/**
 * Rename text-field for `SessionTab`. Owns the draft locally and is keyed
 * by session id so each rename session starts with a fresh draft seeded
 * from `initialValue`. Escape sets a ref so the unmount-triggered onBlur
 * doesn't commit the discarded draft.
 */
const RenameInput: React.FC<RenameInputProps> = ({ initialValue, onSubmit, onCancel }) => {
  const [draft, setDraft] = React.useState(initialValue);
  const cancelledRef = React.useRef(false);
  return (
    <Input
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (cancelledRef.current) return;
        onSubmit(draft);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onSubmit(draft);
        } else if (e.key === "Escape") {
          e.preventDefault();
          cancelledRef.current = true;
          onCancel();
        }
      }}
      className="tw-my-1 tw-h-6 tw-w-32 tw-text-xs"
    />
  );
};

interface BrandIconProps {
  descriptor: BackendDescriptor | undefined;
  status: AgentSessionStatus;
  /** Accent dot — set when the session demands the user's attention. */
  needsAttention?: boolean;
  /** When set, hovering the parent `group` swaps the icon for an X close button. */
  onCloseOnHover?: () => void;
}

/**
 * Backend brand icon with status overlays. While the session is `running`
 * a spinner replaces the brand icon. Otherwise the brand icon shows, with
 * a tiny dot at the bottom-right when the tab actually demands the user's
 * eye: a steady accent dot when `needsAttention` is set (something
 * happened on a backgrounded tab), or a red dot on error. When
 * `onCloseOnHover` is set, hovering the parent `.group` swaps the icon
 * for an X close button — used by visible tabs. Dropdown rows pass no
 * handler and render only the icon (close affordance lives on the right
 * of the row instead).
 */
const BrandIcon: React.FC<BrandIconProps> = ({
  descriptor,
  status,
  needsAttention,
  onCloseOnHover,
}) => {
  const Icon = descriptor?.Icon;
  const isInProgress = status === "running";
  const isError = status === "error";
  const showStatusDot = !isInProgress && (needsAttention || isError);

  const dotColorClass = needsAttention ? "tw-bg-interactive-accent" : "tw-bg-red";

  return (
    <span className="tw-relative tw-flex tw-size-4 tw-shrink-0 tw-items-center tw-justify-center">
      {isInProgress ? (
        <Loader2
          className={cn(
            "tw-size-4 tw-animate-spin tw-text-loading",
            onCloseOnHover && "group-hover:tw-hidden"
          )}
        />
      ) : Icon ? (
        <Icon className={cn("tw-size-4", onCloseOnHover && "group-hover:tw-hidden")} />
      ) : (
        <span
          className={cn(
            "tw-size-3 tw-rounded-full tw-bg-faint/40",
            onCloseOnHover && "group-hover:tw-hidden"
          )}
        />
      )}
      {onCloseOnHover && (
        <Button
          variant="ghost2"
          size="icon"
          aria-label="Close session"
          onClick={(e) => {
            e.stopPropagation();
            onCloseOnHover();
          }}
          className="tw-hidden tw-size-5 tw-cursor-pointer tw-rounded-sm tw-p-0 group-hover:tw-flex"
        >
          <X className="tw-size-4" />
        </Button>
      )}
      {showStatusDot && (
        <span
          aria-hidden
          className={cn(
            "tw-absolute -tw-right-0.5 -tw-top-0.5 tw-size-1.5 tw-rounded-full tw-ring-1 tw-ring-[var(--background-primary)]",
            onCloseOnHover && "group-hover:tw-hidden",
            dotColorClass
          )}
        />
      )}
    </span>
  );
};

interface OverflowMenuProps {
  sessions: AgentSession[];
  activeId: string | null;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
}

const OverflowMenu: React.FC<OverflowMenuProps> = ({ sessions, activeId, onActivate, onClose }) => {
  const [open, setOpen] = React.useState(false);
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost2"
          size="icon"
          className="tw-my-1 tw-shrink-0"
          aria-label={`Show ${sessions.length} more session${sessions.length === 1 ? "" : "s"}`}
        >
          <MoreHorizontal className="tw-size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="tw-w-64">
        {sessions.map((session) => (
          <OverflowRow
            key={session.internalId}
            session={session}
            isActive={session.internalId === activeId}
            onActivate={() => {
              onActivate(session.internalId);
              setOpen(false);
            }}
            onClose={() => onClose(session.internalId)}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

interface OverflowRowProps {
  session: AgentSession;
  isActive: boolean;
  onActivate: () => void;
  onClose: () => void;
}

const OverflowRow: React.FC<OverflowRowProps> = ({ session, isActive, onActivate, onClose }) => {
  const { status, needsAttention, descriptor, displayLabel } = useSessionDisplay(session);

  // Plain div row instead of DropdownMenuItem: MenuItem synthesizes a select
  // on pointerup (`currentTarget.click()`) which would activate the session
  // and unmount this row before our X button's onClick fires. The chat-history
  // popover (`ChatHistoryPopover`) uses the same pattern — group hover reveals
  // action buttons whose onClick handlers stopPropagation to keep row clicks
  // separate from button clicks.
  return (
    <div
      role="menuitem"
      tabIndex={-1}
      onClick={onActivate}
      className={cn(
        "tw-group tw-flex tw-cursor-pointer tw-select-none tw-items-center tw-gap-2 tw-rounded-sm tw-px-2 tw-py-1.5 tw-text-sm tw-outline-none tw-transition-colors hover:tw-bg-modifier-hover hover:tw-text-normal",
        isActive && "tw-bg-interactive-accent/10"
      )}
    >
      <BrandIcon descriptor={descriptor} status={status} needsAttention={needsAttention} />
      <TruncatedText
        className="tw-min-w-0 tw-flex-1 !tw-text-current"
        tooltipContent={displayLabel}
      >
        {displayLabel}
      </TruncatedText>
      <Button
        variant="ghost2"
        size="icon"
        aria-label="Close session"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className="tw-size-5 tw-shrink-0 tw-cursor-pointer tw-rounded-sm tw-p-0"
      >
        <X className="tw-size-4" />
      </Button>
    </div>
  );
};
