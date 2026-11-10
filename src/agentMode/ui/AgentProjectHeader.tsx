import { TruncatedText } from "@/components/TruncatedText";
import { Button } from "@/components/ui/button";
import { ProjectFolderIcon } from "@/components/ui/ProjectFolderIcon";
import { cn } from "@/lib/utils";
import { ChevronLeft } from "lucide-react";
import React, { memo } from "react";

interface AgentProjectHeaderProps {
  projectName: string;
  onExit: () => void;
  menu?: React.ReactNode;
  orphaned?: boolean;
  className?: string;
}

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
        aria-label="Leave project"
        title="Leave project"
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
