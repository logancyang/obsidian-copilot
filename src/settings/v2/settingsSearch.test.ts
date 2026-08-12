import { settingsSearchAnchor } from "@/lib/settingsSearchAnchor";
import {
  requestSettingsDeepLink,
  SETTINGS_SEARCH_MANIFEST,
  SETTINGS_TAB_IDS,
  subscribeSettingsDeepLink,
  type SettingsDeepLink,
} from "@/settings/v2/settingsSearch";

describe("settingsSearch", () => {
  // The deep-link channel is module-level state; drain any buffered link so
  // one test's leftovers never leak into the next.
  afterEach(() => {
    subscribeSettingsDeepLink(() => {})();
  });

  describe("SETTINGS_SEARCH_MANIFEST", () => {
    it("references only valid tab ids", () => {
      for (const entry of SETTINGS_SEARCH_MANIFEST) {
        expect(SETTINGS_TAB_IDS).toContain(entry.tabId);
      }
    });

    it("covers every settings tab with at least one entry", () => {
      const coveredTabs = new Set(SETTINGS_SEARCH_MANIFEST.map((entry) => entry.tabId));
      expect([...SETTINGS_TAB_IDS].sort()).toEqual([...coveredTabs].sort());
    });

    it("gives every entry a globally unique name and anchor", () => {
      const names = SETTINGS_SEARCH_MANIFEST.map((entry) => entry.name);
      const anchors = SETTINGS_SEARCH_MANIFEST.map((entry) => settingsSearchAnchor(entry.name));
      expect(new Set(names).size).toBe(names.length);
      expect(new Set(anchors).size).toBe(anchors.length);
    });

    it("gives every entry a non-empty name, description, and anchor", () => {
      for (const entry of SETTINGS_SEARCH_MANIFEST) {
        expect(entry.name).not.toBe("");
        expect(entry.desc).not.toBe("");
        expect(settingsSearchAnchor(entry.name)).not.toBe("");
      }
    });
  });

  describe("requestSettingsDeepLink()", () => {
    it("delivers the link immediately to the current subscriber", () => {
      const received: SettingsDeepLink[] = [];
      const unsubscribe = subscribeSettingsDeepLink((link) => received.push(link));

      requestSettingsDeepLink({ tabId: "advanced", anchor: "debug-mode" });

      expect(received).toEqual([{ tabId: "advanced", anchor: "debug-mode" }]);
      unsubscribe();
    });

    it("buffers the link while no subscriber exists and flushes it to the next one", () => {
      requestSettingsDeepLink({ tabId: "miyo", anchor: "semantic-search" });

      const received: SettingsDeepLink[] = [];
      const unsubscribe = subscribeSettingsDeepLink((link) => received.push(link));

      expect(received).toEqual([{ tabId: "miyo", anchor: "semantic-search" }]);
      unsubscribe();
    });
  });

  describe("subscribeSettingsDeepLink()", () => {
    it("stops delivering after unsubscribe", () => {
      const received: SettingsDeepLink[] = [];
      subscribeSettingsDeepLink((link) => received.push(link))();

      requestSettingsDeepLink({ tabId: "basic", anchor: "send-shortcut" });

      expect(received).toEqual([]);
    });

    it("keeps a newer subscriber registered when a stale unsubscribe runs", () => {
      const stale = subscribeSettingsDeepLink(() => {});
      const received: SettingsDeepLink[] = [];
      const unsubscribe = subscribeSettingsDeepLink((link) => received.push(link));
      stale();

      requestSettingsDeepLink({ tabId: "byok", anchor: "bring-your-own-key" });

      expect(received).toEqual([{ tabId: "byok", anchor: "bring-your-own-key" }]);
      unsubscribe();
    });
  });
});
