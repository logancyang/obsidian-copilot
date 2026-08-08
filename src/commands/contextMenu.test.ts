import { registerContextMenu, registerSymposiumFileMenu } from "@/commands/contextMenu";
import { COMMAND_IDS, COMMAND_ICONS, COMMAND_NAMES } from "@/constants";
import { TFile, TFolder, type App, type EventRef, type Menu } from "obsidian";

jest.mock("@/commands/state", () => ({
  getCachedCustomCommands: jest.fn(() => []),
}));

class TestMenuItem {
  title = "";
  icon = "";
  submenu: TestMenu | null = null;
  click: (() => void) | null = null;

  setTitle(title: string): TestMenuItem {
    this.title = title;
    return this;
  }

  setIcon(icon: string): TestMenuItem {
    this.icon = icon;
    return this;
  }

  setSubmenu(): TestMenuItem {
    this.submenu = new TestMenu();
    return this;
  }

  onClick(callback: () => void): TestMenuItem {
    this.click = callback;
    return this;
  }
}

class TestMenu {
  readonly items: TestMenuItem[] = [];

  addItem(configure: (item: TestMenuItem) => void): TestMenu {
    const item = new TestMenuItem();
    configure(item);
    this.items.push(item);
    return this;
  }

  addSeparator(): TestMenu {
    return this;
  }
}

function markdownFile(path: string): TFile {
  const TFileConstructor = TFile as unknown as new (path: string) => TFile;
  return new TFileConstructor(path);
}

function folder(path: string): TFolder {
  const TFolderConstructor = TFolder as unknown as new (path: string) => TFolder;
  return new TFolderConstructor(path);
}

function findItem(menu: TestMenu, title: string): TestMenuItem | undefined {
  return menu.items.find((item) => item.title === title);
}

describe("contextMenu", () => {
  describe("registerContextMenu()", () => {
    it("publishes the editor event's Markdown file instead of the workspace active file", () => {
      const activeFile = markdownFile("Notes/Active.md");
      const editorFile = markdownFile("Notes/Editor.md");
      const publish = jest.fn().mockResolvedValue(undefined);
      const menu = new TestMenu();
      const app = {
        commands: { executeCommandById: jest.fn() },
        workspace: { getActiveFile: jest.fn(() => activeFile) },
      } as unknown as App;

      registerContextMenu(menu as unknown as Menu, app, editorFile, publish);

      const copilotMenu = findItem(menu, "Copilot")?.submenu;
      const publishItem = findItem(
        copilotMenu!,
        COMMAND_NAMES[COMMAND_IDS.PUBLISH_FILE_TO_SYMPOSIUM]
      );
      expect(publishItem?.icon).toBe(COMMAND_ICONS[COMMAND_IDS.PUBLISH_FILE_TO_SYMPOSIUM]);

      publishItem?.click?.();

      expect(publish).toHaveBeenCalledWith(editorFile);
      expect(publish).not.toHaveBeenCalledWith(activeFile);
    });

    it.each([
      ["no active file", null],
      ["a non-Markdown file", markdownFile("Notes/Diagram.canvas")],
    ])("omits the editor action for %s", (_case, activeFile) => {
      const menu = new TestMenu();
      const app = {
        commands: { executeCommandById: jest.fn() },
        workspace: { getActiveFile: jest.fn(() => activeFile) },
      } as unknown as App;

      registerContextMenu(menu as unknown as Menu, app, activeFile, jest.fn());

      const copilotMenu = findItem(menu, "Copilot")?.submenu;
      expect(
        findItem(copilotMenu!, COMMAND_NAMES[COMMAND_IDS.PUBLISH_FILE_TO_SYMPOSIUM])
      ).toBeUndefined();
    });
  });

  describe("registerSymposiumFileMenu()", () => {
    it("registers one file-menu handler that publishes the exact clicked Markdown file", () => {
      const activeFile = markdownFile("Notes/Active.md");
      const clickedFile = markdownFile("Notes/Clicked.md");
      const eventRef = {} as EventRef;
      const publish = jest.fn().mockResolvedValue(undefined);
      let fileMenuHandler: ((menu: Menu, file: TFile) => void) | undefined;
      const on = jest.fn((eventName: string, handler: typeof fileMenuHandler) => {
        expect(eventName).toBe("file-menu");
        fileMenuHandler = handler;
        return eventRef;
      });
      const registerEvent = jest.fn();
      const host = {
        app: {
          workspace: {
            getActiveFile: jest.fn(() => activeFile),
            on,
          },
        } as unknown as App,
        registerEvent,
      };

      registerSymposiumFileMenu(host, publish);

      expect(on).toHaveBeenCalledTimes(1);
      expect(registerEvent).toHaveBeenCalledWith(eventRef);

      const menu = new TestMenu();
      fileMenuHandler?.(menu as unknown as Menu, clickedFile);
      const publishItem = findItem(menu, COMMAND_NAMES[COMMAND_IDS.PUBLISH_FILE_TO_SYMPOSIUM]);
      publishItem?.click?.();

      expect(publish).toHaveBeenCalledWith(clickedFile);
      expect(publish).not.toHaveBeenCalledWith(activeFile);
    });

    it.each([
      ["a folder", folder("Notes")],
      ["a non-Markdown file", markdownFile("Notes/Diagram.canvas")],
    ])("omits the file-menu action for %s", (_case, file) => {
      let fileMenuHandler: ((menu: Menu, file: TFile | TFolder) => void) | undefined;
      const host = {
        app: {
          workspace: {
            on: jest.fn((_eventName: string, handler: typeof fileMenuHandler) => {
              fileMenuHandler = handler;
              return {};
            }),
          },
        } as unknown as App,
        registerEvent: jest.fn(),
      };
      const menu = new TestMenu();

      registerSymposiumFileMenu(host, jest.fn());
      fileMenuHandler?.(menu as unknown as Menu, file);

      expect(menu.items).toHaveLength(0);
    });
  });
});
