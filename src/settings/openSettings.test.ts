import { consumeRequestedCopilotSettingsTab, openMiyoSettings } from "@/settings/openSettings";
import type { App } from "obsidian";

describe("openSettings", () => {
  afterEach(() => {
    consumeRequestedCopilotSettingsTab();
    jest.restoreAllMocks();
  });

  describe("openMiyoSettings()", () => {
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

      openMiyoSettings(app, ownerWindow);

      expect(open).toHaveBeenCalledTimes(1);
      expect(consumedTabs).toEqual(["miyo"]);

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

      openMiyoSettings(app, ownerWindow);

      expect(open).toHaveBeenCalledTimes(1);
      expect(openTabById).not.toHaveBeenCalled();

      deferredHandoff?.(0);

      expect(openTabById).toHaveBeenCalledWith("copilot");
      expect(consumedTabs).toEqual(["miyo"]);
    });
  });

  describe("consumeRequestedCopilotSettingsTab()", () => {
    it("consumes a requested tab once and defaults later ordinary opens to Basic (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", () => {
      const ownerWindow = { requestAnimationFrame: jest.fn() } as unknown as Window;
      const app = {
        setting: { open: jest.fn(), openTabById: jest.fn() },
      } as unknown as App;

      openMiyoSettings(app, ownerWindow);
      expect(consumeRequestedCopilotSettingsTab()).toBe("miyo");
      expect(consumeRequestedCopilotSettingsTab()).toBe("basic");
    });
  });
});
