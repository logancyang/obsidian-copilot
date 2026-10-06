import { CopilotSettingTab } from "@/settings/SettingsPage";
import type CopilotPlugin from "@/main";
import type { App } from "obsidian";

jest.mock("obsidian", () => ({
  ...jest.requireActual<object>("obsidian"),
  PluginSettingTab: class PluginSettingTab {},
}));
jest.mock("@/settings/v2/SettingsMainV2", () => ({ __esModule: true, default: () => null }));

describe("SettingsPage", () => {
  describe("CopilotSettingTab", () => {
    describe("getSettingDefinitions()", () => {
      it("returns no declarative definitions so Obsidian keeps rendering the tab through display()", () => {
        const tab = new CopilotSettingTab({} as App, {} as CopilotPlugin);

        expect(tab.getSettingDefinitions()).toEqual([]);
      });
    });
  });
});
