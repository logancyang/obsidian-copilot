import {
  RecentChatMenu,
  RowActionButton,
  type RecentChatActions,
} from "@/agentMode/ui/RecentChatMenu";
import { RecentChatProjectBadge, RecentChatTitle } from "@/agentMode/ui/RecentChatTitle";
import type { ChatHistoryItem } from "@/components/chat-components/ChatHistoryPopover";
import { cn } from "@/lib/utils";
import { isNativeChatId } from "@/utils/nativeChatId";
import { safeAsyncHandler } from "@/utils/safeAsyncHandler";
import { CircleAlert, LoaderCircle, X } from "lucide-react";
import React, { useState } from "react";

export type SessionStatus = "idle" | "running" | "waiting" | "unread";

interface SessionStatusFlags {
  waiting: boolean;
  unread: boolean;
  running: boolean;
}

export function resolveSessionStatus({
  waiting,
  unread,
  running,
}: SessionStatusFlags): SessionStatus {
  if (waiting) return "waiting";
  if (running) return "running";
  return unread ? "unread" : "idle";
}

const STATUS_URGENCY: readonly SessionStatus[] = ["idle", "running", "unread", "waiting"];

export function mostUrgentStatus(statuses: Iterable<SessionStatus>): SessionStatus {
  let urgent: SessionStatus = "idle";
  for (const status of statuses) {
    if (STATUS_URGENCY.indexOf(status) > STATUS_URGENCY.indexOf(urgent)) urgent = status;
  }
  return urgent;
}

interface SessionsSidebarRowProps {
  item: ChatHistoryItem;
  status: SessionStatus;
  active: boolean;
  isSessionOpen: boolean;
  projectName?: string;
  actions: RecentChatActions;
  onSelect: () => void;
}

export const SessionStatusIcon: React.FC<{ status: SessionStatus; isSessionOpen?: boolean }> = ({
  status,
  isSessionOpen,
}) => {
  switch (status) {
    case "running":
      return (
        <span role="img" aria-label="Running" className="tw-flex tw-shrink-0">
          <LoaderCircle className="tw-size-3.5 tw-animate-spin tw-text-accent" />
        </span>
      );
    case "waiting":
      return (
        <span role="img" aria-label="Waiting for permission" className="tw-flex tw-shrink-0">
          <CircleAlert className="tw-size-3.5 tw-text-warning" />
        </span>
      );
    case "unread":
    case "idle":
      return isSessionOpen ? (
        <span
          role="img"
          aria-label="Session open"
          className="tw-size-2 tw-shrink-0 tw-rounded-full tw-bg-change-inserted"
        />
      ) : null;
  }
};

export const SessionsSidebarRow: React.FC<SessionsSidebarRowProps> = ({
  item,
  status,
  active,
  isSessionOpen,
  projectName,
  actions,
  onSelect,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const closeSession = isSessionOpen ? actions.onCloseSession : undefined;
  return (
    <div
      className={cn(
        "tw-group tw-flex tw-min-w-0 tw-items-center tw-gap-1 tw-rounded-md",
        "focus-within:tw-bg-modifier-hover hover:tw-bg-modifier-hover",
        active && "tw-bg-modifier-active-hover hover:tw-bg-modifier-active-hover"
      )}
      onContextMenu={(event) => {
        event.preventDefault();
        setMenuOpen(true);
      }}
    >
      <button
        type="button"
        aria-current={active ? "true" : undefined}
        onClick={onSelect}
        className={cn(
          "clickable-icon tw-flex tw-h-auto tw-min-w-0 tw-flex-1 tw-items-center tw-gap-2",
          "tw-rounded-md tw-bg-transparent tw-px-2 tw-py-1.5 tw-text-left tw-shadow-none"
        )}
      >
        {/* An unseen result reads like unread mail, a bold title, so the one status dot keeps meaning "session open".
            https://github.com/Brevilabs/obsidian-copilot-private/issues/801 */}
        <RecentChatTitle
          title={item.title}
          className={cn(status === "unread" && "tw-font-semibold")}
        />
        {status === "unread" && (
          <span role="img" aria-label="Unread result" className="tw-sr-only" />
        )}
        {projectName && <RecentChatProjectBadge name={projectName} />}
        {/* Titles start flush with the panel and the status sits at the right end, where hovering the row swaps it
            for the row's actions; a long title ellipsizes before the status.
            https://github.com/Brevilabs/obsidian-copilot-private/issues/801 */}
        <span
          className={cn(
            "tw-flex tw-size-4 tw-shrink-0 tw-items-center tw-justify-center",
            menuOpen ? "tw-hidden" : "group-focus-within:tw-hidden group-hover:tw-hidden"
          )}
        >
          <SessionStatusIcon status={status} isSessionOpen={isSessionOpen} />
        </span>
      </button>
      {/* The open menu is anchored to More actions, so the trigger stays shown after the pointer leaves the row.
          https://github.com/Brevilabs/obsidian-copilot-private/issues/693 */}
      <div
        className={cn(
          "tw-shrink-0 tw-items-center tw-pr-1",
          menuOpen ? "tw-flex" : "tw-hidden group-focus-within:tw-flex group-hover:tw-flex"
        )}
      >
        {closeSession && (
          <RowActionButton
            label="Close chat"
            onClick={() => safeAsyncHandler(closeSession)(item.id)}
          >
            <X className="tw-size-3.5" />
          </RowActionButton>
        )}
        <RecentChatMenu
          item={item}
          isNoteBacked={!isNativeChatId(item.id)}
          isSessionOpen={isSessionOpen}
          open={menuOpen}
          onOpenChange={setMenuOpen}
          actions={actions}
        />
      </div>
    </div>
  );
};
