import { RecentChatMenu, type RecentChatActions } from "@/agentMode/ui/RecentChatMenu";
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
          className="tw-bg-green tw-size-2 tw-shrink-0 tw-rounded-full"
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
        "tw-group tw-relative tw-flex tw-min-w-0 tw-items-center tw-gap-1 tw-rounded-md tw-pr-1",
        "focus-within:tw-bg-modifier-hover hover:tw-bg-modifier-hover",
        active && "tw-bg-modifier-active-hover hover:tw-bg-modifier-active-hover"
      )}
      onContextMenu={(event) => {
        event.preventDefault();
        setMenuOpen(true);
      }}
    >
      {/* The close button covers the status gutter, so hovering or focusing it hides the indicator beneath; every row
          keeps the gutter so a status appearing never shifts the title.
          https://github.com/Brevilabs/obsidian-copilot-private/issues/801 */}
      {closeSession && (
        <button
          type="button"
          aria-label="Close chat"
          title="Close chat"
          onClick={() => safeAsyncHandler(closeSession)(item.id)}
          className={cn(
            "clickable-icon tw-peer tw-absolute tw-left-1.5 tw-top-1/2 tw-flex tw-size-5 -tw-translate-y-1/2",
            "tw-items-center tw-justify-center tw-rounded-sm tw-p-0 tw-opacity-0",
            "hover:tw-opacity-100 focus-visible:tw-opacity-100"
          )}
        >
          <X className="tw-size-3.5" />
        </button>
      )}
      <button
        type="button"
        aria-current={active ? "true" : undefined}
        onClick={onSelect}
        className={cn(
          "clickable-icon tw-flex tw-h-auto tw-min-w-0 tw-flex-1 tw-items-center tw-gap-2",
          "tw-rounded-md tw-bg-transparent tw-px-2 tw-py-1.5 tw-text-left tw-shadow-none",
          "peer-hover:[&_[data-status-gutter]]:tw-invisible peer-focus-visible:[&_[data-status-gutter]]:tw-invisible"
        )}
      >
        {/* An unseen result reads like unread mail, a bold title, so the gutter's one dot keeps meaning "session open".
            https://github.com/Brevilabs/obsidian-copilot-private/issues/801 */}
        <RecentChatTitle
          title={item.title}
          className={cn(status === "unread" && "tw-font-semibold")}
        />
        {status === "unread" && (
          <span role="img" aria-label="Unread result" className="tw-sr-only" />
        )}
        {projectName && <RecentChatProjectBadge name={projectName} />}
        {/* The gutter leads visually but follows the title in the DOM, so the row's accessible name starts with the title.
            https://github.com/Brevilabs/obsidian-copilot-private/issues/801 */}
        <span
          data-status-gutter
          className="tw-order-first tw-flex tw-size-4 tw-shrink-0 tw-items-center tw-justify-center"
        >
          <SessionStatusIcon status={status} isSessionOpen={isSessionOpen} />
        </span>
      </button>
      {/* The open menu is anchored to More actions, so the trigger stays shown after the pointer leaves the row.
          https://github.com/Brevilabs/obsidian-copilot-private/issues/693 */}
      <div
        className={cn(
          "tw-shrink-0 tw-items-center",
          menuOpen ? "tw-flex" : "tw-hidden group-focus-within:tw-flex group-hover:tw-flex"
        )}
      >
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
