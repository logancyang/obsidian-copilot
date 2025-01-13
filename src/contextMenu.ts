import { isCommandEnabled } from "@/commands";
import { COMMAND_NAMES, CONTEXT_MENU_COMMANDS } from "@/constants";
import CopilotPlugin from "@/main";
import { Editor, Menu } from "obsidian";

export function registerContextMenu(menu: Menu, editor: Editor, plugin: CopilotPlugin) {
  CONTEXT_MENU_COMMANDS.filter((commandId) => isCommandEnabled(commandId)).forEach((commandId) => {
    menu.addItem((item) => {
      item.setTitle(`Copilot: ${COMMAND_NAMES[commandId]}`).onClick(async (e) => {
        plugin.processSelection(editor, commandId);
      });
    });
  });
}
