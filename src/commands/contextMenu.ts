import { getCommandId, sortCommandsByOrder } from "@/commands/customCommandUtils";
import { getCachedCustomCommands } from "@/commands/state";
import { COMMAND_ICONS, COMMAND_IDS, COMMAND_NAMES } from "@/constants";
import { TFile, type App, type EventRef, type Menu, type TAbstractFile } from "obsidian";
import type { CustomCommand } from "./type";

type PublishFile = (file: TFile) => void;

interface CommandManager {
  executeCommandById: (commandId: string) => boolean;
}

interface AppWithCommands extends App {
  commands: CommandManager;
}

/**
 * Type guard for the command manager surface used by Copilot.
 */
function hasCommandManager(app: App): app is AppWithCommands {
  return typeof (app as Partial<AppWithCommands>).commands?.executeCommandById === "function";
}

function isMarkdownFile(file: TAbstractFile | null): file is TFile {
  return file instanceof TFile && file.extension === "md";
}

/**
 * Registers the Copilot submenu entries in Obsidian's editor context menu.
 */
export function registerContextMenu(
  menu: Menu,
  obsidianApp: App,
  file: TFile | null,
  publish: PublishFile
): void {
  if (!hasCommandManager(obsidianApp)) return;

  const execute = (commandId: string): void => {
    obsidianApp.commands.executeCommandById(commandId);
  };

  // Create the main "Copilot" submenu
  menu.addItem((item) => {
    item.setTitle("Copilot");
    item.setSubmenu();

    const submenu = item.submenu;
    if (!submenu) return;

    // Add the main selection command
    submenu.addItem((subItem) => {
      subItem.setTitle("Add selection to chat context").onClick(() => {
        execute(`copilot:${COMMAND_IDS.ADD_SELECTION_TO_CHAT_CONTEXT}`);
      });
    });

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

    if (isMarkdownFile(file)) {
      submenu.addItem((subItem) => {
        subItem
          .setTitle(COMMAND_NAMES[COMMAND_IDS.PUBLISH_FILE_TO_SYMPOSIUM])
          .setIcon(COMMAND_ICONS[COMMAND_IDS.PUBLISH_FILE_TO_SYMPOSIUM]!)
          .onClick(() => publish(file));
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
      submenu.addItem((subItem) => {
        subItem.setTitle(command.title).onClick(() => {
          execute(`copilot:${getCommandId(command.title)}`);
        });
      });
    });
  });
}

interface SymposiumFileMenuHost {
  app: App;
  registerEvent(eventRef: EventRef): void;
}

/**
 * Registers the shared explorer and note-menu action while preserving the exact clicked file.
 */
export function registerSymposiumFileMenu(host: SymposiumFileMenuHost, publish: PublishFile): void {
  host.registerEvent(
    host.app.workspace.on("file-menu", (menu, file) => {
      if (!isMarkdownFile(file)) {
        return;
      }

      menu.addItem((item) => {
        item
          .setTitle(COMMAND_NAMES[COMMAND_IDS.PUBLISH_FILE_TO_SYMPOSIUM])
          .setIcon(COMMAND_ICONS[COMMAND_IDS.PUBLISH_FILE_TO_SYMPOSIUM]!)
          .onClick(() => publish(file));
      });
    })
  );
}
