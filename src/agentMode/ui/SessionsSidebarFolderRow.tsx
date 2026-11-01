import { AgentProjectRowMenu } from "@/agentMode/ui/AgentProjectRowActions";
import { RowActionButton } from "@/agentMode/ui/RecentChatMenu";
import { SessionStatusIcon, type SessionStatus } from "@/agentMode/ui/SessionsSidebarRow";
import type { ProjectConfig } from "@/aiParams";
import { ProjectFolderIcon } from "@/components/ui/ProjectFolderIcon";
import { useApp } from "@/context";
import { cn } from "@/lib/utils";
import { ChevronRight, Plus } from "lucide-react";
import React, { useState } from "react";

interface SessionsSidebarFolderRowProps {
  project: ProjectConfig;
  expanded: boolean;
  active: boolean;
  hiddenStatus: SessionStatus;
  onToggle: () => void;
  onOpen: () => void;
  onNewChat: () => void;
  onDeleted: (projectId: string) => void;
}

export const SessionsSidebarFolderRow: React.FC<SessionsSidebarFolderRowProps> = ({
  project,
  expanded,
  active,
  hiddenStatus,
  onToggle,
  onOpen,
  onNewChat,
  onDeleted,
}) => {
  const app = useApp();
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
      <RowActionButton
        label={`${expanded ? "Collapse" : "Expand"} ${project.name}`}
        aria-expanded={expanded}
        className="tw-ml-1 tw-size-5 tw-shrink-0 tw-p-0"
        onClick={onToggle}
      >
        <ChevronRight
          className={cn("tw-size-3.5 tw-shrink-0 tw-text-muted", expanded && "tw-rotate-90")}
        />
      </RowActionButton>
      <button
        type="button"
        aria-current={active ? "true" : undefined}
        onClick={onOpen}
        className={cn(
          "clickable-icon tw-flex tw-h-auto tw-min-w-0 tw-flex-1 tw-items-center tw-gap-2",
          "tw-rounded-md tw-bg-transparent tw-py-1.5 tw-pr-2 tw-text-left tw-shadow-none"
        )}
      >
        <ProjectFolderIcon />
        <span className="tw-min-w-0 tw-flex-1 tw-truncate tw-text-ui-small tw-text-normal">
          {project.name}
        </span>
        <SessionStatusIcon status={hiddenStatus} />
      </button>
      <div
        className={cn(
          "tw-shrink-0 tw-items-center",
          menuOpen ? "tw-flex" : "tw-hidden group-focus-within:tw-flex group-hover:tw-flex"
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
