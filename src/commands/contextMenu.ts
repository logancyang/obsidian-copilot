import { getCommandId, sortCommandsByOrder } from "@/commands/customCommandUtils";
import { getCachedCustomCommands } from "@/commands/state";
import { COMMAND_IDS } from "@/constants";
import { Menu } from "obsidian";
import { CustomCommand } from "./type";

export function registerContextMenu(menu: Menu) {
  menu.addItem((item) => {
    item.setTitle("Copilot: Add selection to chat context").onClick(() => {
      (app as any).commands.executeCommandById(
        `copilot:${COMMAND_IDS.ADD_SELECTION_TO_CHAT_CONTEXT}`
      );
    });
  });

  // Add separator if there are custom commands too
  const commands = getCachedCustomCommands();
  const visibleCustomCommands = commands.filter(
    (command: CustomCommand) => command.showInContextMenu
  );
  if (visibleCustomCommands.length > 0) {
    menu.addSeparator();
  }

  sortCommandsByOrder(
    commands.filter((command: CustomCommand) => command.showInContextMenu)
  ).forEach((command: CustomCommand) => {
    menu.addItem((item) => {
      item.setTitle(`Copilot: ${command.title}`).onClick(() => {
        (app as any).commands.executeCommandById(`copilot:${getCommandId(command.title)}`);
      });
    });
  });
}
