import { getCommandId, getInlineEditCommands } from "@/commands/inlineEditCommandUtils";
import CopilotPlugin from "@/main";
import { Editor, Menu } from "obsidian";

export function registerContextMenu(menu: Menu, editor: Editor, plugin: CopilotPlugin) {
  const commands = getInlineEditCommands();

  commands
    .filter((command) => command.showInContextMenu)
    .forEach((command) => {
      menu.addItem((item) => {
        item.setTitle(`Copilot: ${command.name}`).onClick(async (e) => {
          (plugin.app as any).commands.executeCommandById(`copilot:${getCommandId(command.name)}`);
        });
      });
    });
}
