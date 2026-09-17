import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { BookOpen, Edit3, Eraser, FolderSearch, MoreVertical, Trash2 } from "lucide-react";
import React from "react";

/** What one row needs to render, already formatted by the container. */
export interface AgentRowItem {
  slug: string;
  name: string;
  description: string;
  /** Single emoji or letter; an empty string falls back to the name's initial. */
  icon: string;
  /** Display name of the pinned backend, or null when the agent pins none. */
  backendLabel: string | null;
  /** Human-readable size of `MEMORY.md`, or null when memory is off. */
  memoryLabel: string | null;
}

export interface AgentRowProps {
  agent: AgentRowItem;
  /** True while this agent is the one open in the editor. */
  selected: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onOpenFolder: () => void;
  onOpenMemory: () => void;
  onClearMemory: () => void;
  onDelete: () => void;
  /**
   * Tab-body element the overflow menu portals into, so the menu stays inside
   * Obsidian's Settings focus scope and Radix's focus-follows-hover works.
   */
  containerRef?: React.RefObject<HTMLElement>;
}

/** One agent in the Agents list: identity, what it is pinned to, and its actions. */
export const AgentRow: React.FC<AgentRowProps> = ({
  agent,
  selected,
  onSelect,
  onEdit,
  onOpenFolder,
  onOpenMemory,
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
        // Preflight is off: zero the native button chrome so the row body reads
        // as part of the card rather than as a beveled grey control.
        style={{ appearance: "none", border: 0, background: "transparent", padding: 0 }}
        className="tw-flex tw-min-w-0 tw-flex-1 tw-cursor-pointer tw-items-center tw-gap-3 tw-text-left"
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
      {/* Non-modal menu: a modal Radix menu locks body scroll, and "Open folder"
          moves focus out of Settings mid-teardown, which strands that lock. */}
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

/** Pinned-backend marker, styled like the Skills tab's row chips. */
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
