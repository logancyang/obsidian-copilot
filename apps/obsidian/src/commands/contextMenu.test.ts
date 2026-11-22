import { registerContextMenu } from "@/commands/contextMenu";
import { getCachedCustomCommands } from "@/commands/state";
import type { CustomCommand } from "@/commands/type";
import { COMMAND_IDS } from "@/constants";
import type { App, Menu } from "obsidian";

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

function customCommand(title: string, order: number, showInContextMenu: boolean): CustomCommand {
  return {
    title,
    content: "",
    modelKey: "",
    showInContextMenu,
    showInSlashMenu: false,
    order,
    lastUsedMs: 0,
  };
}

function findItem(menu: TestMenu, title: string): TestMenuItem | undefined {
  return menu.items.find((item) => item.title === title);
}

describe("contextMenu", () => {
  describe("registerContextMenu()", () => {
    it("lists Quick Ask, the quick command trigger, then custom commands marked for the context menu by order", () => {
      jest
        .mocked(getCachedCustomCommands)
        .mockReturnValue([
          customCommand("Second", 2, true),
          customCommand("Hidden", 0, false),
          customCommand("First", 1, true),
        ]);
      const menu = new TestMenu();
      const app = {
        commands: { executeCommandById: jest.fn() },
      } as unknown as App;

      registerContextMenu(menu as unknown as Menu, app);

      const copilotMenu = findItem(menu, "Copilot")?.submenu;
      expect(copilotMenu?.items.map((item) => item.title)).toEqual([
        "Quick Ask",
        "Trigger quick command",
        "First",
        "Second",
      ]);
    });

    it("executes the Copilot command behind the clicked submenu item", () => {
      jest.mocked(getCachedCustomCommands).mockReturnValue([]);
      const executeCommandById = jest.fn();
      const menu = new TestMenu();

      registerContextMenu(
        menu as unknown as Menu,
        { commands: { executeCommandById } } as unknown as App
      );

      findItem(findItem(menu, "Copilot")!.submenu!, "Quick Ask")?.click?.();
      expect(executeCommandById).toHaveBeenCalledWith(`copilot:${COMMAND_IDS.TRIGGER_QUICK_ASK}`);
    });
  });
});
