import { AgentProjectRowMenu } from "@/agentMode/ui/AgentProjectRowActions";
import { SessionStatusIcon, type SessionStatus } from "@/agentMode/ui/SessionsSidebarRow";
import type { ProjectConfig } from "@/aiParams";
import { useApp } from "@/context";
import { cn } from "@/lib/utils";
import { ChevronRight, Folder } from "lucide-react";
import React, { useState } from "react";

interface SessionsSidebarFolderRowProps {
  project: ProjectConfig;
  expanded: boolean;
  hiddenStatus: SessionStatus;
  onToggle: () => void;
  onDeleted: (projectId: string) => void;
}

export const SessionsSidebarFolderRow: React.FC<SessionsSidebarFolderRowProps> = ({
  project,
  expanded,
  hiddenStatus,
  onToggle,
  onDeleted,
}) => {
  const app = useApp();
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div
      className="tw-group tw-relative tw-flex tw-min-w-0 tw-items-center tw-rounded-md focus-within:tw-bg-modifier-hover hover:tw-bg-modifier-hover"
      onContextMenu={(event) => {
        event.preventDefault();
        setMenuOpen(true);
      }}
    >
      {/* The folder icon starts in the chat title column and a project's chats indent by the icon's width, so their
          titles line up under the project name; the hover actions fill a slot the row always reserves, so showing
          them never moves the name, status or chevron.
          https://github.com/Brevilabs/obsidian-copilot-private/issues/802 */}
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className={cn(
          "clickable-icon tw-flex tw-h-auto tw-min-w-0 tw-flex-1 tw-items-center tw-gap-2",
          "tw-rounded-md tw-bg-transparent tw-py-1.5 tw-pl-8 tw-pr-2 tw-text-left tw-shadow-none"
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
        {hiddenStatus === "unread" ? (
          <span role="img" aria-label="Unread result" className="tw-sr-only" />
        ) : (
          <SessionStatusIcon status={hiddenStatus} />
        )}
        <span aria-hidden="true" className="tw-w-5 tw-shrink-0" />
        <ChevronRight
          className={cn("tw-size-4 tw-shrink-0 tw-text-muted", expanded && "tw-rotate-90")}
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
