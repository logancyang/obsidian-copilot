import type { ClientView } from "@/agentMode/protocol/ClientView";
import { useClientView } from "@/agentMode/protocol/react";
import type { SessionClient } from "@/agentMode/protocol/SessionClient";
import type { TabSummary } from "@/agentMode/protocol/state";
import { useAgentPaneCapabilities } from "@/agentMode/ui/AgentPaneContext";
import { useTabCommands } from "@/agentMode/ui/hooks/useTabCommands";
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
import { Loader2, MoreHorizontal, Plus, X } from "lucide-react";
import React from "react";

interface Props {
  client: SessionClient;
  view: ClientView;
  onCreated?: () => void;
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

interface PartitionInput<T extends { id: string }> {
  sessions: readonly T[];
  visibleCount: number;
  activeId: string | null;
}

interface Partition<T> {
  visibleSessions: T[];
  overflowSessions: T[];
}

export function partitionSessions<T extends { id: string }>({
  sessions,
  visibleCount,
  activeId,
}: PartitionInput<T>): Partition<T> {
  if (sessions.length === 0) return { visibleSessions: [], overflowSessions: [] };
  const visible = sessions.slice(0, visibleCount);
  const overflow = sessions.slice(visibleCount);
  if (activeId && overflow.some((s) => s.id === activeId)) {
    const activeFromOverflow = overflow.find((s) => s.id === activeId)!;
    const otherOverflow = overflow.filter((s) => s.id !== activeId);
    const displaced = visible[visible.length - 1];
    const swappedVisible = [...visible.slice(0, -1), activeFromOverflow];
    return {
      visibleSessions: swappedVisible,
      overflowSessions: displaced ? [displaced, ...otherOverflow] : otherOverflow,
    };
  }
  return { visibleSessions: visible, overflowSessions: overflow };
}

function useTabDisplay(tab: TabSummary, backendNames: ReadonlyMap<string, string>) {
  const Icon = useAgentPaneCapabilities().backendIcon?.(tab.backendId);
  return {
    Icon,
    displayLabel: tab.label ?? backendNames.get(tab.backendId) ?? "Session",
  };
}

export const AgentTabStrip: React.FC<Props> = ({ client, view, onCreated }) => {
  const { host, scopeTabs: sessions, activeTab } = useClientView(client, view);
  const commands = useTabCommands(client, view);
  const sessionCount = sessions.length;
  const activeId = activeTab?.id ?? null;
  const isCreating = host?.host.startingBackendId != null;
  const backendNames = React.useMemo(
    () => new Map((host?.backends ?? []).map((backend) => [backend.id, backend.displayName])),
    [host?.backends]
  );
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
    if (isCreating) return;
    void commands.createTab().then((result) => {
      if (result.ok) onCreated?.();
    });
  }, [commands, isCreating, onCreated]);

  const handleClose = React.useCallback(
    (id: string) => {
      void commands.closeTab(id);
    },
    [commands]
  );

  if (sessionCount === 0) return null;

  return (
    <div
      ref={stripRef}
      className="tw-relative tw-flex tw-w-full tw-items-stretch tw-gap-1 tw-overflow-hidden tw-px-2"
    >
      <div role="tablist" className="tw-flex tw-min-w-0 tw-items-stretch tw-gap-1">
        {visibleSessions.map((tab) => (
          <SessionTab
            key={tab.id}
            tab={tab}
            backendNames={backendNames}
            isActive={tab.id === activeId}
            isRenaming={renamingId === tab.id}
            onActivate={() => commands.showTab(tab.id)}
            onClose={() => handleClose(tab.id)}
            onStartRename={() => setRenamingId(tab.id)}
            onSubmitRename={(label) => {
              void commands.renameTab(tab.id, label);
              setRenamingId(null);
            }}
            onCancelRename={() => setRenamingId(null)}
          />
        ))}
      </div>
      {overflowSessions.length > 0 && (
        <OverflowMenu
          sessions={overflowSessions}
          backendNames={backendNames}
          activeId={activeId}
          onActivate={(id) => commands.showTab(id)}
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
  tab: TabSummary;
  backendNames: ReadonlyMap<string, string>;
  isActive: boolean;
  isRenaming: boolean;
  onActivate: () => void;
  onClose: () => void;
  onStartRename: () => void;
  onSubmitRename: (label: string) => void;
  onCancelRename: () => void;
}

const SessionTab: React.FC<TabProps> = ({
  tab,
  backendNames,
  isActive,
  isRenaming,
  onActivate,
  onClose,
  onStartRename,
  onSubmitRename,
  onCancelRename,
}) => {
  const { Icon, displayLabel } = useTabDisplay(tab, backendNames);

  const [menuOpen, setMenuOpen] = React.useState(false);

  if (isRenaming) {
    return (
      <RenameInput
        key={tab.id}
        initialValue={tab.label ?? ""}
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
            Icon={Icon}
            status={tab.status}
            needsAttention={tab.needsAttention}
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
  Icon: React.ComponentType<{ className?: string }> | undefined;
  status: TabSummary["status"];
  needsAttention?: boolean;
  onCloseOnHover?: () => void;
}

const BrandIcon: React.FC<BrandIconProps> = ({ Icon, status, needsAttention, onCloseOnHover }) => {
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
  sessions: readonly TabSummary[];
  backendNames: ReadonlyMap<string, string>;
  activeId: string | null;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
}

const OverflowMenu: React.FC<OverflowMenuProps> = ({
  sessions,
  backendNames,
  activeId,
  onActivate,
  onClose,
}) => {
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
        {sessions.map((tab) => (
          <OverflowRow
            key={tab.id}
            tab={tab}
            backendNames={backendNames}
            isActive={tab.id === activeId}
            onActivate={() => {
              onActivate(tab.id);
              setOpen(false);
            }}
            onClose={() => onClose(tab.id)}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

interface OverflowRowProps {
  tab: TabSummary;
  backendNames: ReadonlyMap<string, string>;
  isActive: boolean;
  onActivate: () => void;
  onClose: () => void;
}

const OverflowRow: React.FC<OverflowRowProps> = ({
  tab,
  backendNames,
  isActive,
  onActivate,
  onClose,
}) => {
  const { Icon, displayLabel } = useTabDisplay(tab, backendNames);

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
      <BrandIcon Icon={Icon} status={tab.status} needsAttention={tab.needsAttention} />
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
