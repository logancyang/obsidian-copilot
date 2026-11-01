import { AgentProjectRowMenu } from "@/agentMode/ui/AgentProjectRowActions";
import { SessionStatusIcon, type SessionStatus } from "@/agentMode/ui/SessionsSidebarRow";
import type { ProjectConfig } from "@/aiParams";
import { ProjectFolderIcon } from "@/components/ui/ProjectFolderIcon";
import { useApp } from "@/context";
import { cn } from "@/lib/utils";
import { ChevronRight } from "lucide-react";
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
      className="tw-group tw-flex tw-min-w-0 tw-items-center tw-gap-1 tw-rounded-md tw-pr-1 focus-within:tw-bg-modifier-hover hover:tw-bg-modifier-hover"
      onContextMenu={(event) => {
        event.preventDefault();
        setMenuOpen(true);
      }}
    >
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className={cn(
          "clickable-icon tw-flex tw-h-auto tw-min-w-0 tw-flex-1 tw-items-center tw-gap-2",
          "tw-rounded-md tw-bg-transparent tw-px-2 tw-py-1.5 tw-text-left tw-shadow-none"
        )}
      >
        <ChevronRight
          className={cn("tw-size-3.5 tw-shrink-0 tw-text-muted", expanded && "tw-rotate-90")}
        />
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
