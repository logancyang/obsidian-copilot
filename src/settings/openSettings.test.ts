import { consumeRequestedCopilotSettingsTab, openCopilotSettings } from "@/settings/openSettings";
import { COPILOT_SETTINGS_TAB_IDS } from "@/settings/settingsTabs";
import type { App } from "obsidian";

describe("openSettings", () => {
  afterEach(() => {
    consumeRequestedCopilotSettingsTab();
    jest.restoreAllMocks();
  });

  describe("openCopilotSettings()", () => {
    it("uses the first Copilot display without rendering the tab twice (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", () => {
      const consumedTabs: string[] = [];
      const openTabById = jest.fn(() => consumedTabs.push(consumeRequestedCopilotSettingsTab()));
      const open = jest.fn(() => consumedTabs.push(consumeRequestedCopilotSettingsTab()));
      let deferredHandoff: FrameRequestCallback | undefined;
      const ownerWindow = {
        requestAnimationFrame: jest.fn((callback: FrameRequestCallback) => {
          deferredHandoff = callback;
          return 1;
        }),
      } as unknown as Window;
      const app = { setting: { open, openTabById } } as unknown as App;

      openCopilotSettings(app, ownerWindow, "advanced");

      expect(open).toHaveBeenCalledTimes(1);
      expect(consumedTabs).toEqual(["advanced"]);

      deferredHandoff?.(0);

      expect(openTabById).not.toHaveBeenCalled();
    });

    it("hands off after another settings tab opens and schedules from the initiating window (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", () => {
      const consumedTabs: string[] = [];
      const openTabById = jest.fn(() => consumedTabs.push(consumeRequestedCopilotSettingsTab()));
      const open = jest.fn();
      let deferredHandoff: FrameRequestCallback | undefined;
      const ownerWindow = {
        requestAnimationFrame: jest.fn((callback: FrameRequestCallback) => {
          deferredHandoff = callback;
          return 1;
        }),
      } as unknown as Window;
      const app = { setting: { open, openTabById } } as unknown as App;

      openCopilotSettings(app, ownerWindow, "miyo");

      expect(open).toHaveBeenCalledTimes(1);
      expect(openTabById).not.toHaveBeenCalled();

      deferredHandoff?.(0);

      expect(openTabById).toHaveBeenCalledWith("copilot");
      expect(consumedTabs).toEqual(["miyo"]);
    });
  });

  describe("consumeRequestedCopilotSettingsTab()", () => {
    it.each(COPILOT_SETTINGS_TAB_IDS)(
      "consumes a requested %s tab once and defaults later ordinary opens to Basic (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)",
      (tab) => {
        const ownerWindow = { requestAnimationFrame: jest.fn() } as unknown as Window;
        const app = {
          setting: { open: jest.fn(), openTabById: jest.fn() },
        } as unknown as App;

        openCopilotSettings(app, ownerWindow, tab);

        expect(consumeRequestedCopilotSettingsTab()).toBe(tab);
        expect(consumeRequestedCopilotSettingsTab()).toBe("basic");
      }
    );
  });
});
