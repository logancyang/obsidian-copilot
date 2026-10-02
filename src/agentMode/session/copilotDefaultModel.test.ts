import type { CopilotSettings } from "@/settings/model";
import type { BackendDescriptor } from "./types";

const mockGetSettings = jest.fn<CopilotSettings, []>();
const mockSetSettings = jest.fn<void, [(cur: CopilotSettings) => Partial<CopilotSettings>]>();

jest.mock("@/settings/model", () => ({
  getSettings: () => mockGetSettings(),
  setSettings: (updater: (cur: CopilotSettings) => Partial<CopilotSettings>) =>
    mockSetSettings(updater),
}));

import { OpencodeBackendDescriptor } from "@/agentMode/backends/opencode/descriptor";
import { seedCopilotDefaultModel } from "./copilotDefaultModel";

const FLASH_ID = "cm-flash";

function descriptor(id: string, wireBaseId: string | null | undefined): BackendDescriptor {
  return {
    id,
    getWireBaseId: wireBaseId === undefined ? undefined : () => wireBaseId,
  } as unknown as BackendDescriptor;
}

function settingsWith(backends: Record<string, unknown>): CopilotSettings {
  return { backends } as unknown as CopilotSettings;
}

function writtenBackends(current: CopilotSettings): Record<string, unknown> {
  const updater = mockSetSettings.mock.calls[0][0];
  const patch = updater(current) as { backends: Record<string, unknown> };
  return patch.backends;
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
        descriptor("opencode", "copilot-plus/copilot-plus-flash"),
        descriptor("pi", "copilot-plus-flash"),
      ];

      expect(seedCopilotDefaultModel(descriptors, FLASH_ID)).toEqual(["opencode", "pi"]);
      expect(writtenBackends(current)).toEqual({
        opencode: { enabledModels: [], default: { configuredModelId: FLASH_ID, effort: null } },
        pi: { enabledModels: [], default: { configuredModelId: FLASH_ID, effort: null } },
      });
    });

    it("skips a backend that cannot route the model and one that does not answer at all", () => {
      const current = settingsWith({});
      mockGetSettings.mockReturnValue(current);
      const descriptors = [
        descriptor("opencode", "copilot-plus/copilot-plus-flash"),
        descriptor("claude", null),
        descriptor("codex", undefined),
      ];

      expect(seedCopilotDefaultModel(descriptors, FLASH_ID)).toEqual(["opencode"]);
      expect(Object.keys(writtenBackends(current))).toEqual(["opencode"]);
    });

    it("keeps the touched backend's enabled list and other backends' slices", () => {
      const current = settingsWith({
        opencode: { enabledModels: ["cm-a", "cm-b"], default: { configuredModelId: "cm-a" } },
        claude: { enabledModels: ["cm-c"], default: { configuredModelId: "cm-c" } },
      });
      mockGetSettings.mockReturnValue(current);
      const descriptors = [
        descriptor("opencode", "copilot-plus/copilot-plus-flash"),
        descriptor("claude", null),
      ];

      seedCopilotDefaultModel(descriptors, FLASH_ID);

      expect(writtenBackends(current)).toEqual({
        opencode: {
          enabledModels: ["cm-a", "cm-b"],
          default: { configuredModelId: FLASH_ID, effort: null },
        },
        claude: { enabledModels: ["cm-c"], default: { configuredModelId: "cm-c" } },
      });
    });

    it("writes nothing when no backend can route the model", () => {
      mockGetSettings.mockReturnValue(settingsWith({}));

      const seeded = seedCopilotDefaultModel([descriptor("claude", null)], FLASH_ID);

      expect(seeded).toEqual([]);
      expect(mockSetSettings).not.toHaveBeenCalled();
    });

    it("writes once for all backends so a live session re-applies the default a single time", () => {
      mockGetSettings.mockReturnValue(settingsWith({}));
      const descriptors = [
        descriptor("opencode", "copilot-plus/copilot-plus-flash"),
        descriptor("pi", "copilot-plus-flash"),
      ];

      seedCopilotDefaultModel(descriptors, FLASH_ID);

      expect(mockSetSettings).toHaveBeenCalledTimes(1);
    });

    it("seeds the real OpenCode descriptor from a model that is configured but not yet enrolled", () => {
      const settings = {
        configuredModels: [
          {
            configuredModelId: FLASH_ID,
            providerId: "plus-1",
            info: { id: "copilot-plus-flash", displayName: "Copilot Plus Flash" },
            configuredAt: 0,
          },
        ],
        providers: {
          "plus-1": {
            providerId: "plus-1",
            providerType: "openai-compatible",
            displayName: "Copilot",
            origin: { kind: "copilot-plus" },
            addedAt: 0,
          },
        },
        backends: {},
        enableSelfHostMode: false,
      } as unknown as CopilotSettings;
      mockGetSettings.mockReturnValue(settings);

      const seeded = seedCopilotDefaultModel([OpencodeBackendDescriptor], FLASH_ID);

      expect(seeded).toEqual(["opencode"]);
      expect(writtenBackends(settings)).toEqual({
        opencode: { enabledModels: [], default: { configuredModelId: FLASH_ID, effort: null } },
      });
    });
  });
});
