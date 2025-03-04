import React from "react";
import { InlineEditCommandSettings, updateSetting } from "@/settings/model";
import { Button } from "@/components/ui/button";
import { InlineEditCommandSettingsModal } from "@/components/modals/InlineEditCommandSettingsModal";
import { hasModifiedCommand, useInlineEditCommands } from "@/commands/inlineEditCommandUtils";
import { Lightbulb, PencilLine, Plus } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";

export const CommandSettings: React.FC = () => {
  const commands = useInlineEditCommands();
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

  const handleRemove = (command: InlineEditCommandSettings) => {
    updateSetting(
      "inlineEditCommands",
      commands.filter((c) => c !== command)
    );
  };

  return (
    <div className="space-y-4">
      <section>
        <div className="flex flex-col mb-4 gap-2">
          <div className="text-xl font-bold">Custom Commands</div>
          <div className="text-sm text-muted">
            To trigger a custom command, highlight text in the editor and select it from the command
            palette, or right-click and choose it from the context menu if configured.
          </div>
        </div>
        {!hasModifiedCommand() && (
          <div className="border border-border border-solid p-4 rounded-md text-muted flex items-start gap-2">
            <Lightbulb className="size-5" /> Take control of your inline edit commands! You can now
            create your own or edit built-in ones to tailor functionality to your needs.
          </div>
        )}

        <div className="flex flex-col gap-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="text-center w-20">In Menu</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {commands.map((command) => (
                <TableRow key={command.name}>
                  <TableCell>{command.name}</TableCell>
                  <TableCell className="text-center">
                    <Checkbox
                      checked={command.showInContextMenu}
                      onCheckedChange={(checked) =>
                        handleUpdate(command, {
                          ...command,
                          showInContextMenu: checked === true,
                        })
                      }
                      className="mx-auto"
                    />
                  </TableCell>
                  <TableCell className="text-center">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        new InlineEditCommandSettingsModal(
                          app,
                          command,
                          (newCommand) => handleUpdate(command, newCommand),
                          () => handleRemove(command)
                        ).open()
                      }
                    >
                      <PencilLine className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
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
