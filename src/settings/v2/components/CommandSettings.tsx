import React from "react";
import { Button } from "@/components/ui/button";
import {
  useCustomPromptCommands,
  CustomPromptCommand,
} from "@/settings/v2/hooks/useCustomPromptCommands";
import { Lightbulb, GripVertical, PencilLine, MoreVertical, Copy, Trash2 } from "lucide-react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";
import { getSettings } from "@/settings/model";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useContainerContext } from "@/settings/v2/components/ContainerContext";

const SortableTableRow: React.FC<{
  command: CustomPromptCommand;
  onUpdate: (prevCommand: CustomPromptCommand, newCommand: CustomPromptCommand) => void;
  onRemove: (command: CustomPromptCommand) => void;
  onDuplicate: (command: CustomPromptCommand) => void;
}> = ({ command, onUpdate, onRemove, onDuplicate }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: command.name,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const container = useContainerContext();

  return (
    <TableRow
      ref={setNodeRef}
      style={style}
      className={cn(
        "tw-transition-colors",
        isDragging &&
          "tw-relative tw-z-[100] tw-cursor-grabbing tw-shadow-lg tw-backdrop-blur-sm tw-border-accent/50"
      )}
    >
      <TableCell className="tw-w-10">
        <div
          {...attributes}
          {...listeners}
          className="tw-flex tw-cursor-grab tw-items-center tw-justify-center"
        >
          <GripVertical className="tw-size-4" />
        </div>
      </TableCell>
      <TableCell>{command.name}</TableCell>
      <TableCell className="tw-text-center">
        <Checkbox
          checked={command.showInContextMenu}
          onCheckedChange={(checked) =>
            onUpdate(command, {
              ...command,
              showInContextMenu: checked === true,
            })
          }
          className="tw-mx-auto"
        />
      </TableCell>
      <TableCell className="tw-text-center">
        <div className="tw-flex tw-justify-center tw-space-x-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              // No-op for now - editing would require file system operations
              console.log("Edit command:", command);
            }}
          >
            <PencilLine className="tw-size-4" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon">
                <MoreVertical className="tw-size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" container={container}>
              <DropdownMenuItem
                onClick={() => {
                  // No-op for now - editing would require file system operations
                  console.log("Edit command:", command);
                }}
              >
                <PencilLine className="tw-mr-2 tw-size-4" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onDuplicate(command)}>
                <Copy className="tw-mr-2 tw-size-4" />
                Copy
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onRemove(command)} className="tw-text-error">
                <Trash2 className="tw-mr-2 tw-size-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </TableCell>
    </TableRow>
  );
};

export const CommandSettings: React.FC = () => {
  const { commands, updateContextMenuSetting } = useCustomPromptCommands();
  const settings = getSettings();
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleUpdate = async (
    prevCommand: CustomPromptCommand,
    newCommand: CustomPromptCommand
  ) => {
    // Update the context menu setting in the markdown file
    if (prevCommand.showInContextMenu !== newCommand.showInContextMenu) {
      await updateContextMenuSetting(newCommand.filePath, newCommand.showInContextMenu);
    }
  };

  const handleDuplicate = (command: CustomPromptCommand) => {
    // No-op for now - duplicating would require file system operations
    console.log("Duplicate command:", command);
  };

  const handleRemove = (command: CustomPromptCommand) => {
    // No-op for now - removing would require file system operations
    console.log("Remove command:", command);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    // Note: Drag reordering not implemented for file-based commands
    // as the order is determined by file system or alphabetical sorting
    console.log("Drag end:", event);
  };

  return (
    <div className="tw-space-y-4">
      <section>
        <div className="tw-mb-4 tw-flex tw-flex-col tw-gap-2">
          <div className="tw-text-xl tw-font-bold">Custom Commands</div>
          <div className="tw-text-sm tw-text-muted">
            Commands are loaded from your custom prompts folder:{" "}
            <strong>{settings.customPromptsFolder}</strong>. To trigger a custom command, highlight
            text in the editor and select it from the command palette, or right-click and choose it
            from the context menu if configured.
          </div>
        </div>

        <div className="tw-flex tw-items-start tw-gap-2 tw-rounded-md tw-border tw-border-solid tw-border-border tw-p-4 tw-text-muted">
          <Lightbulb className="tw-size-5" /> Commands are automatically loaded from .md files in
          your custom prompts folder, including nested folders. Create or edit .md files in that
          folder to manage your commands. Use the &quot;In Menu&quot; checkbox to toggle context
          menu availability, which updates the{" "}
          <code className="tw-rounded tw-bg-secondary tw-px-1">
            copilot-command-context-menu-enabled
          </code>{" "}
          frontmatter property in each file.
        </div>

        <div className="tw-flex tw-flex-col tw-gap-4">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="tw-w-10"></TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="tw-w-20 tw-text-center">In Menu</TableHead>
                  <TableHead className="tw-w-32 tw-text-center">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <SortableContext
                items={commands.map((command) => command.name)}
                strategy={verticalListSortingStrategy}
              >
                <TableBody>
                  {commands.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="tw-py-8 tw-text-center tw-text-muted">
                        No custom prompt files found in &quot;{settings.customPromptsFolder}&quot;.
                        Create .md files in that folder to add commands.
                      </TableCell>
                    </TableRow>
                  ) : (
                    commands.map((command) => (
                      <SortableTableRow
                        key={command.name}
                        command={command}
                        onUpdate={handleUpdate}
                        onRemove={handleRemove}
                        onDuplicate={handleDuplicate}
                      />
                    ))
                  )}
                </TableBody>
              </SortableContext>
            </Table>
          </DndContext>
          <div className="tw-flex tw-w-full tw-justify-end">
            <div className="tw-text-sm tw-text-muted">
              Add new commands by creating .md files in your custom prompts folder
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
