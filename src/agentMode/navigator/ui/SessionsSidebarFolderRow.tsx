import { AgentProjectRowMenu } from "@/agentMode/navigator/ui/AgentProjectRowMenu";
import { RowActionButton } from "@/agentMode/ui/RecentChatMenu";
import {
  SessionStatusIcon,
  type SessionStatus,
  type SortHandle,
} from "@/agentMode/navigator/ui/SessionsSidebarRow";
import type { ProjectConfig } from "@/aiParams";
import { useApp } from "@/context";
import { useKeyboardFocusWithin } from "@/hooks/useKeyboardFocusWithin";
import { cn } from "@/lib/utils";
import { ChevronRight, Folder, Plus } from "lucide-react";
import React, { useState } from "react";

interface SessionsSidebarFolderRowProps {
  project: ProjectConfig;
  expanded: boolean;
  active: boolean;
  hiddenStatus: SessionStatus;
  onOpen: () => void;
  onToggle: () => void;
  onNewChat: () => void;
  onDeleted: (projectId: string) => void;
  sortHandle?: SortHandle;
}

export const SessionsSidebarFolderRow: React.FC<SessionsSidebarFolderRowProps> = ({
  project,
  expanded,
  active,
  hiddenStatus,
  onOpen,
  onToggle,
  onNewChat,
  onDeleted,
  sortHandle,
}) => {
  const app = useApp();
  const [menuOpen, setMenuOpen] = useState(false);
  const { keyboardFocused, focusWithinProps } = useKeyboardFocusWithin();
  const revealed = menuOpen || keyboardFocused;
  const hoverHidden = revealed ? "tw-invisible" : "group-hover:tw-invisible";
  const hoverShown = revealed ? "tw-visible" : "tw-invisible group-hover:tw-visible";
  return (
    <div
      className={cn(
        "tw-group tw-relative tw-flex tw-min-w-0 tw-items-center tw-rounded-md hover:tw-bg-modifier-hover",
        keyboardFocused && "tw-bg-modifier-hover",
        active && "tw-bg-modifier-active-hover hover:tw-bg-modifier-active-hover"
      )}
      {...sortHandle?.listeners}
      {...focusWithinProps}
      onContextMenu={(event) => {
        event.preventDefault();
        setMenuOpen(true);
      }}
    >
      <button
        ref={sortHandle?.ref}
        {...sortHandle?.attributes}
        type="button"
        aria-current={active ? "true" : undefined}
        onClick={onOpen}
        className={cn(
          "clickable-icon tw-flex tw-h-auto tw-min-w-0 tw-flex-1 tw-items-center tw-gap-2",
          "tw-rounded-md tw-bg-transparent tw-p-2 tw-text-left tw-shadow-none hover:tw-bg-transparent"
        )}
      >
        <Folder className="tw-size-4 tw-shrink-0 tw-text-muted" />
        {/* A hidden chat's unseen result bolds the folder name, as it bolds a chat title.
            https://github.com/Brevilabs/obsidian-copilot-private/issues/802 */}
        <span
          className={cn(
            "tw-min-w-0 tw-flex-1 tw-truncate tw-text-ui-small tw-text-normal",
            hiddenStatus === "unread" && "tw-font-semibold",
            revealed
              ? "[mask-image:linear-gradient(to_left,transparent_3.25rem,black_4.25rem)]"
              : "group-hover:[mask-image:linear-gradient(to_left,transparent_3.25rem,black_4.25rem)]"
          )}
        >
          {project.name}
        </span>
        {hiddenStatus === "unread" && (
          <span role="img" aria-label="Unread result" className="tw-sr-only" />
        )}
        {/* The bubbled status sits at the right end, in line with chat statuses; hovering lays the actions and the
            chevron over it, hidden otherwise so the list reads clean, and the name fades under them instead of reflowing.
            https://github.com/Brevilabs/obsidian-copilot-private/issues/802 */}
        <span
          className={cn(
            "tw-flex tw-size-4 tw-shrink-0 tw-items-center tw-justify-center",
            hoverHidden
          )}
        >
          {hiddenStatus !== "unread" && <SessionStatusIcon status={hiddenStatus} />}
        </span>
      </button>
      <div
        className={cn(
          "tw-absolute tw-right-8 tw-top-1/2 tw-flex -tw-translate-y-1/2 tw-items-center tw-gap-1.5",
          hoverShown
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
      {/* Clicking the row opens the project's home, so folding gets its own control.
          https://github.com/Brevilabs/obsidian-copilot-private/issues/840 */}
      <RowActionButton
        label={`${expanded ? "Hide" : "Show"} chats in ${project.name}`}
        aria-expanded={expanded}
        onClick={onToggle}
        className={cn(
          "tw-absolute tw-right-1.5 tw-top-1/2 tw-size-5 -tw-translate-y-1/2 tw-p-0 tw-text-muted",
          hoverShown
        )}
      >
        <ChevronRight className={cn("tw-size-4", expanded && "tw-rotate-90")} />
      </RowActionButton>
    </div>
  );
};
