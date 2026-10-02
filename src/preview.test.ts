import type CopilotPlugin from "@/main";

type SettingsListener = () => void;
const settingsListeners = new Set<SettingsListener>();
let mockPreviewEnabled = false;
const mockDisablePreviewForSession = jest.fn(() => {
  mockPreviewEnabled = false;
});

jest.mock("@/settings/model", () => ({
  subscribeToSettingsChange: (listener: SettingsListener) => {
    settingsListeners.add(listener);
    return () => settingsListeners.delete(listener);
  },
}));

jest.mock("@/logger", () => ({ logError: jest.fn() }));

jest.mock("@/plusUtils", () => ({
  isPreviewEnabled: () => mockPreviewEnabled,
  disablePreviewForSession: () => mockDisablePreviewForSession(),
}));

import { startPreviewActivation, type PreviewEntryPoint } from "@/preview";
import { Notice } from "obsidian";

const plugin = {} as CopilotPlugin;

function switchPreview(enabled: boolean): void {
  mockPreviewEnabled = enabled;
  for (const listener of [...settingsListeners]) listener();
}

function trackedEntryPoint(events: string[], name: string): PreviewEntryPoint {
  return () => {
    events.push(`activate ${name}`);
    return () => events.push(`deactivate ${name}`);
  };
}

describe("preview", () => {
  beforeEach(() => {
    settingsListeners.clear();
    mockPreviewEnabled = false;
    mockDisablePreviewForSession.mockClear();
    (Notice as unknown as jest.Mock).mockClear();
  });

  describe("startPreviewActivation()", () => {
    it("activates nothing while Copilot runs as Official", () => {
      const events: string[] = [];

      startPreviewActivation(plugin, [trackedEntryPoint(events, "a")]);

      expect(events).toEqual([]);
    });

    it("activates every entry point at start when Preview is already on", () => {
      const events: string[] = [];
      mockPreviewEnabled = true;

      startPreviewActivation(plugin, [
        trackedEntryPoint(events, "a"),
        trackedEntryPoint(events, "b"),
      ]);

      expect(events).toEqual(["activate a", "activate b"]);
    });

    it("applies the switch live in both directions without a restart", () => {
      const events: string[] = [];
      startPreviewActivation(plugin, [
        trackedEntryPoint(events, "a"),
        trackedEntryPoint(events, "b"),
      ]);

      switchPreview(true);
      switchPreview(true);
      switchPreview(false);
      switchPreview(true);

      expect(events).toEqual([
        "activate a",
        "activate b",
        "deactivate b",
        "deactivate a",
        "activate a",
        "activate b",
      ]);
    });

    it("activates once sync() runs after the cached entitlement verifies", () => {
      const events: string[] = [];
      const activation = startPreviewActivation(plugin, [trackedEntryPoint(events, "a")]);

      mockPreviewEnabled = true;
      activation.sync();

      expect(events).toEqual(["activate a"]);
    });

    it("falls back to Official for the session and says so when activation throws (https://github.com/Brevilabs/obsidian-copilot-private/issues/626)", () => {
      const events: string[] = [];
      const failing: PreviewEntryPoint = () => {
        throw new Error("boom");
      };
      startPreviewActivation(plugin, [trackedEntryPoint(events, "a"), failing]);

      switchPreview(true);

      expect(events).toEqual(["activate a", "deactivate a"]);
      expect(mockDisablePreviewForSession).toHaveBeenCalledTimes(1);
      expect(Notice).toHaveBeenCalledWith(
        "Copilot Preview failed to start, so Copilot is running as Official until restart."
      );
    });

    it("deactivates Preview and stops following the switch once stopped", () => {
      const events: string[] = [];
      mockPreviewEnabled = true;
      const activation = startPreviewActivation(plugin, [trackedEntryPoint(events, "a")]);

      activation.stop();
      switchPreview(false);
      switchPreview(true);

      expect(events).toEqual(["activate a", "deactivate a"]);
    });
  });
});
