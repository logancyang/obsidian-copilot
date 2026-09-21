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

/**
 * A descriptor stub carrying only what the seed reads: its id and its wire id
 * for the model. `wireBaseId: null` is a backend that cannot route the model;
 * `undefined` is one that does not implement the lookup at all (claude, codex).
 */
function descriptor(id: string, wireBaseId: string | null | undefined): BackendDescriptor {
  return {
    id,
    getWireBaseId: wireBaseId === undefined ? undefined : () => wireBaseId,
  } as unknown as BackendDescriptor;
}

function settingsWith(backends: Record<string, unknown>): CopilotSettings {
  return { backends } as unknown as CopilotSettings;
}

/** Run the captured `setSettings` updater against `current` to see what was written. */
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
      // Every backend records the same configured-model id; each translates it
      // to its own wire form when it starts a session.
      expect(writtenBackends(current)).toEqual({
        opencode: { enabledModels: [], default: { configuredModelId: FLASH_ID, effort: null } },
        pi: { enabledModels: [], default: { configuredModelId: FLASH_ID, effort: null } },
      });
    });

    it("leaves the effort unset so seeding never commits the user to a reasoning level", () => {
      const current = settingsWith({});
      mockGetSettings.mockReturnValue(current);

      seedCopilotDefaultModel(
        [descriptor("opencode", "copilot-plus/copilot-plus-flash")],
        FLASH_ID
      );

      const written = writtenBackends(current).opencode as {
        default: { effort: string | null };
      };
      expect(written.default.effort).toBeNull();
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

    // The stubs above fix the join's contract; this pins the real wiring the
    // registry entry point depends on. Note the absent `backends.opencode`
    // slice: provider sync configures a model before enrolling it anywhere, so
    // seeding must work from the model alone — an enrollment-based lookup would
    // skip OpenCode for anyone who confirmed before sync finished.
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
