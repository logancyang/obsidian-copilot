import {
  projectRowActions,
  type AgentProjectRowActionsProps,
} from "@/projects/ui/AgentProjectRowActions";
import { RowActionButton } from "@/agentMode/ui/RecentChatMenu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Archive, FolderSearch, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import React, { useCallback, useState } from "react";

interface AgentProjectRowMenuProps extends AgentProjectRowActionsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AgentProjectRowMenu({
  open,
  onOpenChange,
  ...actionProps
}: AgentProjectRowMenuProps): React.ReactElement {
  const { project } = actionProps;
  const { edit, archive, remove, reveal } = projectRowActions(actionProps);
  const [rowBody, setRowBody] = useState<HTMLElement | null>(null);
  const trackRowBody = useCallback(
    (node: HTMLButtonElement | null) => setRowBody(node?.ownerDocument.body ?? null),
    []
  );
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange} modal={false}>
      <DropdownMenuTrigger asChild>
        <RowActionButton label={`More actions for ${project.name}`} ref={trackRowBody}>
          <MoreHorizontal className="tw-size-4" />
        </RowActionButton>
      </DropdownMenuTrigger>
      {/* Reveal in vault switches the sidebar to the file explorer, so a menu still fading out would lose its anchor and jump to the window corner.
          https://github.com/Brevilabs/obsidian-copilot-private/issues/802 */}
      {open && (
        <DropdownMenuContent align="end" container={rowBody}>
          <DropdownMenuItem onSelect={reveal}>
            <FolderSearch />
            Reveal in vault
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={edit}>
            <Pencil />
            Edit project
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void archive()}>
            <Archive />
            Archive project
          </DropdownMenuItem>
          <DropdownMenuItem className="tw-text-error focus:tw-text-error" onSelect={remove}>
            <Trash2 />
            Delete project
          </DropdownMenuItem>
        </DropdownMenuContent>
      )}
    </DropdownMenu>
  );
}
