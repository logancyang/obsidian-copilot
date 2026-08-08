import { createPluginRoot } from "@/utils/react/createPluginRoot";
import { CopilotSettingTab } from "@/settings/SettingsPage";
import type { App, Setting } from "obsidian";

jest.mock("@/components/CopilotView", () => ({ __esModule: true, default: class CopilotView {} }));
jest.mock("@/main", () => ({ __esModule: true, default: class CopilotPlugin {} }));
jest.mock("@/settings/model", () => ({ getSettings: jest.fn() }));
jest.mock("@/logger", () => ({ logInfo: jest.fn(), logError: jest.fn() }));
jest.mock("@/settings/v2/SettingsMainV2", () => ({ __esModule: true, default: () => null }));
jest.mock("@/utils/react/createPluginRoot", () => ({ createPluginRoot: jest.fn() }));
jest.mock("obsidian", () => ({
  App: class App {},
  Notice: class Notice {},
  PluginSettingTab: class PluginSettingTab {
    app: unknown;
    containerEl: HTMLElement;
    plugin: unknown;

    constructor(app: unknown, plugin: unknown) {
      this.app = app;
      this.plugin = plugin;
      this.containerEl = window.document.body.createDiv();
      this.containerEl.addClass = (...classes: string[]) => {
        this.containerEl.classList.add(...classes);
      };
      this.containerEl.empty = () => this.containerEl.replaceChildren();
    }
  },
}));

function createSettingsContainer(): HTMLDivElement {
  const element = window.document.body.createDiv();
  element.addClass = (...classes: string[]) => {
    element.classList.add(...classes);
  };
  element.empty = () => element.replaceChildren();
  return element;
}

describe("SettingsPage", () => {
  describe("CopilotSettingTab", () => {
    const app = {} as App;
    const render = jest.fn();
    const unmount = jest.fn();

    beforeEach(() => {
      jest.clearAllMocks();
      jest.mocked(createPluginRoot).mockReturnValue({ render, unmount });
    });

    describe("getSettingDefinitions()", () => {
      it("exposes searchable aliases and mounts the existing settings surface", () => {
        const tab = new CopilotSettingTab(app, {} as never);
        const [definition] = tab.getSettingDefinitions();
        const settingEl = createSettingsContainer();

        const cleanup = definition.render({ settingEl } as unknown as Setting);

        expect(definition.name).toBe("Copilot settings");
        expect(definition.aliases).toEqual(
          expect.arrayContaining(["Basic settings", "Miyo semantic search", "Agent skills"])
        );
        expect(settingEl.classList.contains("copilot-settings-definition")).toBe(true);
        expect(createPluginRoot).toHaveBeenCalledWith(settingEl.firstElementChild, app);
        expect(render).toHaveBeenCalledTimes(1);

        expect(cleanup).toEqual(expect.any(Function));
        if (cleanup) {
          cleanup();
        }
        expect(unmount).toHaveBeenCalledTimes(1);
      });
    });

    describe("display()", () => {
      it("replaces stale content and mounts the settings surface in the legacy container", () => {
        const tab = new CopilotSettingTab(app, {} as never);
        tab.containerEl.append(window.document.body.createSpan());

        tab.display();

        expect(tab.containerEl.classList.contains("tw-select-text")).toBe(true);
        expect(tab.containerEl.querySelector("span")).toBeNull();
        expect(createPluginRoot).toHaveBeenCalledWith(tab.containerEl.firstElementChild, app);
        expect(render).toHaveBeenCalledTimes(1);
      });
    });
  });
});
