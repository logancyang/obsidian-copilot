import React, { useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { useCustomCommands } from "@/commands/state";
import { MobileCard, MobileCardDropdownAction } from "@/components/ui/mobile-card";
import { CopyPlus, GripVertical, Info, PenLine, Plus, Trash2 } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  closestCenter,
  DndContext,
  DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { cn } from "@/lib/utils";
import { logError } from "@/logger";
import { updateSetting, useSettingsValue } from "@/settings/model";
import { PromptSortStrategy } from "@/types";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { EMPTY_COMMAND } from "@/commands/constants";
import { CustomCommandManager } from "@/commands/customCommandManager";
import { CustomCommandSettingsModal } from "@/commands/CustomCommandSettingsModal";
import { generateCopyCommandName, sortCommandsByOrder } from "@/commands/customCommandUtils";
import { generateDefaultCommands } from "@/commands/migrator";
import { CustomCommand } from "@/commands/type";
import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { deriveCustomPromptsFolder } from "@/settings/copilotFolder";
import { useApp } from "@/context";
import { SettingItem } from "@/components/ui/setting-item";
import { SettingSection } from "@/components/ui/setting-section";
import { Notice } from "obsidian";
import { safeAsyncHandler } from "@/utils/safeAsyncHandler";
import { t } from "@/i18n";

const MobileCommandCard: React.FC<{
  command: CustomCommand;
  commands: CustomCommand[];
  onUpdate: (newCommand: CustomCommand, prevCommandTitle: string) => void | Promise<void>;
  onRemove: (command: CustomCommand) => void | Promise<void>;
  onCopy: (command: CustomCommand) => void | Promise<void>;
  containerRef: React.RefObject<HTMLDivElement>;
}> = ({ command, commands, onUpdate, onRemove, onCopy, containerRef }) => {
  const app = useApp();
  const handleEdit = (cmd: CustomCommand) => {
    const modal = new CustomCommandSettingsModal(app, commands, cmd, async (updatedCommand) => {
      await onUpdate(updatedCommand, cmd.title);
    });
    modal.open();
  };

  const dropdownActions: MobileCardDropdownAction<CustomCommand>[] = [
    {
      icon: <PenLine className="tw-size-4" />,
      label: t("settings.actions.edit"),
      onClick: handleEdit,
    },
    {
      icon: <CopyPlus className="tw-size-4" />,
      label: t("settings.actions.duplicate"),
      onClick: onCopy,
    },
    {
      icon: <Trash2 className="tw-size-4" />,
      label: t("settings.actions.delete"),
      onClick: (cmd) => {
        new ConfirmModal(
          app,
          () => onRemove(cmd),
          t("settings.command.delete.confirm", { command: cmd.title }),
          t("settings.command.delete.title"),
          t("settings.actions.delete"),
          t("settings.actions.cancel")
        ).open();
      },
      variant: "destructive",
    },
  ];

  const expandedContent = (
    <div className="tw-flex tw-flex-wrap tw-justify-around">
      <div className="tw-flex tw-items-center tw-justify-between tw-gap-2">
        <div className="tw-flex tw-items-center tw-gap-1">
          <span className="tw-text-sm tw-font-medium">{t("settings.command.inMenu")}</span>
          <HelpTooltip
            content={
              <div className="tw-max-w-xs tw-text-xs">
                {t("settings.command.inMenu.description")}
              </div>
            }
          />
        </div>
        <Checkbox
          checked={command.showInContextMenu}
          onCheckedChange={(checked) => {
            void onUpdate(
              {
                ...command,
                showInContextMenu: checked === true,
              },
              command.title
            );
          }}
        />
      </div>
      <div className="tw-flex tw-items-center tw-justify-between  tw-gap-2">
        <div className="tw-flex tw-items-center tw-gap-1">
          <span className="tw-text-sm tw-font-medium">{t("settings.command.inSlash")}</span>
          <HelpTooltip
            content={
              <div className="tw-max-w-xs tw-text-xs">
                {t("settings.command.inSlash.description")}
              </div>
            }
          />
        </div>
        <Checkbox
          checked={command.showInSlashMenu}
          onCheckedChange={safeAsyncHandler(async (checked) =>
            onUpdate(
              {
                ...command,
                showInSlashMenu: checked === true,
              },
              command.title
            )
          )}
        />
      </div>
    </div>
  );

  return (
    <MobileCard
      id={command.title}
      item={command}
      title={command.title}
      isDraggable
      isExpandable
      expandedContent={expandedContent}
      primaryAction={{
        icon: <PenLine className="tw-size-4" />,
        onClick: handleEdit,
        tooltip: t("settings.command.edit"),
      }}
      dropdownActions={dropdownActions}
      containerRef={containerRef}
    />
  );
};

const SortableTableRow: React.FC<{
  command: CustomCommand;
  commands: CustomCommand[];
  onUpdate: (newCommand: CustomCommand, prevCommandTitle: string) => void | Promise<void>;
  onRemove: (command: CustomCommand) => void | Promise<void>;
  onCopy: (command: CustomCommand) => void | Promise<void>;
}> = ({ command, commands, onUpdate, onRemove, onCopy }) => {
  const app = useApp();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: command.title,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const handleDelete = () => {
    void onRemove(command);
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
            void onUpdate(
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
          onCheckedChange={safeAsyncHandler(async (checked) =>
            onUpdate(
              {
                ...command,
                showInSlashMenu: checked === true,
              },
              command.title
            )
          )}
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
          <Button
            variant="ghost"
            size="icon"
            onClick={safeAsyncHandler(async () => onCopy(command))}
            title={t("settings.command.duplicate")}
          >
            <CopyPlus className="tw-size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              new ConfirmModal(
                app,
                handleDelete,
                t("settings.command.delete.confirm", { command: command.title }),
                t("settings.command.delete.title"),
                t("settings.actions.delete"),
                t("settings.actions.cancel")
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
  const app = useApp();
  const rawCommands = useCustomCommands();
  const commands = useMemo(() => {
    return sortCommandsByOrder([...rawCommands]);
  }, [rawCommands]);

  const settings = useSettingsValue();
  // Derived from the single Copilot root; the folder is no longer separately
  // editable, so the banner shows where commands are actually loaded from.
  const customPromptsFolder = deriveCustomPromptsFolder(settings);
  const containerRef = useRef<HTMLDivElement>(null);
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

      new Notice(t("settings.command.notice.deleted", { command: command.title }));
    } catch (error) {
      logError("Failed to delete command:", error);
      new Notice(t("settings.command.notice.deleteFailed"));
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
      logError("Failed to duplicate command:", error);
      new Notice(t("settings.command.notice.duplicateFailed"));
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

  // Mobile view rendering
  const renderMobileView = () => (
    <div className="tw-relative md:tw-hidden">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={(event) => void handleDragEnd(event)}
      >
        <SortableContext
          items={commands.map((command) => command.title)}
          strategy={verticalListSortingStrategy}
        >
          <div className="tw-space-y-2">
            {commands.length === 0 ? (
              <div className="tw-rounded-lg tw-border tw-border-border tw-bg-primary tw-p-8 tw-text-center tw-text-muted">
                {t("settings.command.empty")}
              </div>
            ) : (
              commands.map((command) => (
                <MobileCommandCard
                  key={command.title}
                  command={command}
                  commands={commands}
                  onUpdate={handleUpdate}
                  onRemove={handleRemove}
                  onCopy={handleCopy}
                  containerRef={containerRef}
                />
              ))
            )}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );

  return (
    <div className="tw-space-y-4" ref={containerRef}>
      <section className={cn("tw-flex tw-flex-col tw-gap-4")}>
        <div className="tw-flex tw-flex-col tw-gap-2">
          <div className="tw-text-xl tw-font-bold">{t("settings.command.title")}</div>
          <div className="tw-text-sm tw-text-muted">{t("settings.command.description")}</div>
        </div>

        <div className="tw-flex tw-items-start tw-gap-2 tw-rounded-md tw-border tw-border-solid tw-border-border tw-p-4 tw-text-muted tw-bg-interactive-accent/10">
          <Info className="tw-size-5 tw-shrink-0 tw-text-accent" />{" "}
          <div>{t("settings.command.folderDescription", { folder: customPromptsFolder })}</div>
        </div>

        <SettingSection>
          <SettingItem
            type="switch"
            title={t("settings.command.templating.title")}
            description={t("settings.command.templating.description")}
            checked={settings.enableCustomPromptTemplating}
            onCheckedChange={(checked) => {
              updateSetting("enableCustomPromptTemplating", checked);
            }}
          />
          <SettingItem
            type="select"
            title={t("settings.command.sort.title")}
            description={t("settings.command.sort.description")}
            value={settings.promptSortStrategy}
            onChange={(value) => updateSetting("promptSortStrategy", value)}
            options={[
              { label: t("settings.command.sort.recency"), value: PromptSortStrategy.TIMESTAMP },
              {
                label: t("settings.command.sort.alphabetical"),
                value: PromptSortStrategy.ALPHABETICAL,
              },
              { label: t("settings.command.sort.manual"), value: PromptSortStrategy.MANUAL },
            ]}
          />
        </SettingSection>

        <div className="tw-flex tw-flex-col tw-gap-4">
          <div className="tw-flex tw-w-full tw-justify-between tw-gap-2 md:tw-justify-end">
            <div>
              <Button
                variant="secondary"
                onClick={() =>
                  new ConfirmModal(
                    app,
                    generateDefaultCommands,
                    t("settings.command.generate.confirm"),
                    t("settings.command.generate.title")
                  ).open()
                }
              >
                {t("settings.command.generate.action")}
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
              <Plus className="tw-size-2 md:tw-size-4" />
              {t("settings.command.add")}
            </Button>
          </div>

          {/* Desktop view */}
          <div className="tw-hidden md:tw-block">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={(event) => void handleDragEnd(event)}
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="tw-w-10"></TableHead>
                    <TableHead>{t("settings.command.table.name")}</TableHead>
                    <TableHead className="tw-w-24 tw-text-center">
                      <div className="tw-flex tw-items-center tw-justify-center tw-gap-1">
                        {t("settings.command.inMenu")}
                        <HelpTooltip
                          content={
                            <div className="tw-max-w-xs tw-text-xs">
                              {t("settings.command.inMenu.description")}
                            </div>
                          }
                        />
                      </div>
                    </TableHead>
                    <TableHead className="tw-w-28 tw-text-center">
                      <div className="tw-flex tw-items-center tw-justify-center tw-gap-1">
                        {t("settings.command.inSlash.short")}
                        <HelpTooltip
                          content={
                            <div className="tw-max-w-xs tw-text-xs">
                              {t("settings.command.inSlash.description")}
                            </div>
                          }
                        />
                      </div>
                    </TableHead>
                    <TableHead className="tw-w-32 tw-text-center">
                      {t("settings.command.table.actions")}
                    </TableHead>
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
                          {t("settings.command.empty")}
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

          {/* Mobile view */}
          {renderMobileView()}
        </div>
      </section>
    </div>
  );
};
