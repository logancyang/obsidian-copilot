import * as contextMenuModule from "@/commands/contextMenu";
import { registerContextMenu } from "@/commands/contextMenu";
import { COMMAND_IDS, COMMAND_NAMES } from "@/constants";
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

function findItem(menu: TestMenu, title: string): TestMenuItem | undefined {
  return menu.items.find((item) => item.title === title);
}

describe("contextMenu", () => {
  describe("registerContextMenu()", () => {
    it("omits publishing from the editor context submenu", () => {
      const menu = new TestMenu();
      const app = {
        commands: { executeCommandById: jest.fn() },
      } as unknown as App;

      registerContextMenu(menu as unknown as Menu, app);

      const copilotMenu = findItem(menu, "Copilot")?.submenu;
      expect(
        findItem(copilotMenu!, COMMAND_NAMES[COMMAND_IDS.PUBLISH_FILE_TO_OPENARTIFACTS])
      ).toBeUndefined();
    });

    it("does not expose a file-menu publishing registration", () => {
      expect(contextMenuModule).not.toHaveProperty("registerOpenArtifactsFileMenu");
    });
  });
});
