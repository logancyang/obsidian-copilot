import { AgentProjectRowMenu } from "@/agentMode/ui/AgentProjectRowActions";
import { RowActionButton } from "@/agentMode/ui/RecentChatMenu";
import { SessionStatusIcon, type SessionStatus } from "@/agentMode/ui/SessionsSidebarRow";
import type { ProjectConfig } from "@/aiParams";
import { useApp } from "@/context";
import { cn } from "@/lib/utils";
import { ChevronRight, Folder, Plus } from "lucide-react";
import React, { useState } from "react";

interface SessionsSidebarFolderRowProps {
  project: ProjectConfig;
  expanded: boolean;
  active: boolean;
  hiddenStatus: SessionStatus;
  onToggle: () => void;
  onNewChat: () => void;
  onDeleted: (projectId: string) => void;
}

export const SessionsSidebarFolderRow: React.FC<SessionsSidebarFolderRowProps> = ({
  project,
  expanded,
  active,
  hiddenStatus,
  onToggle,
  onNewChat,
  onDeleted,
}) => {
  const app = useApp();
  const [menuOpen, setMenuOpen] = useState(false);
  const hoverHidden = menuOpen ? "tw-hidden" : "group-focus-within:tw-hidden group-hover:tw-hidden";
  const hoverShown = menuOpen
    ? "tw-block"
    : "tw-hidden group-focus-within:tw-block group-hover:tw-block";
  return (
    <div
      className={cn(
        "tw-group tw-relative tw-flex tw-min-w-0 tw-items-center tw-rounded-md",
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
        aria-expanded={expanded}
        aria-current={active ? "true" : undefined}
        onClick={onToggle}
        className={cn(
          "clickable-icon tw-flex tw-h-auto tw-min-w-0 tw-flex-1 tw-items-center tw-gap-2",
          "tw-rounded-md tw-bg-transparent tw-px-2 tw-py-1.5 tw-text-left tw-shadow-none"
        )}
      >
        <Folder className="tw-size-4 tw-shrink-0 tw-text-muted" />
        {/* A hidden chat's unseen result bolds the folder name, as it bolds a chat title.
            https://github.com/Brevilabs/obsidian-copilot-private/issues/802 */}
        <span
          className={cn(
            "tw-min-w-0 tw-flex-1 tw-truncate tw-text-ui-small tw-text-normal",
            hiddenStatus === "unread" && "tw-font-semibold"
          )}
        >
          {project.name}
        </span>
        {hiddenStatus === "unread" && (
          <span role="img" aria-label="Unread result" className="tw-sr-only" />
        )}
        {/* The bubbled status sits at the right end, in line with chat statuses; hovering swaps it for the actions and
            the chevron, which stay hidden otherwise so the list reads clean.
            https://github.com/Brevilabs/obsidian-copilot-private/issues/802 */}
        <span
          className={cn(
            "tw-flex tw-size-4 tw-shrink-0 tw-items-center tw-justify-center",
            hoverHidden
          )}
        >
          {hiddenStatus !== "unread" && <SessionStatusIcon status={hiddenStatus} />}
        </span>
        <span aria-hidden="true" className={cn("tw-w-10 tw-shrink-0", hoverShown)} />
        <ChevronRight
          className={cn(
            "tw-size-4 tw-shrink-0 tw-text-muted",
            hoverShown,
            expanded && "tw-rotate-90"
          )}
        />
      </button>
      <div
        className={cn(
          "tw-absolute tw-right-8 tw-top-1/2 tw-flex -tw-translate-y-1/2 tw-items-center",
          menuOpen
            ? "tw-visible"
            : "tw-invisible group-focus-within:tw-visible group-hover:tw-visible"
        )}
      >
        <RowActionButton label={`New chat in ${project.name}`} onClick={onNewChat}>
          <Plus className="tw-size-4" />
        </RowActionButton>
        <AgentProjectRowMenu
          app={app}
          project={project}
          onDeleted={onDeleted}
          open={menuOpen}
          onOpenChange={setMenuOpen}
        />
      </div>
    </div>
  );
};
