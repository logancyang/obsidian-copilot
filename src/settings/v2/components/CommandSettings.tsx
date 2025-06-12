import React from "react";
import { Button } from "@/components/ui/button";
import {
  useCustomPromptCommands,
  CustomPromptCommand,
} from "@/settings/v2/hooks/useCustomPromptCommands";
import { Lightbulb, GripVertical, PencilLine, Trash2, Plus, Info } from "lucide-react";

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
import { CustomPromptProcessor } from "@/customPromptProcessor";
import { Notice } from "obsidian";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const validateCommandName = (
  name: string,
  commands: CustomPromptCommand[],
  currentCommandName?: string
) => {
  const trimmedName = name.trim();

  if (currentCommandName && trimmedName === currentCommandName) {
    return null; // No change is allowed
  }

  // eslint-disable-next-line no-control-regex
  const invalidChars = /[<>:"/\\|?*\x00-\x1F]/g;
  if (invalidChars.test(trimmedName)) {
    return 'Command name contains invalid characters. Avoid using: < > : " / \\ | ? *';
  }

  if (commands.some((cmd) => cmd.name.toLowerCase() === trimmedName.toLowerCase())) {
    return "A command with this name already exists";
  }

  return null;
};

const SortableTableRow: React.FC<{
  command: CustomPromptCommand;
  commands: CustomPromptCommand[];
  onUpdate: (prevCommand: CustomPromptCommand, newCommand: CustomPromptCommand) => void;
  onRemove: (command: CustomPromptCommand) => void;
  onRename: (command: CustomPromptCommand, newName: string) => void;
}> = ({ command, commands, onUpdate, onRemove, onRename }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: command.name,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const container = useContainerContext();

  // Rename state
  const [isRenameOpen, setIsRenameOpen] = React.useState(false);
  const [newName, setNewName] = React.useState("");
  const [isRenaming, setIsRenaming] = React.useState(false);

  // Delete state
  const [isDeleteOpen, setIsDeleteOpen] = React.useState(false);
  const [isDeleting, setIsDeleting] = React.useState(false);

  const validationError = validateCommandName(newName, commands, command.name);
  const canRename = !validationError && newName.trim() !== "";

  const handleRename = async () => {
    if (!canRename) return;

    try {
      setIsRenaming(true);
      await onRename(command, newName.trim());
      setNewName("");
      setIsRenameOpen(false);
    } catch (error) {
      console.error("Failed to rename command:", error);
    } finally {
      setIsRenaming(false);
    }
  };

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
        <Checkbox
          checked={command.slashCommandEnabled}
          onCheckedChange={(checked) =>
            onUpdate(command, {
              ...command,
              slashCommandEnabled: checked === true,
            })
          }
          className="tw-mx-auto"
        />
      </TableCell>
      <TableCell className="tw-text-center">
        <div className="tw-flex tw-justify-center tw-space-x-1">
          <Popover open={isRenameOpen} onOpenChange={setIsRenameOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  setNewName(command.name);
                  setIsRenameOpen(true);
                }}
              >
                <PencilLine className="tw-size-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent container={container} className="tw-w-80" align="end">
              <div className="tw-flex tw-flex-col tw-gap-4">
                <div className="tw-space-y-2">
                  <div className="tw-text-lg tw-font-medium tw-leading-none">Rename Command</div>
                  <p className="tw-text-sm tw-text-muted">Enter a new name for this command.</p>
                </div>
                <div className="tw-space-y-2">
                  <Input
                    placeholder="Command name"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && canRename && !isRenaming) {
                        handleRename();
                      }
                    }}
                  />
                  {validationError && <p className="tw-text-sm tw-text-error">{validationError}</p>}
                </div>
                <div className="tw-flex tw-justify-end tw-gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setIsRenameOpen(false);
                      setNewName("");
                    }}
                    disabled={isRenaming}
                  >
                    Cancel
                  </Button>
                  <Button size="sm" onClick={handleRename} disabled={!canRename || isRenaming}>
                    {isRenaming ? "Renaming..." : "Rename"}
                  </Button>
                </div>
              </div>
            </PopoverContent>
          </Popover>
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
                  Are you sure you want to delete the command &quot;{command.name}&quot;? This will
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
  const {
    commands,
    updateContextMenuSetting,
    updateSlashCommandSetting,
    updateOrder,
    reloadCommands,
  } = useCustomPromptCommands();
  const [localCommands, setLocalCommands] = React.useState<CustomPromptCommand[]>(commands);

  // Add Command popover state
  const [isAddCommandOpen, setIsAddCommandOpen] = React.useState(false);
  const [newCommandName, setNewCommandName] = React.useState("");
  const [isCreating, setIsCreating] = React.useState(false);

  // Sync local state when commands from hook change
  React.useEffect(() => {
    setLocalCommands(commands);
  }, [commands]);

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

  const validationError = validateCommandName(newCommandName, localCommands);
  const canCreate = !validationError && newCommandName.trim() !== "";

  const handleCreateCommand = async () => {
    if (!canCreate) return;

    try {
      setIsCreating(true);
      const customPromptProcessor = CustomPromptProcessor.getInstance(app.vault);

      await customPromptProcessor.savePrompt(newCommandName.trim(), "");
      await reloadCommands();

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

  const handleUpdate = async (
    prevCommand: CustomPromptCommand,
    newCommand: CustomPromptCommand
  ) => {
    // Optimistically update local state
    setLocalCommands((prev) =>
      prev.map((cmd) =>
        cmd.filePath === newCommand.filePath
          ? {
              ...cmd,
              showInContextMenu: newCommand.showInContextMenu,
              slashCommandEnabled: newCommand.slashCommandEnabled,
            }
          : cmd
      )
    );

    // Update backend in background
    if (prevCommand.showInContextMenu !== newCommand.showInContextMenu) {
      await updateContextMenuSetting(newCommand.filePath, newCommand.showInContextMenu);
    }

    if (prevCommand.slashCommandEnabled !== newCommand.slashCommandEnabled) {
      await updateSlashCommandSetting(newCommand.filePath, newCommand.slashCommandEnabled);
    }
  };

  const handleRename = async (command: CustomPromptCommand, newName: string) => {
    try {
      const customPromptProcessor = CustomPromptProcessor.getInstance(app.vault);

      // Get the current content to preserve it
      const currentPrompt = await customPromptProcessor.getPrompt(command.name);
      if (!currentPrompt) {
        throw new Error("Command not found");
      }

      // Rename the file using updatePrompt
      await customPromptProcessor.updatePrompt(command.name, newName, currentPrompt.content);
      await reloadCommands();

      new Notice(`Command renamed to "${newName}" successfully!`);
    } catch (error) {
      console.error("Failed to rename command:", error);
      new Notice("Failed to rename command. Please try again.");
      throw error;
    }
  };

  const handleRemove = async (command: CustomPromptCommand) => {
    try {
      const customPromptProcessor = CustomPromptProcessor.getInstance(app.vault);

      // Delete the file using the command name (not filePath)
      await customPromptProcessor.deletePrompt(command.name);
      await reloadCommands();

      new Notice(`Command "${command.name}" deleted successfully!`);
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

    const activeIndex = localCommands.findIndex((command) => command.name === active.id);
    const overIndex = localCommands.findIndex((command) => command.name === over.id);

    if (activeIndex === -1 || overIndex === -1) {
      return;
    }

    // Optimistically update local state immediately
    const newCommands = [...localCommands];
    const [movedCommand] = newCommands.splice(activeIndex, 1);
    newCommands.splice(overIndex, 0, movedCommand);

    // Update the order values for the optimistic state
    const updatedCommands = newCommands.map((command, index) => ({
      ...command,
      order: index * 10,
    }));

    setLocalCommands(updatedCommands);

    // Update backend in background
    // Use increments of 10 to allow for future insertions between items
    try {
      const updatePromises = newCommands.map(
        (command, index) => updateOrder(command.filePath, index * 10, true) // Skip reload for batch operations
      );

      await Promise.all(updatePromises);

      // Reload commands only once after all updates complete
      await reloadCommands();
    } catch (error) {
      console.error("Failed to update command order:", error);
      // On error, revert to the original commands from the hook
      setLocalCommands(commands);
    }
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
                items={localCommands.map((command) => command.name)}
                strategy={verticalListSortingStrategy}
              >
                <TableBody>
                  {localCommands.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="tw-py-8 tw-text-center tw-text-muted">
                        No custom prompt files found in &quot;{settings.customPromptsFolder}&quot;.
                        Create .md files in that folder to add commands.
                      </TableCell>
                    </TableRow>
                  ) : (
                    localCommands.map((command) => (
                      <SortableTableRow
                        key={command.name}
                        command={command}
                        commands={localCommands}
                        onUpdate={handleUpdate}
                        onRemove={handleRemove}
                        onRename={handleRename}
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
