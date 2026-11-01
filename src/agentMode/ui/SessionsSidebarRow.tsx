import { RecentChatMenu, type RecentChatActions } from "@/agentMode/ui/RecentChatMenu";
import { RecentChatProjectBadge, RecentChatTitle } from "@/agentMode/ui/RecentChatTitle";
import type { ChatHistoryItem } from "@/components/chat-components/ChatHistoryPopover";
import { cn } from "@/lib/utils";
import { isNativeChatId } from "@/utils/nativeChatId";
import { CircleAlert, LoaderCircle } from "lucide-react";
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
  if (unread) return "unread";
  return running ? "running" : "idle";
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

export const SessionStatusIcon: React.FC<{ status: SessionStatus }> = ({ status }) => {
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
      return (
        <span
          role="img"
          aria-label="Unread result"
          className="tw-size-2 tw-shrink-0 tw-rounded-full tw-bg-interactive-accent"
        />
      );
    case "idle":
      return null;
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
  return (
    <div
      className={cn(
        "tw-group tw-flex tw-min-w-0 tw-items-center tw-gap-1 tw-rounded-md tw-pr-1",
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
        <RecentChatTitle title={item.title} />
        {projectName && <RecentChatProjectBadge name={projectName} />}
        <SessionStatusIcon status={status} />
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
