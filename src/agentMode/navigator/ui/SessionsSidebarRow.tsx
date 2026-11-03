import { RecentChatTitle } from "@/agentMode/ui/RecentChatTitle";
import { cn } from "@/lib/utils";
import { CircleAlert, LoaderCircle, X } from "lucide-react";
import React from "react";

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

interface SessionsSidebarRowProps {
  title: string;
  status: SessionStatus;
  active: boolean;
  isSessionOpen: boolean;
  onSelect: () => void;
  onCloseSession: () => void;
}

const SessionStatusIcon: React.FC<{ status: SessionStatus; isSessionOpen?: boolean }> = ({
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
  title,
  status,
  active,
  isSessionOpen,
  onSelect,
  onCloseSession,
}) => (
  <div
    className={cn(
      "tw-group tw-relative tw-flex tw-min-w-0 tw-items-center tw-rounded-md hover:tw-bg-modifier-hover",
      active && "tw-bg-modifier-active-hover hover:tw-bg-modifier-active-hover"
    )}
  >
    <button
      type="button"
      aria-current={active ? "true" : undefined}
      onClick={onSelect}
      className={cn(
        "clickable-icon tw-flex tw-h-auto tw-min-w-0 tw-flex-1 tw-items-center tw-gap-2",
        "tw-rounded-md tw-bg-transparent tw-px-2 tw-py-1.5 tw-text-left tw-shadow-none",
        "hover:tw-bg-transparent focus-visible:tw-bg-modifier-hover"
      )}
    >
      {/* An unseen result reads like unread mail, a bold title, so the one status dot keeps meaning "session open".
          https://github.com/Brevilabs/obsidian-copilot-private/issues/801 */}
      <RecentChatTitle title={title} className={cn(status === "unread" && "tw-font-semibold")} />
      {status === "unread" && <span role="img" aria-label="Unread result" className="tw-sr-only" />}
      {/* Titles start flush with the panel and the status sits at the right end, where hovering a live chat lays close
          over it; the status keeps its space, so a long title's ellipsis stays put.
          https://github.com/Brevilabs/obsidian-copilot-private/issues/801 */}
      <span
        className={cn(
          "tw-flex tw-size-4 tw-shrink-0 tw-items-center tw-justify-center",
          isSessionOpen && "group-focus-within:tw-invisible group-hover:tw-invisible"
        )}
      >
        <SessionStatusIcon status={status} isSessionOpen={isSessionOpen} />
      </span>
    </button>
    {isSessionOpen && (
      <button
        type="button"
        aria-label="Close chat"
        title="Close chat"
        onClick={onCloseSession}
        className={cn(
          "clickable-icon tw-absolute tw-right-1.5 tw-hidden tw-size-5 tw-items-center tw-justify-center tw-rounded-sm tw-p-0",
          "group-focus-within:tw-flex group-hover:tw-flex"
        )}
      >
        <X className="tw-size-3.5" />
      </button>
    )}
  </div>
);
