import { getCommandId, sortCommandsByOrder } from "@/commands/customCommandUtils";
import { getCachedCustomCommands } from "@/commands/state";
import { COMMAND_IDS } from "@/constants";
import { Menu } from "obsidian";
import { CustomCommand } from "./type";
import { isLivePreviewModeOn } from "@/utils";

export function registerContextMenu(menu: Menu) {
  // Create the main "Copilot" submenu
  menu.addItem((item) => {
    item.setTitle("Copilot");
    (item as any).setSubmenu();

    const submenu = (item as any).submenu;
    if (!submenu) return;

    // Add the main selection command
    submenu.addItem((subItem: any) => {
      subItem.setTitle("Add selection to chat context").onClick(() => {
        (app as any).commands.executeCommandById(
          `copilot:${COMMAND_IDS.ADD_SELECTION_TO_CHAT_CONTEXT}`
        );
      });
    });

    if (isLivePreviewModeOn()) {
      submenu.addItem((subItem: any) => {
        subItem.setTitle("Trigger quick command").onClick(() => {
          (app as any).commands.executeCommandById(`copilot:${COMMAND_IDS.TRIGGER_QUICK_COMMAND}`);
        });
      });
    }

    // Get custom commands
    const commands = getCachedCustomCommands();
    const visibleCustomCommands = commands.filter(
      (command: CustomCommand) => command.showInContextMenu
    );

    // Add separator if there are custom commands
    if (visibleCustomCommands.length > 0) {
      submenu.addSeparator();
    }

    // Add custom commands to submenu
    sortCommandsByOrder(visibleCustomCommands).forEach((command: CustomCommand) => {
      submenu.addItem((subItem: any) => {
        subItem.setTitle(command.title).onClick(() => {
          (app as any).commands.executeCommandById(`copilot:${getCommandId(command.title)}`);
        });
      });
    });
  });
}
