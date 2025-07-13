import React, { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { useCustomCommands } from "@/commands/state";
import { Lightbulb, GripVertical, Trash2, Plus, Info, PenLine, Copy } from "lucide-react";

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
import { useSettingsValue } from "@/settings/model";
import { updateSetting } from "@/settings/model";
import { PromptSortStrategy } from "@/types";

import { Notice } from "obsidian";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { CustomCommand } from "@/commands/type";
import {
  loadAllCustomCommands,
  sortCommandsByOrder,
  generateCopyCommandName,
} from "@/commands/customCommandUtils";
import { CustomCommandSettingsModal } from "@/commands/CustomCommandSettingsModal";
import { SettingItem } from "@/components/ui/setting-item";
import { CustomCommandManager } from "@/commands/customCommandManager";
import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { generateDefaultCommands } from "@/commands/migrator";
import { EMPTY_COMMAND } from "@/commands/constants";

const SortableTableRow: React.FC<{
  command: CustomCommand;
  commands: CustomCommand[];
  onUpdate: (newCommand: CustomCommand, prevCommandTitle: string) => void;
  onRemove: (command: CustomCommand) => void;
  onCopy: (command: CustomCommand) => void;
}> = ({ command, commands, onUpdate, onRemove, onCopy }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: command.title,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const handleDelete = () => {
    onRemove(command);
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
              command.title
            );
          }}
          className="tw-mx-auto"
        />
      </TableCell>
      <TableCell className="tw-text-center">
        <Checkbox
          checked={command.showInSlashMenu}
          onCheckedChange={(checked) =>
            onUpdate(
              {
                ...command,
                showInSlashMenu: checked === true,
              },
              command.title
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
                  await onUpdate(updatedCommand, command.title);
                }
              );
              modal.open();
            }}
          >
            <PenLine className="tw-size-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => onCopy(command)} title="Copy command">
            <Copy className="tw-size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              new ConfirmModal(
                app,
                handleDelete,
                `Are you sure you want to delete the command "${command.title}"? This will permanently remove the command file and cannot be undone.`,
                "Delete Command",
                "Delete",
                "Cancel"
              ).open();
            }}
          >
            <Trash2 className="tw-size-4" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
};

export const CommandSettings: React.FC = () => {
  const rawCommands = useCustomCommands();
  const commands = useMemo(() => {
    return sortCommandsByOrder([...rawCommands]);
  }, [rawCommands]);

  const settings = useSettingsValue();
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

  const handleUpdate = async (newCommand: CustomCommand, prevCommandTitle: string) => {
    await CustomCommandManager.getInstance().updateCommand(newCommand, prevCommandTitle);
  };

  const handleCreate = async (newCommand: CustomCommand) => {
    await CustomCommandManager.getInstance().createCommand(newCommand);
  };

  const handleRemove = async (command: CustomCommand) => {
    try {
      await CustomCommandManager.getInstance().deleteCommand(command);

      new Notice(`Command "${command.title}" deleted successfully!`);
    } catch (error) {
      console.error("Failed to delete command:", error);
      new Notice("Failed to delete command. Please try again.");
      throw error;
    }
  };

  const handleCopy = async (command: CustomCommand) => {
    try {
      const copyName = generateCopyCommandName(command.title, commands);
      const copiedCommand: CustomCommand = {
        ...command,
        title: copyName,
      };
      await CustomCommandManager.getInstance().createCommand(copiedCommand, {
        // Explicitly make the new command the same order as the original command
        // so it appears next to the original command in the menu. The extra
        // suffix will ensure it is below the original command in the menu.
        autoOrder: false,
      });
    } catch (error) {
      console.error("Failed to copy command:", error);
      new Notice("Failed to copy command. Please try again.");
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

    await CustomCommandManager.getInstance().reorderCommands(newCommands);
  };

  return (
    <div className="tw-space-y-4">
      <section>
        <div className="tw-mb-4 tw-flex tw-flex-col tw-gap-2">
          <div className="tw-text-xl tw-font-bold">Custom Commands</div>
          <div className="tw-text-sm tw-text-muted">
            Custom commands are preset prompts that you can trigger in the editor by right-clicking
            and selecting them from the context menu or by using a <code>/</code> command in the
            chat to load them into your chat input.
          </div>
        </div>

        <SettingItem
          type="text"
          title="Custom Prompts Folder Name"
          description="Folder where custom prompts are stored"
          value={settings.customPromptsFolder}
          onChange={(value) => {
            updateSetting("customPromptsFolder", value);
            loadAllCustomCommands();
          }}
          placeholder="copilot-custom-prompts"
        />
        <SettingItem
          type="switch"
          title="Custom Prompt Templating"
          description="Process variables like {activenote}, {foldername}, or {#tag} in prompts. Disable for raw prompts."
          checked={settings.enableCustomPromptTemplating}
          onCheckedChange={(checked) => {
            updateSetting("enableCustomPromptTemplating", checked);
          }}
        />
        <SettingItem
          type="select"
          title="Custom Prompts Sort Strategy"
          description="Sort order for slash command menu prompts"
          value={settings.promptSortStrategy}
          onChange={(value) => updateSetting("promptSortStrategy", value)}
          options={[
            { label: "Recency", value: PromptSortStrategy.TIMESTAMP },
            { label: "Alphabetical", value: PromptSortStrategy.ALPHABETICAL },
            { label: "Manual", value: PromptSortStrategy.MANUAL },
          ]}
        />

        <div className="tw-mb-4 tw-flex tw-items-start tw-gap-2 tw-rounded-md tw-border tw-border-solid tw-border-border tw-p-4 tw-text-muted">
          <Lightbulb className="tw-size-5" />{" "}
          <div>
            Commands are automatically loaded from .md files in your custom prompts folder{" "}
            <strong>{settings.customPromptsFolder}</strong>. Modifying the files will also update
            the command settings.
          </div>
        </div>

        <div className="tw-flex tw-flex-col tw-gap-4">
          <div className="tw-flex tw-w-full tw-justify-between">
            <div>
              <Button
                variant="secondary"
                onClick={() =>
                  new ConfirmModal(
                    app,
                    generateDefaultCommands,
                    "This will add default commands to your custom prompts folder. Do you want to continue?",
                    "Generate Default Commands"
                  ).open()
                }
              >
                Generate Default Commands
              </Button>
            </div>
            <Button
              variant="default"
              className="tw-gap-2"
              onClick={() => {
                const newCommand: CustomCommand = {
                  ...EMPTY_COMMAND,
                };
                const modal = new CustomCommandSettingsModal(
                  app,
                  commands,
                  newCommand,
                  async (updatedCommand) => {
                    await handleCreate(updatedCommand);
                  }
                );
                modal.open();
              }}
            >
              <Plus className="tw-size-4" />
              Add Command
            </Button>
          </div>
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
                        No custom prompt files found.
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
                        onCopy={handleCopy}
                      />
                    ))
                  )}
                </TableBody>
              </SortableContext>
            </Table>
          </DndContext>
        </div>
      </section>
    </div>
  );
};
