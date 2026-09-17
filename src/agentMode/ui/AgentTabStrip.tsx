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
import { refreshLatestVersion } from "@/hooks/useLatestVersion";
import { cn } from "@/lib/utils";
import { logError } from "@/logger";
import type { AgentSession, AgentSessionStatus } from "@/agentMode/session/AgentSession";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import type { BackendDescriptor } from "@/agentMode/session/types";
import { Loader2, MoreHorizontal, Plus, X } from "lucide-react";
import { Notice } from "obsidian";
import React from "react";

interface Props {
  manager: AgentSessionManager;
}

const TAB_GAP_PX = 4;
const TAB_WIDTH_PX = 128;
const PLUS_BUTTON_PX = 28 + TAB_GAP_PX;
const OVERFLOW_BUTTON_PX = 28 + TAB_GAP_PX;

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
  // Who is answering replaces the backend brand on both the glyph and the
  // untitled-chat fallback, so a DM reads as the agent rather than the harness
  // it happens to run on (`designdocs/CUSTOM_AGENTS.md` §3). A chat with the
  // built-in Copilot is unchanged.
  const agent = session.getAgent();
  return {
    status: session.getStatus(),
    label,
    needsAttention: session.getNeedsAttention(),
    descriptor,
    // Only a chat held with a named agent has a memory file to update.
    hasAgentMemory: agent.slug !== null,
    agentIcon: agent.slug ? agent.icon : "",
    displayLabel: label ?? (agent.slug ? agent.name : (descriptor?.displayName ?? "Session")),
    tooltipLabel: agent.slug
      ? `${agent.name}${label ? ` · ${label}` : ""}`
      : (label ?? descriptor?.displayName ?? "Session"),
  };
}

export const AgentTabStrip: React.FC<Props> = ({ manager }) => {
  const [, setTick] = React.useState(0);
  React.useEffect(() => manager.subscribe(() => setTick((v) => v + 1)), [manager]);

  const sessions = manager.getSessionsForScope(manager.getActiveProjectId());
  const sessionCount = sessions.length;
  const activeId = manager.getActiveSession()?.internalId ?? null;
  const isCreating = manager.getIsStarting();
  const [renamingId, setRenamingId] = React.useState<string | null>(null);

  const stripRef = React.useRef<HTMLDivElement | null>(null);
  const [stripWidth, setStripWidth] = React.useState(0);

  React.useLayoutEffect(() => {
    if (sessionCount === 0) return;
    const strip = stripRef.current;
    if (!strip) return;

    const measure = () => {
      const nextWidth = strip.clientWidth;
      setStripWidth((currentWidth) => (currentWidth === nextWidth ? currentWidth : nextWidth));
    };

    measure();

    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(strip);
    return () => ro.disconnect();
  }, [sessionCount]);

  const visibleCount = React.useMemo(
    () => computeVisibleCount(stripWidth, sessionCount),
    [stripWidth, sessionCount]
  );

  const { visibleSessions, overflowSessions } = React.useMemo(
    () => partitionSessions({ sessions, visibleCount, activeId }),
    [sessions, visibleCount, activeId]
  );

  const handleNew = React.useCallback(() => {
    if (manager.getIsStarting()) return;
    manager
      .createSession()
      .then(() => refreshLatestVersion())
      .catch((e) => logError("[AgentMode] createSession failed", e));
  }, [manager]);

  // "Update memory now" for users who don't want to wait for the chat to end
  // (`designdocs/CUSTOM_AGENTS.md` §5). A chat with nothing new since its last
  // update is a no-op, which is why nothing is reported on the false branch.
  const handleUpdateMemory = React.useCallback(
    (id: string) => {
      if (manager.updateMemoryNow(id)) new Notice("Updating memory…");
    },
    [manager]
  );

  const handleClose = React.useCallback(
    (id: string) => {
      manager.detachSessionFromTab(id);
    },
    [manager]
  );

  if (sessionCount === 0) return null;

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
            onUpdateMemory={() => handleUpdateMemory(session.internalId)}
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
  onUpdateMemory: () => void;
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
  onUpdateMemory,
  onStartRename,
  onSubmitRename,
  onCancelRename,
}) => {
  const {
    status,
    label,
    needsAttention,
    descriptor,
    hasAgentMemory,
    agentIcon,
    displayLabel,
    tooltipLabel,
  } = useSessionDisplay(session);

  const [menuOpen, setMenuOpen] = React.useState(false);

  if (isRenaming) {
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
            agentIcon={agentIcon}
            status={status}
            needsAttention={needsAttention}
            onCloseOnHover={onClose}
          />
          <TruncatedText
            className="tw-min-w-0 tw-flex-1 !tw-text-current"
            tooltipContent={tooltipLabel}
          >
            {displayLabel}
          </TruncatedText>
        </div>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="tw-w-44">
        <DropdownMenuItem onSelect={onStartRename}>Rename</DropdownMenuItem>
        {hasAgentMemory && (
          <DropdownMenuItem onSelect={onUpdateMemory}>Update memory now</DropdownMenuItem>
        )}
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
  /** The agent's emoji, shown instead of the brand glyph. Empty for Copilot. */
  agentIcon?: string;
  status: AgentSessionStatus;
  needsAttention?: boolean;
  onCloseOnHover?: () => void;
}

const BrandIcon: React.FC<BrandIconProps> = ({
  descriptor,
  agentIcon,
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
      ) : agentIcon ? (
        <span className={cn("tw-text-xs", onCloseOnHover && "group-hover:tw-hidden")}>
          {agentIcon}
        </span>
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
  const { status, needsAttention, descriptor, agentIcon, displayLabel, tooltipLabel } =
    useSessionDisplay(session);

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
      <BrandIcon
        descriptor={descriptor}
        agentIcon={agentIcon}
        status={status}
        needsAttention={needsAttention}
      />
      <TruncatedText
        className="tw-min-w-0 tw-flex-1 !tw-text-current"
        tooltipContent={tooltipLabel}
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
