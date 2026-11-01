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
      return (
        <span
          role="img"
          aria-label="Unread result"
          className="tw-size-2 tw-shrink-0 tw-rounded-full tw-bg-interactive-accent"
        />
      );
    case "idle":
      return isSessionOpen ? (
        <span
          role="img"
          aria-label="Session open"
          className="tw-size-1.5 tw-shrink-0 tw-rounded-full tw-bg-interactive-accent"
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
      "tw-relative tw-rounded-md hover:tw-bg-modifier-hover",
      active && "tw-bg-modifier-active-hover hover:tw-bg-modifier-active-hover"
    )}
  >
    {/* The close button covers the status gutter, so hovering or focusing it hides the indicator beneath; every row
        keeps the gutter so a status appearing never shifts the title.
        https://github.com/Brevilabs/obsidian-copilot-private/issues/801 */}
    {isSessionOpen && (
      <button
        type="button"
        aria-label="Close chat"
        title="Close chat"
        onClick={onCloseSession}
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
        "clickable-icon tw-flex tw-h-auto tw-w-full tw-min-w-0 tw-items-center tw-gap-2",
        "tw-rounded-md tw-bg-transparent tw-px-2 tw-py-1.5 tw-text-left tw-shadow-none",
        "hover:tw-bg-transparent focus-visible:tw-bg-modifier-hover",
        "peer-hover:[&_[data-status-gutter]]:tw-invisible peer-focus-visible:[&_[data-status-gutter]]:tw-invisible"
      )}
    >
      <RecentChatTitle title={title} />
      {/* The gutter leads visually but follows the title in the DOM, so the row's accessible name starts with the title.
          https://github.com/Brevilabs/obsidian-copilot-private/issues/801 */}
      <span
        data-status-gutter
        className="tw-order-first tw-flex tw-size-4 tw-shrink-0 tw-items-center tw-justify-center"
      >
        <SessionStatusIcon status={status} isSessionOpen={isSessionOpen} />
      </span>
    </button>
  </div>
);
