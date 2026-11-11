import { TruncatedText } from "@/components/TruncatedText";
import { Button } from "@/components/ui/button";
import { ProjectFolderIcon } from "@/projects/ui/ProjectFolderIcon";
import { cn } from "@/lib/utils";
import { ChevronLeft, FolderSearch, Settings } from "lucide-react";
import React, { memo } from "react";

interface AgentProjectHeaderProps {
  projectName: string;
  onOpenHome: () => void;
  onExit: () => void;
  onOpenSettings?: () => void;
  onRevealFolder?: () => void;
  menu?: React.ReactNode;
  isProjectHome?: boolean;
  orphaned?: boolean;
  className?: string;
}

export const AgentProjectHeader = memo(
  ({
    projectName,
    onOpenHome,
    onExit,
    onOpenSettings,
    onRevealFolder,
    menu,
    isProjectHome = false,
    orphaned = false,
    className,
  }: AgentProjectHeaderProps): React.ReactElement => (
    <div className={cn("tw-flex tw-w-full tw-items-center tw-gap-1 tw-px-2 tw-py-1.5", className)}>
      {orphaned ? (
        <>
          <Button
            variant="ghost2"
            size="sm"
            onClick={onExit}
            aria-label="Leave project"
            title="Leave project"
            className="tw-flex tw-shrink-0 tw-items-center tw-px-1.5 tw-text-muted hover:tw-text-normal"
          >
            <ChevronLeft className="tw-size-4" />
          </Button>
          <span className="tw-min-w-0 tw-flex-1 tw-text-ui-small tw-text-muted">
            This project no longer exists
          </span>
        </>
      ) : (
        <>
          <Button
            variant="ghost2"
            size="sm"
            onClick={onOpenHome}
            aria-label={`Go to ${projectName} home`}
            className="tw-group tw-min-w-0 tw-cursor-pointer tw-justify-start tw-gap-1.5 tw-px-1.5 tw-text-normal"
          >
            <ProjectFolderIcon />
            <TruncatedText
              className="tw-min-w-0 tw-text-ui-small tw-font-medium tw-underline-offset-4 group-hover:tw-text-accent group-hover:tw-underline group-focus-visible:tw-text-accent group-focus-visible:tw-underline"
              tooltipContent={projectName}
            >
              {projectName}
            </TruncatedText>
          </Button>
          <div className="tw-flex-1" />

          {onOpenSettings && (
            <Button
              variant="ghost2"
              size="icon"
              aria-label="Project settings"
              className="tw-size-7 tw-text-muted hover:tw-text-normal"
              onClick={onOpenSettings}
            >
              <Settings className="tw-size-4" />
            </Button>
          )}
          {onRevealFolder && (
            <Button
              variant="ghost2"
              size="icon"
              aria-label="Reveal project folder in vault"
              className="tw-size-7 tw-text-muted hover:tw-text-normal"
              onClick={onRevealFolder}
            >
              <FolderSearch className="tw-size-4" />
            </Button>
          )}
          {/* The project home already shows the project's files, so only a chat gets the popover.
              https://github.com/Brevilabs/obsidian-copilot-private/issues/840 */}
          {!isProjectHome && menu}
        </>
      )}
    </div>
  )
);

AgentProjectHeader.displayName = "AgentProjectHeader";
