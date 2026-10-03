import { AgentAvatar } from "@/components/ui/AgentAvatar";
import { BareButton } from "@/components/ui/bare-button";
import { Button } from "@/components/ui/button";
import { SelfHostCloudWarningIcon } from "@/components/ui/SelfHostCloudWarningIcon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { ChevronRight, Edit3, FolderSearch, MoreVertical, Trash2 } from "lucide-react";
import React from "react";

export interface AgentRowItem {
  slug: string;
  name: string;
  description: string;
  avatarSrc: string | null;
  backendLabel: string | null;
  cloudEgress: boolean;
  memoryLabel: string | null;
}

export interface AgentRowProps {
  agent: AgentRowItem;
  onOpen: () => void;
  onOpenFolder: () => void;
  onDelete: () => void;
  containerRef?: React.RefObject<HTMLElement>;
}

export const AgentRow: React.FC<AgentRowProps> = ({
  agent,
  onOpen,
  onOpenFolder,
  onDelete,
  containerRef,
}) => {
  const [menuOpen, setMenuOpen] = React.useState(false);

  return (
    <div
      data-menu-open={menuOpen ? "true" : undefined}
      className={cn(
        "tw-group tw-relative tw-flex tw-items-center tw-rounded-md tw-border tw-border-solid tw-border-border",
        "tw-bg-primary tw-transition-colors",
        "hover:tw-border-border-hover hover:tw-bg-modifier-hover",
        "data-[menu-open=true]:tw-border-border-hover data-[menu-open=true]:tw-bg-modifier-hover"
      )}
    >
      <BareButton
        onClick={onOpen}
        className={cn(
          "tw-flex tw-min-w-0 tw-flex-1 tw-items-center tw-gap-3 tw-rounded-md tw-py-2.5 tw-pl-3 tw-pr-1",
          "focus-visible:tw-outline-none focus-visible:tw-ring-2 focus-visible:tw-ring-ring"
        )}
      >
        <AgentAvatar src={agent.avatarSrc} name={agent.name} size="md" />
        <span className="tw-flex tw-min-w-0 tw-flex-1 tw-flex-col tw-gap-0.5">
          <span className="tw-flex tw-min-w-0 tw-items-center tw-gap-2">
            <span
              title={agent.name}
              className="tw-truncate tw-text-ui-small tw-font-semibold tw-text-normal"
            >
              {agent.name}
            </span>
            {agent.backendLabel !== null && <Chip label={agent.backendLabel} />}
            {agent.cloudEgress && <SelfHostCloudWarningIcon />}
          </span>
          {agent.description.length > 0 && (
            <span
              title={agent.description}
              className="tw-truncate tw-text-ui-smaller tw-text-muted"
            >
              {agent.description}
            </span>
          )}
        </span>
        <span className="tw-shrink-0 tw-text-ui-smaller tw-text-faint">
          {agent.memoryLabel ?? "Memory off"}
        </span>
        <ChevronRight
          className="tw-size-4 tw-shrink-0 tw-text-faint group-hover:tw-text-muted"
          aria-hidden="true"
        />
      </BareButton>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen} modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost2"
            size="icon"
            title="More actions"
            aria-label={`More actions for ${agent.name}`}
            className="tw-mr-2 tw-shrink-0"
          >
            <MoreVertical className="tw-size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="tw-min-w-[180px]"
          container={containerRef?.current ?? null}
        >
          <DropdownMenuItem className="tw-gap-2.5 tw-text-ui-small" onSelect={onOpen}>
            <Edit3 className="tw-size-3.5" aria-hidden="true" />
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem className="tw-gap-2.5 tw-text-ui-small" onSelect={onOpenFolder}>
            <FolderSearch className="tw-size-3.5" aria-hidden="true" />
            Open folder
          </DropdownMenuItem>
          <DropdownMenuItem
            className="tw-gap-2.5 tw-text-ui-small tw-text-error focus:tw-bg-modifier-error-rgb/15 focus:tw-text-error"
            onSelect={onDelete}
          >
            <Trash2 className="tw-size-3.5" aria-hidden="true" />
            Delete…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};

const Chip: React.FC<{ label: string }> = ({ label }) => (
  <span
    className={cn(
      "tw-shrink-0 tw-rounded-sm tw-border tw-border-solid tw-border-border tw-bg-primary-alt tw-px-1.5 tw-py-0.5",
      "tw-font-mono tw-text-smallest tw-font-medium tw-uppercase tw-tracking-wide tw-text-normal"
    )}
  >
    {label}
  </span>
);
