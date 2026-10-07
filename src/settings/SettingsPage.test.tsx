import { STARTUP_LOADING_TEXT } from "@/components/StartupLoadingView";
import { CopilotSettingTab } from "@/settings/SettingsPage";
import type CopilotPlugin from "@/main";
import { createPluginRoot } from "@/utils/react/createPluginRoot";
import type { App } from "obsidian";

jest.mock("obsidian", () => ({
  ...jest.requireActual<object>("obsidian"),
  PluginSettingTab: class PluginSettingTab {
    containerEl = Object.assign(document.createElement("div"), {
      empty(this: HTMLElement) {
        this.replaceChildren();
      },
    });
  },
}));
jest.mock("@/settings/v2/SettingsMainV2", () => ({ __esModule: true, default: () => null }));
jest.mock("@/utils/react/createPluginRoot", () => ({
  createPluginRoot: jest.fn(() => ({ render: jest.fn() })),
}));

function createTab(started: boolean) {
  let isStarted = started;
  let finishStartup: () => void = () => undefined;
  const startup = new Promise<void>((resolve) => (finishStartup = resolve));
  const plugin = {
    isStarted: () => isStarted,
    whenStarted: () => startup,
  } as unknown as CopilotPlugin;
  const tab = new CopilotSettingTab({} as App, plugin);
  const start = async () => {
    isStarted = true;
    finishStartup();
    await startup;
  };
  return { tab, start };
}

describe("SettingsPage", () => {
  describe("CopilotSettingTab", () => {
    beforeEach(() => {
      jest.mocked(createPluginRoot).mockClear();
      document.body.replaceChildren();
    });

    describe("getSettingDefinitions()", () => {
      it("returns no declarative definitions so Obsidian keeps rendering the tab through display()", () => {
        const tab = new CopilotSettingTab({} as App, {} as CopilotPlugin);

        expect(tab.getSettingDefinitions()).toEqual([]);
      });
    });

    describe("display()", () => {
      it("renders the settings right away once Copilot has started", () => {
        const { tab } = createTab(true);

        tab.display();

        expect(createPluginRoot).toHaveBeenCalledTimes(1);
      });

      it("shows that Copilot is starting instead of settings that have not loaded yet https://github.com/logancyang/obsidian-copilot/issues/3518", () => {
        const { tab } = createTab(false);

        tab.display();

        expect(tab.containerEl.textContent).toBe(STARTUP_LOADING_TEXT);
        expect(createPluginRoot).not.toHaveBeenCalled();
      });

      it("renders the settings once Copilot finishes starting while the tab is still open https://github.com/logancyang/obsidian-copilot/issues/3518", async () => {
        const { tab, start } = createTab(false);
        document.body.append(tab.containerEl);

        tab.display();
        await start();

        expect(tab.containerEl.textContent).not.toContain(STARTUP_LOADING_TEXT);
        expect(createPluginRoot).toHaveBeenCalledTimes(1);
      });

      it("does not render settings into a tab closed before Copilot finished starting https://github.com/logancyang/obsidian-copilot/issues/3518", async () => {
        const { tab, start } = createTab(false);

        tab.display();
        await start();

        expect(createPluginRoot).not.toHaveBeenCalled();
      });
    });
  });
});
