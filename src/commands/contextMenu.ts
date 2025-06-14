import { getCommandId, sortCommandsByOrder } from "@/commands/customCommandUtils";
import { Menu } from "obsidian";
import { CustomCommand } from "./type";
import { customCommandsAtom, customCommandsStore } from "@/commands/state";

export function registerContextMenu(menu: Menu) {
  const commands = customCommandsStore.get(customCommandsAtom);

  sortCommandsByOrder(
    commands.filter((command: CustomCommand) => command.showInContextMenu)
  ).forEach((command: CustomCommand) => {
    menu.addItem((item) => {
      item.setTitle(`Copilot: ${command.title}`).onClick(async (e) => {
        (app as any).commands.executeCommandById(`copilot:${getCommandId(command.title)}`);
      });
    });
  });
}
