import { Button } from "@/components/ui/button";
import { SelfHostCloudWarningIcon } from "@/components/ui/SelfHostCloudWarningIcon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  BookOpen,
  Edit3,
  Eraser,
  FolderSearch,
  Layers,
  MoreVertical,
  NotebookPen,
  Trash2,
} from "lucide-react";
import React from "react";

export interface AgentRowItem {
  slug: string;
  name: string;
  description: string;
  icon: string;
  backendLabel: string | null;
  cloudEgress: boolean;
  memoryLabel: string | null;
}

export interface AgentRowProps {
  agent: AgentRowItem;
  selected: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onOpenFolder: () => void;
  onOpenMemory: () => void;
  onOpenTodaysNotes: () => void;
  onConsolidateMemory: () => void;
  onClearMemory: () => void;
  onDelete: () => void;
  containerRef?: React.RefObject<HTMLElement>;
}

export const AgentRow: React.FC<AgentRowProps> = ({
  agent,
  selected,
  onSelect,
  onEdit,
  onOpenFolder,
  onOpenMemory,
  onOpenTodaysNotes,
  onConsolidateMemory,
  onClearMemory,
  onDelete,
  containerRef,
}) => {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const glyph = agent.icon.trim() || agent.name.trim().charAt(0).toUpperCase() || "?";

  return (
    <div
      data-menu-open={menuOpen ? "true" : undefined}
      data-selected={selected ? "true" : undefined}
      className={cn(
        "tw-flex tw-items-center tw-gap-3",
        "tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-primary",
        "tw-px-3.5 tw-py-2.5",
        "tw-transition-colors hover:tw-border-border-hover hover:tw-bg-primary-alt",
        "data-[menu-open=true]:tw-bg-primary-alt data-[menu-open=true]:tw-border-normal/100",
        "data-[selected=true]:tw-bg-primary-alt data-[selected=true]:tw-border-normal/100"
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className={cn(
          "tw-appearance-none tw-border-0 tw-bg-transparent tw-p-0",
          "tw-flex tw-min-w-0 tw-flex-1 tw-cursor-pointer tw-items-center tw-gap-3 tw-text-left"
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "tw-flex tw-size-8 tw-shrink-0 tw-items-center tw-justify-center",
            "tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-primary-alt",
            "tw-text-ui-small"
          )}
        >
          {glyph}
        </span>
        <span className="tw-min-w-0 tw-flex-1">
          <span className="tw-flex tw-flex-wrap tw-items-center tw-gap-2">
            <span
              title={agent.name}
              className="tw-max-w-full tw-truncate tw-text-ui-small tw-font-semibold tw-text-normal"
            >
              {agent.name}
            </span>
            {agent.backendLabel !== null && <Chip label={agent.backendLabel} />}
            {agent.cloudEgress && <SelfHostCloudWarningIcon />}
          </span>
          {agent.description.length > 0 && (
            <span
              title={agent.description}
              className="tw-mt-0.5 tw-block tw-truncate tw-text-ui-smaller tw-text-muted"
            >
              {agent.description}
            </span>
          )}
        </span>
      </button>
      <span className="tw-shrink-0 tw-text-ui-smaller tw-text-faint">
        {agent.memoryLabel ?? "Memory off"}
      </span>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen} modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            title="More actions"
            aria-label={`More actions for ${agent.name}`}
          >
            <MoreVertical className="tw-size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="tw-min-w-[180px]"
          container={containerRef?.current ?? null}
        >
          <DropdownMenuItem className="tw-gap-2.5 tw-text-ui-small" onSelect={onEdit}>
            <Edit3 className="tw-size-3.5" aria-hidden="true" />
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem className="tw-gap-2.5 tw-text-ui-small" onSelect={onOpenFolder}>
            <FolderSearch className="tw-size-3.5" aria-hidden="true" />
            Open folder
          </DropdownMenuItem>
          <DropdownMenuItem className="tw-gap-2.5 tw-text-ui-small" onSelect={onOpenMemory}>
            <BookOpen className="tw-size-3.5" aria-hidden="true" />
            Open memory
          </DropdownMenuItem>
          <DropdownMenuItem className="tw-gap-2.5 tw-text-ui-small" onSelect={onOpenTodaysNotes}>
            <NotebookPen className="tw-size-3.5" aria-hidden="true" />
            Open today&apos;s notes
          </DropdownMenuItem>
          <DropdownMenuItem className="tw-gap-2.5 tw-text-ui-small" onSelect={onConsolidateMemory}>
            <Layers className="tw-size-3.5" aria-hidden="true" />
            Consolidate memory now
          </DropdownMenuItem>
          <DropdownMenuItem className="tw-gap-2.5 tw-text-ui-small" onSelect={onClearMemory}>
            <Eraser className="tw-size-3.5" aria-hidden="true" />
            Clear memory
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
      "tw-rounded-sm tw-border tw-border-solid tw-border-border tw-bg-primary-alt tw-px-1.5 tw-py-0.5",
      "tw-font-mono tw-text-smallest tw-font-medium tw-uppercase tw-tracking-wide tw-text-normal"
    )}
  >
    {label}
  </span>
);
