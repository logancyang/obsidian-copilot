import { backendRegistry } from "@/agentMode/backends/registry";
import { overflowDot, tabDot, type TabDot } from "@/agents/agentMode/tabDot";
import type { CustomAgent } from "@/agents/CustomAgentStore";
import { AgentFace } from "@/agents/ui/AgentFace";
import { TruncatedText } from "@/components/TruncatedText";
import { computeVisibleTabIndices } from "@/components/ui/tabOverflow";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useApp } from "@/context";
import { useSessionsSidebarOpen } from "@/agentMode/navigator/hooks/useSessionsSidebarOpen";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { logError } from "@/logger";
import type { AgentSession, AgentSessionStatus } from "@/agentMode/session/AgentSession";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import type { BackendDescriptor } from "@/agentMode/session/types";
import { Loader2, MoreHorizontal, PanelLeft, Plus, X } from "lucide-react";
import React from "react";

interface Props {
  manager: AgentSessionManager;
  onOpenSidebar: () => void;
  agents?: readonly CustomAgent[];
  onTabClick?: () => void;
}

const NO_AGENTS: readonly CustomAgent[] = Object.freeze([]);

const TAB_GAP_PX = 4;
const TAB_WIDTH_PX = 128;
const PLUS_BUTTON_PX = 28 + TAB_GAP_PX;
const OVERFLOW_BUTTON_PX = 28;

const DOT_CLASS: Record<TabDot, string> = {
  waiting: "tw-bg-[var(--color-orange)]",
  done: "tw-bg-[var(--color-green)]",
  error: "tw-bg-red",
};

function useSessionDisplay(session: AgentSession, agents: readonly CustomAgent[], active: boolean) {
  const [, setTick] = React.useState(0);
  const dot = tabDot(session, active);
  const dotRef = React.useRef(dot);
  dotRef.current = dot;
  React.useEffect(
    () =>
      session.subscribe({
        onMessagesChanged: () => {
          if (tabDot(session, active) !== dotRef.current) setTick((v) => v + 1);
        },
        onStatusChanged: () => setTick((v) => v + 1),
        onLabelChanged: () => setTick((v) => v + 1),
        onNeedsAttentionChanged: () => setTick((v) => v + 1),
      }),
    [session, active]
  );
  const label = session.getLabel();
  const descriptor = backendRegistry[session.backendId] as BackendDescriptor | undefined;
  return {
    status: session.getStatus(),
    label,
    dot,
    descriptor,
    faceSrc: agents.find((agent) => agent.slug === session.agentSlug)?.faceSrc,
    displayLabel: label ?? descriptor?.displayName ?? "Chat",
  };
}

function overflowDotOf(sessions: readonly AgentSession[]) {
  return overflowDot(sessions.map((session) => tabDot(session)));
}

function useOverflowDot(sessions: readonly AgentSession[]) {
  const [, setTick] = React.useState(0);
  const dot = overflowDotOf(sessions);
  const dotRef = React.useRef(dot);
  dotRef.current = dot;
  React.useEffect(() => {
    const check = () => {
      if (overflowDotOf(sessions) !== dotRef.current) setTick((v) => v + 1);
    };
    const unsubscribes = sessions.map((session) =>
      session.subscribe({
        onMessagesChanged: check,
        onStatusChanged: check,
        onNeedsAttentionChanged: check,
      })
    );
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, [sessions]);
  return dot;
}

export const AgentTabStrip: React.FC<Props> = ({
  manager,
  onOpenSidebar,
  agents = NO_AGENTS,
  onTabClick,
}) => {
  const isHidden = useSessionsSidebarOpen(useApp());
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
    if (sessionCount === 0 || isHidden) return;
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
  }, [sessionCount, isHidden]);

  const { visibleSessions, overflowSessions } = React.useMemo(() => {
    const visibleIndices = computeVisibleTabIndices({
      widths: sessions.map(() => TAB_WIDTH_PX),
      selectedIndex: sessions.findIndex((session) => session.internalId === activeId),
      available: stripWidth - PLUS_BUTTON_PX,
      gap: TAB_GAP_PX,
      overflowWidth: OVERFLOW_BUTTON_PX,
    });
    return {
      visibleSessions: visibleIndices.map((i) => sessions[i]),
      overflowSessions: sessions.filter((_, i) => !visibleIndices.includes(i)),
    };
  }, [sessions, stripWidth, activeId]);

  const handleNew = React.useCallback(() => {
    if (manager.getIsStarting()) return;
    manager.createSession().catch((e) => logError("[AgentMode] createSession failed", e));
  }, [manager]);

  const handleClose = React.useCallback(
    (id: string) => {
      manager.detachSessionFromTab(id);
    },
    [manager]
  );

  if (sessionCount === 0 || isHidden) return null;

  return (
    <div className="tw-flex tw-w-full tw-items-stretch tw-pl-2">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost2"
            size="icon"
            onClick={onOpenSidebar}
            aria-label="Open Copilot Navigator"
            className="tw-my-1 tw-shrink-0"
          >
            <PanelLeft className="tw-size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Open Copilot Navigator</TooltipContent>
      </Tooltip>
      <div
        ref={stripRef}
        className="tw-relative tw-flex tw-min-w-0 tw-flex-1 tw-items-stretch tw-gap-1 tw-overflow-hidden tw-px-2"
      >
        <div role="tablist" className="tw-flex tw-min-w-0 tw-items-stretch tw-gap-1">
          {visibleSessions.map((session) => (
            <SessionTab
              key={session.internalId}
              session={session}
              agents={agents}
              isActive={session.internalId === activeId}
              isRenaming={renamingId === session.internalId}
              onActivate={() => {
                manager.setActiveSession(session.internalId);
                onTabClick?.();
              }}
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
            agents={agents}
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
              aria-label="New chat"
              className="tw-my-1 tw-shrink-0"
            >
              <Plus className="tw-size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>New chat</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
};

interface TabProps {
  session: AgentSession;
  agents: readonly CustomAgent[];
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
  agents,
  isActive,
  isRenaming,
  onActivate,
  onClose,
  onStartRename,
  onSubmitRename,
  onCancelRename,
}) => {
  const { status, label, dot, descriptor, faceSrc, displayLabel } = useSessionDisplay(
    session,
    agents,
    isActive
  );

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
          onAuxClick={(e) => {
            if (e.button === 1) onClose();
          }}
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
            faceSrc={faceSrc}
            status={status}
            dot={dot}
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
  faceSrc?: string;
  faceSize?: "xs" | "s";
  status: AgentSessionStatus;
  dot: TabDot | null;
  onCloseOnHover?: () => void;
}

const BrandIcon: React.FC<BrandIconProps> = ({
  descriptor,
  faceSrc,
  faceSize = "xs",
  status,
  dot,
  onCloseOnHover,
}) => {
  const Icon = descriptor?.Icon;
  const isInProgress = status === "running";

  return (
    <span
      className={cn(
        "tw-relative tw-flex tw-size-4 tw-shrink-0 tw-items-center tw-justify-center",
        faceSrc && faceSize === "s" && "tw-size-5"
      )}
    >
      {faceSrc ? (
        <AgentFace
          src={faceSrc}
          size={faceSize}
          running={isInProgress}
          className={cn(onCloseOnHover && "group-hover:tw-hidden")}
        />
      ) : isInProgress ? (
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
          aria-label="Close tab"
          onClick={(e) => {
            e.stopPropagation();
            onCloseOnHover();
          }}
          className="tw-hidden tw-size-5 tw-cursor-pointer tw-rounded-sm tw-p-0 group-hover:tw-flex"
        >
          <X className="tw-size-4" />
        </Button>
      )}
      {dot && (
        <span
          aria-hidden
          className={cn(
            "tw-absolute -tw-right-0.5 -tw-top-0.5 tw-size-1.5 tw-rounded-full tw-ring-1 tw-ring-[var(--background-primary)]",
            onCloseOnHover && "group-hover:tw-hidden",
            DOT_CLASS[dot]
          )}
        />
      )}
    </span>
  );
};

interface OverflowMenuProps {
  sessions: AgentSession[];
  agents: readonly CustomAgent[];
  activeId: string | null;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
}

const OverflowMenu: React.FC<OverflowMenuProps> = ({
  sessions,
  agents,
  activeId,
  onActivate,
  onClose,
}) => {
  const [open, setOpen] = React.useState(false);
  const dot = useOverflowDot(sessions);
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost2"
          size="icon"
          className="tw-relative tw-my-1 tw-shrink-0"
          aria-label={`Show ${sessions.length} more chat${sessions.length === 1 ? "" : "s"}`}
        >
          <MoreHorizontal className="tw-size-4" />
          {dot && (
            <span
              aria-hidden
              className={cn(
                "tw-absolute tw-right-1 tw-top-1 tw-size-1.5 tw-rounded-full tw-ring-1 tw-ring-[var(--background-primary)]",
                DOT_CLASS[dot]
              )}
            />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="tw-w-64">
        {sessions.map((session) => (
          <OverflowRow
            key={session.internalId}
            session={session}
            agents={agents}
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
  agents: readonly CustomAgent[];
  isActive: boolean;
  onActivate: () => void;
  onClose: () => void;
}

const OverflowRow: React.FC<OverflowRowProps> = ({
  session,
  agents,
  isActive,
  onActivate,
  onClose,
}) => {
  const { status, dot, descriptor, faceSrc, displayLabel } = useSessionDisplay(
    session,
    agents,
    isActive
  );

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
      <BrandIcon descriptor={descriptor} faceSrc={faceSrc} faceSize="s" status={status} dot={dot} />
      <TruncatedText
        className="tw-min-w-0 tw-flex-1 !tw-text-current"
        tooltipContent={displayLabel}
      >
        {displayLabel}
      </TruncatedText>
      <Button
        variant="ghost2"
        size="icon"
        aria-label="Close tab"
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
