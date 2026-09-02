import { TruncatedText } from "@/components/TruncatedText";
import { Button } from "@/components/ui/button";
import { ProjectFolderIcon } from "@/components/ui/ProjectFolderIcon";
import { cn } from "@/lib/utils";
import { ChevronLeft } from "lucide-react";
import React, { memo } from "react";
import { t } from "@/i18n";

interface AgentProjectHeaderProps {
  /** Live project name (read from `useProjects` by the parent so renames reflect). */
  projectName: string;
  /** Leave the project workspace back to the global scope. */
  onExit: () => void;
  /**
   * Per-project options control (the `⋯` overflow menu: Edit / Reveal / Delete),
   * rendered in the trailing slot. Passed as a node so this stays presentational
   * — the parent owns the menu component and its handlers. Omitted when orphaned.
   */
  menu?: React.ReactNode;
  /**
   * The active project's record is gone (folder/`project.md` deleted while the
   * user was inside it). Degrades to just the `‹` escape hatch — no stale
   * name, tile, or menu pointing at a project that no longer exists.
   */
  orphaned?: boolean;
  className?: string;
}

/**
 * Thin workspace header shown above the chat surface whenever a project scope is
 * active (both the project landing and an in-project conversation). Presentational
 * only: the parent owns scope state and feeds the live `projectName`.
 */
export const AgentProjectHeader = memo(
  ({
    projectName,
    onExit,
    menu,
    orphaned = false,
    className,
  }: AgentProjectHeaderProps): React.ReactElement => (
    <div className={cn("tw-flex tw-w-full tw-items-center tw-gap-1 tw-px-2 tw-py-1.5", className)}>
      <Button
        variant="ghost2"
        size="sm"
        onClick={onExit}
        aria-label={t("agentChat.projects.leave")}
        title={t("agentChat.projects.leave")}
        className="tw-flex tw-shrink-0 tw-items-center tw-px-1.5 tw-text-muted hover:tw-text-normal"
      >
        <ChevronLeft className="tw-size-4" />
      </Button>

      {orphaned ? (
        <span className="tw-min-w-0 tw-flex-1 tw-text-ui-small tw-text-muted">
          This project no longer exists
        </span>
      ) : (
        <>
          <ProjectFolderIcon />
          <TruncatedText
            className="tw-min-w-0 tw-flex-1 tw-text-ui-small tw-font-medium tw-text-normal"
            tooltipContent={projectName}
          >
            {projectName}
          </TruncatedText>

          {menu}
        </>
      )}
    </div>
  )
);

AgentProjectHeader.displayName = "AgentProjectHeader";
