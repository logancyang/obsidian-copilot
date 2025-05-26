import React from "react";
import { InlineEditCommandSettings, updateSetting } from "@/settings/model";
import { Button } from "@/components/ui/button";
import { InlineEditCommandSettingsModal } from "@/components/modals/InlineEditCommandSettingsModal";
import { hasModifiedCommand, useInlineEditCommands } from "@/commands/inlineEditCommandUtils";
import {
  Lightbulb,
  PencilLine,
  Plus,
  GripVertical,
  Copy,
  MoreVertical,
  Trash2,
} from "lucide-react";
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
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useContainerContext } from "@/settings/v2/components/ContainerContext";

const SortableTableRow: React.FC<{
  command: InlineEditCommandSettings;
  onUpdate: (prevCommand: InlineEditCommandSettings, newCommand: InlineEditCommandSettings) => void;
  onRemove: (command: InlineEditCommandSettings) => void;
  onDuplicate: (command: InlineEditCommandSettings) => void;
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
        "transition-colors",
        isDragging &&
          "shadow-lg bg-background/90 backdrop-blur-sm relative z-[100] cursor-grabbing border-2 border-accent/50"
      )}
    >
      <TableCell className="w-10">
        <div
          {...attributes}
          {...listeners}
          className="flex items-center justify-center cursor-grab"
        >
          <GripVertical className="h-4 w-4 text-muted-foreground" />
        </div>
      </TableCell>
      <TableCell>{command.name}</TableCell>
      <TableCell className="text-center">
        <Checkbox
          checked={command.showInContextMenu}
          onCheckedChange={(checked) =>
            onUpdate(command, {
              ...command,
              showInContextMenu: checked === true,
            })
          }
          className="mx-auto"
        />
      </TableCell>
      <TableCell className="text-center">
        <div className="flex justify-center space-x-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() =>
              new InlineEditCommandSettingsModal(
                app,
                command,
                (newCommand) => onUpdate(command, newCommand),
                () => onRemove(command)
              ).open()
            }
          >
            <PencilLine className="h-4 w-4" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" container={container}>
              <DropdownMenuItem
                onClick={() =>
                  new InlineEditCommandSettingsModal(
                    app,
                    command,
                    (newCommand) => onUpdate(command, newCommand),
                    () => onRemove(command)
                  ).open()
                }
              >
                <PencilLine className="h-4 w-4 mr-2" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onDuplicate(command)}>
                <Copy className="h-4 w-4 mr-2" />
                Copy
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onRemove(command)} className="text-error">
                <Trash2 className="h-4 w-4 mr-2" />
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
  const commands = useInlineEditCommands();
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

  const handleUpdate = (
    prevCommand: InlineEditCommandSettings,
    newCommand: InlineEditCommandSettings
  ) => {
    const index = commands.findIndex((c) => c === prevCommand);
    if (index === -1) {
      updateSetting("inlineEditCommands", [...commands, newCommand]);
    } else {
      updateSetting("inlineEditCommands", [
        ...commands.slice(0, index),
        newCommand,
        ...commands.slice(index + 1),
      ]);
    }
  };

  const handleDuplicate = (command: InlineEditCommandSettings) => {
    const duplicatedCommand = {
      ...command,
      name: `${command.name} (copy)`,
    };
    const index = commands.findIndex((c) => c === command);
    if (index !== -1) {
      updateSetting("inlineEditCommands", [
        ...commands.slice(0, index + 1),
        duplicatedCommand,
        ...commands.slice(index + 1),
      ]);
    }
  };

  const handleRemove = (command: InlineEditCommandSettings) => {
    updateSetting(
      "inlineEditCommands",
      commands.filter((c) => c !== command)
    );
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = commands.findIndex((command) => command.name === active.id);
      const newIndex = commands.findIndex((command) => command.name === over.id);

      if (oldIndex !== -1 && newIndex !== -1) {
        const newCommands = arrayMove(commands, oldIndex, newIndex);
        updateSetting("inlineEditCommands", newCommands);
      }
    }
  };

  return (
    <div className="space-y-4">
      <section>
        <div className="flex flex-col mb-4 gap-2">
          <div className="text-xl font-bold">Custom Commands</div>
          <div className="text-sm text-muted">
            To trigger a custom command, select it from the command palette or right-click and
            choose it from the context menu if configured. When no text is highlighted, the entire
            note will be used.
          </div>
        </div>
        {!hasModifiedCommand() && (
          <div className="border border-border border-solid p-4 rounded-md text-muted flex items-start gap-2">
            <Lightbulb className="size-5" /> Take control of your inline edit commands! You can now
            create your own or edit built-in ones to tailor functionality to your needs.
          </div>
        )}

        <div className="flex flex-col gap-4">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10"></TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="text-center w-20">In Menu</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <SortableContext
                items={commands.map((command) => command.name)}
                strategy={verticalListSortingStrategy}
              >
                <TableBody>
                  {commands.map((command) => (
                    <SortableTableRow
                      key={command.name}
                      command={command}
                      onUpdate={handleUpdate}
                      onRemove={handleRemove}
                      onDuplicate={handleDuplicate}
                    />
                  ))}
                </TableBody>
              </SortableContext>
            </Table>
          </DndContext>
          <div className="flex w-full justify-end">
            <Button
              variant="secondary"
              onClick={() =>
                new InlineEditCommandSettingsModal(
                  app,
                  {
                    name: "",
                    prompt: "",
                    showInContextMenu: false,
                  },
                  (command) => handleUpdate(command, command)
                ).open()
              }
            >
              <Plus className="h-4 w-4" /> Add Command
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
};
