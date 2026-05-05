import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverAnchor } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { logError } from "@/logger";
import type { AgentSession, AgentSessionStatus } from "@/agentMode/session/AgentSession";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import { Plus } from "lucide-react";
import React from "react";

interface Props {
  manager: AgentSessionManager;
}

/**
 * In-panel tab strip rendered above `<AgentChat />`. Shows one tab per
 * session in the manager's pool with a `+` button to spawn a new session
 * and a right-click menu per tab for End / Rename. Hidden when no sessions
 * exist — the surrounding router renders the empty-state UI in that case.
 */
export const AgentTabStrip: React.FC<Props> = ({ manager }) => {
  // Tick on any manager notify so we re-read sessions / active id inline.
  const [, setTick] = React.useState(0);
  React.useEffect(() => manager.subscribe(() => setTick((v) => v + 1)), [manager]);

  const sessions = manager.getSessions();
  const activeId = manager.getActiveSession()?.internalId ?? null;
  const isCreating = manager.getIsStarting();
  const [renamingId, setRenamingId] = React.useState<string | null>(null);

  const handleNew = React.useCallback(() => {
    // Guard against double-clicks: the manager intentionally does not dedupe
    // direct `createSession()` calls, so the button-disabled state is the
    // only thing standing between a rapid double-click and two new tabs.
    if (manager.getIsStarting()) return;
    manager.createSession().catch((e) => logError("[AgentMode] createSession failed", e));
  }, [manager]);

  if (sessions.length === 0) return null;

  return (
    <div className="tw-flex tw-w-full tw-items-center tw-gap-1 tw-overflow-x-auto tw-border-b tw-border-border tw-px-1 tw-py-0.5">
      {sessions.map((session, index) => (
        <SessionTab
          key={session.internalId}
          session={session}
          index={index}
          isActive={session.internalId === activeId}
          isRenaming={renamingId === session.internalId}
          onActivate={() => manager.setActiveSession(session.internalId)}
          onClose={() =>
            manager
              .closeSession(session.internalId)
              .catch((e) => logError("[AgentMode] closeSession failed", e))
          }
          onStartRename={() => setRenamingId(session.internalId)}
          onSubmitRename={(label) => {
            manager.renameSession(session.internalId, label);
            setRenamingId(null);
          }}
          onCancelRename={() => setRenamingId(null)}
        />
      ))}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost2"
            size="icon"
            onClick={handleNew}
            disabled={isCreating}
            aria-label="New agent session"
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
  index: number;
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
  index,
  isActive,
  isRenaming,
  onActivate,
  onClose,
  onStartRename,
  onSubmitRename,
  onCancelRename,
}) => {
  // Subscribe to per-session status / label changes so the dot + label stay
  // live without a global manager notify.
  const [status, setStatus] = React.useState<AgentSessionStatus>(session.getStatus());
  const [label, setLabel] = React.useState<string | null>(session.getLabel());
  React.useEffect(() => {
    setStatus(session.getStatus());
    setLabel(session.getLabel());
    return session.subscribe({
      onMessagesChanged: () => {},
      onStatusChanged: (s) => setStatus(s),
      onLabelChanged: () => setLabel(session.getLabel()),
    });
  }, [session]);

  const [draft, setDraft] = React.useState(label ?? "");
  React.useEffect(() => {
    if (isRenaming) setDraft(label ?? "");
  }, [isRenaming, label]);

  const [menuOpen, setMenuOpen] = React.useState(false);
  // Set when Escape fires so the unmount-triggered onBlur doesn't commit the
  // discarded draft. Reset on next rename open.
  const cancelledRef = React.useRef(false);
  React.useEffect(() => {
    if (isRenaming) cancelledRef.current = false;
  }, [isRenaming]);

  const displayLabel = label ?? `Session ${index + 1}`;
  const isBusy = status === "running" || status === "awaiting_permission";
  const isError = status === "error";
  // Only attach a tooltip when the label would actually overflow the 12ch
  // truncation — avoids redundant tooltips on short labels.
  const tooltipTitle = displayLabel.length > 12 ? displayLabel : undefined;

  if (isRenaming) {
    return (
      <Input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (cancelledRef.current) return;
          onSubmitRename(draft);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onSubmitRename(draft);
          } else if (e.key === "Escape") {
            e.preventDefault();
            cancelledRef.current = true;
            onCancelRename();
          }
        }}
        className="tw-h-6 tw-w-32 tw-text-xs"
      />
    );
  }

  return (
    <Popover open={menuOpen} onOpenChange={setMenuOpen}>
      <PopoverAnchor asChild>
        <Button
          variant={isActive ? "default" : "ghost2"}
          size="sm"
          onClick={onActivate}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenuOpen(true);
          }}
          title={tooltipTitle}
          className="tw-h-7 tw-shrink-0 tw-gap-1.5 tw-px-2 tw-text-xs"
        >
          <span
            className={
              "tw-inline-block tw-size-1.5 tw-rounded-full " +
              (isError ? "tw-bg-red" : isBusy ? "tw-animate-pulse tw-bg-blue" : "tw-bg-faint/50")
            }
            aria-hidden
          />
          <span className="tw-max-w-[12ch] tw-truncate">{displayLabel}</span>
        </Button>
      </PopoverAnchor>
      <PopoverContent align="start" className="tw-w-32 tw-p-1">
        <button
          type="button"
          className="tw-flex tw-w-full tw-cursor-pointer tw-items-center tw-rounded-sm tw-border-none tw-bg-transparent tw-px-2 tw-py-1.5 tw-text-left tw-text-sm tw-text-normal hover:tw-bg-modifier-hover"
          onClick={() => {
            setMenuOpen(false);
            onStartRename();
          }}
        >
          Rename
        </button>
        <button
          type="button"
          className="tw-flex tw-w-full tw-cursor-pointer tw-items-center tw-rounded-sm tw-border-none tw-bg-transparent tw-px-2 tw-py-1.5 tw-text-left tw-text-sm tw-text-error hover:tw-bg-modifier-error-hover"
          onClick={() => {
            setMenuOpen(false);
            onClose();
          }}
        >
          End
        </button>
      </PopoverContent>
    </Popover>
  );
};
