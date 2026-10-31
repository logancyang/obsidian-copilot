import { RecentChatTitle } from "@/agentMode/ui/RecentChatTitle";
import { cn } from "@/lib/utils";
import { CircleAlert, LoaderCircle } from "lucide-react";
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
  if (unread) return "unread";
  return running ? "running" : "idle";
}

interface SessionsSidebarRowProps {
  title: string;
  status: SessionStatus;
  active: boolean;
  onSelect: () => void;
}

const SessionStatusIcon: React.FC<{ status: SessionStatus }> = ({ status }) => {
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
  title,
  status,
  active,
  onSelect,
}) => (
  <button
    type="button"
    aria-current={active ? "true" : undefined}
    onClick={onSelect}
    className={cn(
      "clickable-icon tw-flex tw-h-auto tw-w-full tw-min-w-0 tw-items-center tw-gap-2",
      "tw-rounded-md tw-bg-transparent tw-px-2 tw-py-1.5 tw-text-left tw-shadow-none",
      "hover:tw-bg-modifier-hover focus-visible:tw-bg-modifier-hover",
      active && "tw-bg-modifier-active-hover hover:tw-bg-modifier-active-hover"
    )}
  >
    <RecentChatTitle title={title} />
    <SessionStatusIcon status={status} />
  </button>
);
