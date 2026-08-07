import type { CopilotSettings } from "@/settings/model";
import type { BackendDescriptor, EnabledModelEntry } from "./types";

const mockGetSettings = jest.fn<CopilotSettings, []>();
const mockSetSettings = jest.fn<void, [(cur: CopilotSettings) => Partial<CopilotSettings>]>();

jest.mock("@/settings/model", () => ({
  getSettings: () => mockGetSettings(),
  setSettings: (updater: (cur: CopilotSettings) => Partial<CopilotSettings>) =>
    mockSetSettings(updater),
}));

import { seedCopilotDefaultModel } from "./copilotDefaultModel";

const FLASH_ID = "cm-flash";

function entry(configuredModelId: string, baseModelId: string): EnabledModelEntry {
  return { configuredModelId, baseModelId, name: baseModelId, credentialState: "ok" };
}

/** A descriptor stub carrying only what the seed reads: its id and enabled entries. */
function descriptor(id: string, entries: EnabledModelEntry[] | null): BackendDescriptor {
  return {
    id,
    getEnabledModelEntries: entries === null ? undefined : () => entries,
  } as unknown as BackendDescriptor;
}

function settingsWith(backends: Record<string, unknown>): CopilotSettings {
  return { agentMode: { backends } } as unknown as CopilotSettings;
}

/** Run the captured `setSettings` updater against `current` to see what was written. */
function writtenBackends(current: CopilotSettings): Record<string, unknown> {
  const updater = mockSetSettings.mock.calls[0][0];
  const patch = updater(current) as { agentMode: { backends: Record<string, unknown> } };
  return patch.agentMode.backends;
}

describe("copilotDefaultModel", () => {
  beforeEach(() => {
    mockSetSettings.mockClear();
  });

  describe("seedCopilotDefaultModel()", () => {
    it("makes the model the default for every backend that can route it", () => {
      const current = settingsWith({});
      mockGetSettings.mockReturnValue(current);
      const descriptors = [
        descriptor("opencode", [entry(FLASH_ID, "copilot-plus/copilot-plus-flash")]),
        descriptor("pi", [entry(FLASH_ID, "copilot-plus-flash")]),
      ];

      expect(seedCopilotDefaultModel(descriptors, FLASH_ID)).toEqual(["opencode", "pi"]);
      // Each backend gets its own wire form of the same model, not the shared
      // configured-model id.
      expect(writtenBackends(current)).toEqual({
        opencode: {
          defaultModel: { baseModelId: "copilot-plus/copilot-plus-flash", effort: null },
        },
        pi: { defaultModel: { baseModelId: "copilot-plus-flash", effort: null } },
      });
    });

    it("leaves the effort unset so seeding never commits the user to a reasoning level", () => {
      const current = settingsWith({});
      mockGetSettings.mockReturnValue(current);

      seedCopilotDefaultModel(
        [descriptor("opencode", [entry(FLASH_ID, "copilot-plus/copilot-plus-flash")])],
        FLASH_ID
      );

      const written = writtenBackends(current).opencode as {
        defaultModel: { effort: string | null };
      };
      expect(written.defaultModel.effort).toBeNull();
    });

    it("skips backends that do not carry the model and those reporting no enabled set", () => {
      const current = settingsWith({});
      mockGetSettings.mockReturnValue(current);
      const descriptors = [
        descriptor("opencode", [entry(FLASH_ID, "copilot-plus/copilot-plus-flash")]),
        descriptor("claude", [entry("cm-sonnet", "claude-sonnet-4-5")]),
        descriptor("codex", null),
      ];

      expect(seedCopilotDefaultModel(descriptors, FLASH_ID)).toEqual(["opencode"]);
      expect(Object.keys(writtenBackends(current))).toEqual(["opencode"]);
    });

    it("preserves other settings in a touched slice and other backends' slices", () => {
      const current = settingsWith({
        opencode: {
          binaryPath: "/usr/bin/opencode",
          defaultModel: { baseModelId: "old", effort: "high" },
        },
        claude: { defaultModel: { baseModelId: "claude-sonnet-4-5", effort: null } },
      });
      mockGetSettings.mockReturnValue(current);
      const descriptors = [
        descriptor("opencode", [entry(FLASH_ID, "copilot-plus/copilot-plus-flash")]),
        descriptor("claude", [entry("cm-sonnet", "claude-sonnet-4-5")]),
      ];

      seedCopilotDefaultModel(descriptors, FLASH_ID);

      expect(writtenBackends(current)).toEqual({
        opencode: {
          binaryPath: "/usr/bin/opencode",
          defaultModel: { baseModelId: "copilot-plus/copilot-plus-flash", effort: null },
        },
        claude: { defaultModel: { baseModelId: "claude-sonnet-4-5", effort: null } },
      });
    });

    it("writes nothing when no backend can route the model", () => {
      mockGetSettings.mockReturnValue(settingsWith({}));

      const seeded = seedCopilotDefaultModel(
        [descriptor("claude", [entry("cm-sonnet", "claude-sonnet-4-5")])],
        FLASH_ID
      );

      expect(seeded).toEqual([]);
      expect(mockSetSettings).not.toHaveBeenCalled();
    });

    it("writes once for all backends so a live session re-applies the default a single time", () => {
      mockGetSettings.mockReturnValue(settingsWith({}));
      const descriptors = [
        descriptor("opencode", [entry(FLASH_ID, "copilot-plus/copilot-plus-flash")]),
        descriptor("pi", [entry(FLASH_ID, "copilot-plus-flash")]),
      ];

      seedCopilotDefaultModel(descriptors, FLASH_ID);

      expect(mockSetSettings).toHaveBeenCalledTimes(1);
    });
  });
});
