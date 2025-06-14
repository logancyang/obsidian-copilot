import React from "react";
import { Button } from "@/components/ui/button";
import { useCustomCommands } from "@/commands/state";
import { Lightbulb, GripVertical, Trash2, Plus, Info, PenLine } from "lucide-react";

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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useContainerContext } from "@/settings/v2/components/ContainerContext";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Notice } from "obsidian";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { CustomCommand } from "@/commands/type";
import { validateCommandName } from "@/commands/customCommandUtils";
import { CustomCommandSettingsModal } from "@/commands/CustomCommandSettingsModal";

const SortableTableRow: React.FC<{
  command: CustomCommand;
  commands: CustomCommand[];
  onUpdate: (prevCommand: CustomCommand, newCommand: CustomCommand) => void;
  onRemove: (command: CustomCommand) => void;
}> = ({ command, commands, onUpdate, onRemove }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: command.title,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const container = useContainerContext();

  // Delete state
  const [isDeleteOpen, setIsDeleteOpen] = React.useState(false);
  const [isDeleting, setIsDeleting] = React.useState(false);

  const handleDelete = async () => {
    try {
      setIsDeleting(true);
      await onRemove(command);
      setIsDeleteOpen(false);
    } catch (error) {
      console.error("Failed to delete command:", error);
    } finally {
      setIsDeleting(false);
    }
  };

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
      <TableCell>{command.title}</TableCell>
      <TableCell className="tw-text-center">
        <Checkbox
          checked={command.showInContextMenu}
          onCheckedChange={(checked) => {
            onUpdate(
              {
                ...command,
                showInContextMenu: checked === true,
              },
              command
            );
          }}
          className="tw-mx-auto"
        />
      </TableCell>
      <TableCell className="tw-text-center">
        <Checkbox
          checked={command.slashCommandEnabled}
          onCheckedChange={(checked) =>
            onUpdate(
              {
                ...command,
                slashCommandEnabled: checked === true,
              },
              command
            )
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
              const modal = new CustomCommandSettingsModal(
                app,
                commands,
                command,
                async (updatedCommand) => {
                  await onUpdate(updatedCommand, command);
                }
              );
              modal.open();
            }}
          >
            <PenLine className="tw-size-4" />
          </Button>
          <Dialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
            <DialogTrigger asChild>
              <Button variant="ghost" size="icon">
                <Trash2 className="tw-size-4" />
              </Button>
            </DialogTrigger>
            <DialogContent container={container}>
              <DialogHeader>
                <DialogTitle>Delete Command</DialogTitle>
                <DialogDescription>
                  Are you sure you want to delete the command &quot;{command.title}&quot;? This will
                  permanently remove the command file and cannot be undone.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  variant="secondary"
                  onClick={() => setIsDeleteOpen(false)}
                  disabled={isDeleting}
                >
                  Cancel
                </Button>
                <Button variant="destructive" onClick={handleDelete} disabled={isDeleting}>
                  {isDeleting ? "Deleting..." : "Delete"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </TableCell>
    </TableRow>
  );
};

export const CommandSettings: React.FC = () => {
  const { commands, updateCommand, updateCommands, addCommand, deleteCommand } =
    useCustomCommands();

  // Add Command popover state
  const [isAddCommandOpen, setIsAddCommandOpen] = React.useState(false);
  const [newCommandName, setNewCommandName] = React.useState("");
  const [isCreating, setIsCreating] = React.useState(false);

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

  const validationError = validateCommandName(newCommandName, commands);
  const canCreate = !validationError && newCommandName.trim() !== "";

  const handleCreateCommand = async () => {
    if (!canCreate) return;

    try {
      setIsCreating(true);
      await addCommand(newCommandName.trim());

      setNewCommandName("");
      setIsAddCommandOpen(false);

      new Notice(`Command "${newCommandName.trim()}" created successfully!`);
    } catch (error) {
      console.error("Failed to create command:", error);
      new Notice("Failed to create command. Please try again.");
    } finally {
      setIsCreating(false);
    }
  };

  const handleUpdate = async (newCommand: CustomCommand, prevCommand: CustomCommand) => {
    await updateCommand(newCommand, prevCommand);
  };

  const handleRemove = async (command: CustomCommand) => {
    try {
      await deleteCommand(command);

      new Notice(`Command "${command.title}" deleted successfully!`);
    } catch (error) {
      console.error("Failed to delete command:", error);
      new Notice("Failed to delete command. Please try again.");
      throw error;
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || active.id === over.id) {
      return;
    }

    const activeIndex = commands.findIndex((command) => command.title === active.id);
    const overIndex = commands.findIndex((command) => command.title === over.id);

    if (activeIndex === -1 || overIndex === -1) {
      return;
    }

    // Create new order
    const newCommands = [...commands];
    const [movedCommand] = newCommands.splice(activeIndex, 1);
    newCommands.splice(overIndex, 0, movedCommand);

    for (let i = 0; i < newCommands.length; i++) {
      newCommands[i] = { ...newCommands[i], order: i * 10 };
    }

    await updateCommands(newCommands);
  };

  const container = useContainerContext();

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
          folder to manage your commands.
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
                  <TableHead className="tw-w-24 tw-text-center">
                    <div className="tw-flex tw-items-center tw-justify-center tw-gap-1">
                      In Menu
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Info className="tw-size-4" />
                          </TooltipTrigger>
                          <TooltipContent className="tw-max-w-xs tw-text-xs">
                            If enabled, the command will be available in the context menu when you
                            right-click in the editor.
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                  </TableHead>
                  <TableHead className="tw-w-28 tw-text-center">
                    <div className="tw-flex tw-items-center tw-justify-center tw-gap-1">
                      Slash Cmd
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Info className="tw-size-4" />
                          </TooltipTrigger>
                          <TooltipContent className="tw-max-w-xs tw-text-xs">
                            If enabled, the command will be available as a slash command in the
                            chat.
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                  </TableHead>
                  <TableHead className="tw-w-32 tw-text-center">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <SortableContext
                items={commands.map((command) => command.title)}
                strategy={verticalListSortingStrategy}
              >
                <TableBody>
                  {commands.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="tw-py-8 tw-text-center tw-text-muted">
                        No custom prompt files found in &quot;{settings.customPromptsFolder}&quot;.
                        Create .md files in that folder to add commands.
                      </TableCell>
                    </TableRow>
                  ) : (
                    commands.map((command) => (
                      <SortableTableRow
                        key={command.title}
                        command={command}
                        commands={commands}
                        onUpdate={handleUpdate}
                        onRemove={handleRemove}
                      />
                    ))
                  )}
                </TableBody>
              </SortableContext>
            </Table>
          </DndContext>
          <div className="tw-flex tw-w-full tw-justify-end">
            <Popover open={isAddCommandOpen} onOpenChange={setIsAddCommandOpen}>
              <PopoverTrigger asChild>
                <Button variant="secondary" className="tw-gap-2">
                  <Plus className="tw-size-4" />
                  Add Command
                </Button>
              </PopoverTrigger>
              <PopoverContent container={container} className="tw-w-80" align="end">
                <div className="tw-flex tw-flex-col tw-gap-4">
                  <div className="tw-space-y-2">
                    <div className="tw-text-lg tw-font-medium tw-leading-none">
                      Create New Command
                    </div>
                    <p className="tw-text-sm tw-text-muted">
                      Enter a name for your new custom command. A markdown file will be created in
                      your custom prompts folder.
                    </p>
                  </div>
                  <div className="tw-space-y-2">
                    <Input
                      placeholder="Command name"
                      value={newCommandName}
                      onChange={(e) => setNewCommandName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && canCreate && !isCreating) {
                          handleCreateCommand();
                        }
                      }}
                    />
                    {validationError && (
                      <p className="tw-text-sm tw-text-error">{validationError}</p>
                    )}
                  </div>
                  <div className="tw-flex tw-justify-end tw-gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setIsAddCommandOpen(false);
                        setNewCommandName("");
                      }}
                      disabled={isCreating}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleCreateCommand}
                      disabled={!canCreate || isCreating}
                    >
                      {isCreating ? "Creating..." : "Create"}
                    </Button>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>
      </section>
    </div>
  );
};
