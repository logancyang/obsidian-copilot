import type { App, Setting } from "obsidian";
import type CopilotPlugin from "@/main";
import { CopilotSettingTab, type CopilotSettingDefinition } from "@/settings/SettingsPage";
import { settingsSearchAnchor } from "@/lib/settingsSearchAnchor";
import {
  SETTINGS_SEARCH_MANIFEST,
  subscribeSettingsDeepLink,
  type SettingsDeepLink,
} from "@/settings/v2/settingsSearch";

// The tab under test only touches the declarative-definition surface; the
// React app and plugin runtime behind `display()` stay out of scope here.
jest.mock("@/settings/v2/SettingsMainV2", () => ({ __esModule: true, default: () => null }));
jest.mock("@/components/CopilotView", () => ({ __esModule: true, default: class {} }));
jest.mock("@/settings/model", () => ({ getSettings: jest.fn() }));

function createTab(): CopilotSettingTab {
  return new CopilotSettingTab({} as App, {} as CopilotPlugin);
}

function createFakeSetting(): { setting: Setting; settingEl: HTMLElement } {
  const settingEl = window.document.createElement("div");
  return { setting: { settingEl } as unknown as Setting, settingEl };
}

describe("SettingsPage", () => {
  afterEach(() => {
    subscribeSettingsDeepLink(() => {})();
  });

  describe("CopilotSettingTab", () => {
    describe("getSettingDefinitions()", () => {
      it("returns the React app host first, excluded from search", () => {
        const definitions = createTab().getSettingDefinitions();

        expect(definitions[0].searchable).toBe(false);
        expect(typeof definitions[0].render).toBe("function");
      });

      it("returns one searchable marker per manifest entry, carrying name, desc, and aliases", () => {
        const markers = createTab().getSettingDefinitions().slice(1);

        expect(markers.map((definition) => definition.name)).toEqual(
          SETTINGS_SEARCH_MANIFEST.map((entry) => entry.name)
        );
        for (const [index, marker] of markers.entries()) {
          const entry = SETTINGS_SEARCH_MANIFEST[index];
          expect(marker.desc).toBe(entry.desc);
          expect(marker.aliases).toEqual(entry.aliases ? [...entry.aliases] : undefined);
          expect(marker.searchable).toBeUndefined();
        }
      });

      it("hides a marker's row when Obsidian renders it", () => {
        const marker = createTab().getSettingDefinitions()[1];
        const { setting, settingEl } = createFakeSetting();

        const cleanup = marker.render(setting);

        expect(settingEl.classList.contains("copilot-setting-search-marker")).toBe(true);
        expect(cleanup).toBeUndefined();
      });
    });

    describe("getElementForDefinition()", () => {
      it("routes a marker definition into a tab + anchor deep link and lets Obsidian skip its own scroll", () => {
        const tab = createTab();
        const markers = tab.getSettingDefinitions().slice(1);
        const target = markers[markers.length - 1];
        const entry = SETTINGS_SEARCH_MANIFEST[SETTINGS_SEARCH_MANIFEST.length - 1];
        const received: SettingsDeepLink[] = [];
        const unsubscribe = subscribeSettingsDeepLink((link) => received.push(link));

        const element = tab.getElementForDefinition(target);

        expect(element).toBeUndefined();
        expect(received).toEqual([
          { tabId: entry.tabId, anchor: settingsSearchAnchor(entry.name) },
        ]);
        unsubscribe();
      });

      it("ignores definitions it did not produce", () => {
        const tab = createTab();
        tab.getSettingDefinitions();
        const foreign: CopilotSettingDefinition = { name: "Foreign", render: () => {} };
        const received: SettingsDeepLink[] = [];
        const unsubscribe = subscribeSettingsDeepLink((link) => received.push(link));

        expect(tab.getElementForDefinition(foreign)).toBeUndefined();
        expect(received).toEqual([]);
        unsubscribe();
      });
    });
  });
});
