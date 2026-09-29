import { getCommandId, sortCommandsByOrder } from "@/commands/customCommandUtils";
import { getCachedCustomCommands } from "@/commands/state";
import { COMMAND_IDS } from "@/constants";
import type { App, Menu } from "obsidian";
import type { CustomCommand } from "./type";

interface CommandManager {
  executeCommandById: (commandId: string) => boolean;
}

interface AppWithCommands extends App {
  commands: CommandManager;
}

function hasCommandManager(app: App): app is AppWithCommands {
  return typeof (app as Partial<AppWithCommands>).commands?.executeCommandById === "function";
}

export function registerContextMenu(menu: Menu, obsidianApp: App): void {
  if (!hasCommandManager(obsidianApp)) return;

  const execute = (commandId: string): void => {
    obsidianApp.commands.executeCommandById(commandId);
  };

  menu.addItem((item) => {
    item.setTitle("Copilot");
    item.setSubmenu();

    const submenu = item.submenu;
    if (!submenu) return;

    submenu.addItem((subItem) => {
      subItem.setTitle("Quick Ask").onClick(() => {
        execute(`copilot:${COMMAND_IDS.TRIGGER_QUICK_ASK}`);
      });
    });

    submenu.addItem((subItem) => {
      subItem.setTitle("Trigger quick command").onClick(() => {
        execute(`copilot:${COMMAND_IDS.TRIGGER_QUICK_COMMAND}`);
      });
    });

    const commands = getCachedCustomCommands();
    const visibleCustomCommands = commands.filter(
      (command: CustomCommand) => command.showInContextMenu
    );

    if (visibleCustomCommands.length > 0) {
      submenu.addSeparator();
    }

    sortCommandsByOrder(visibleCustomCommands).forEach((command: CustomCommand) => {
      submenu.addItem((subItem) => {
        subItem.setTitle(command.title).onClick(() => {
          execute(`copilot:${getCommandId(command.title)}`);
        });
      });
    });
  });
}
