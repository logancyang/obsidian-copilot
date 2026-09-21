import type { CopilotSettings } from "@/settings/model";

import type { BackendDescriptor } from "./types";
import {
  findConfiguredModelId,
  readBackendDefault,
  readStoredDefault,
} from "./backendDefaultModel";

/**
 * An agent-native backend: it serves only its own models, so the id it uses on
 * the wire is the model's own id, produced by its codec.
 */
function nativeDescriptor(): BackendDescriptor {
  return {
    id: "claude",
    wire: {
      encode: (selection: { baseModelId: string }) => selection.baseModelId,
      decode: (wireId: string) => ({
        selection: { baseModelId: wireId, effort: null },
        provider: null,
      }),
    },
  } as unknown as BackendDescriptor;
}

/**
 * A backend that routes Copilot-side providers: it owns the whole mapping, so
 * it answers `getWireBaseId` and its ids carry a provider prefix.
 */
function routingDescriptor(): BackendDescriptor {
  return {
    id: "opencode",
    wire: nativeDescriptor().wire,
    getWireBaseId: (configuredModelId: string, settings: CopilotSettings) => {
      const model = settings.configuredModels.find(
        (row) => row.configuredModelId === configuredModelId
      );
      return model ? `anthropic/${model.info.id}` : null;
    },
  } as unknown as BackendDescriptor;
}

function settingsWith(backends: Record<string, unknown>): CopilotSettings {
  return {
    configuredModels: [
      {
        configuredModelId: "cm-sonnet",
        providerId: "p1",
        info: { id: "claude-sonnet-4-5", displayName: "Sonnet" },
        configuredAt: 0,
      },
      {
        configuredModelId: "cm-opus",
        providerId: "p1",
        info: { id: "claude-opus-4-5", displayName: "Opus" },
        configuredAt: 0,
      },
    ],
    backends,
  } as unknown as CopilotSettings;
}

describe("backendDefaultModel", () => {
  describe("readStoredDefault()", () => {
    it("returns the stored record untranslated", () => {
      const settings = settingsWith({
        claude: { enabledModels: [], default: { configuredModelId: "cm-sonnet", effort: "high" } },
      });

      expect(readStoredDefault(settings, "claude")).toEqual({
        configuredModelId: "cm-sonnet",
        effort: "high",
      });
    });

    it("returns undefined for a backend with no stored default", () => {
      expect(
        readStoredDefault(settingsWith({ claude: { enabledModels: [] } }), "claude")
      ).toBeUndefined();
    });
  });

  describe("readBackendDefault()", () => {
    it("returns the stored default in wire form with its effort", () => {
      const settings = settingsWith({
        claude: {
          enabledModels: ["cm-sonnet"],
          default: { configuredModelId: "cm-sonnet", effort: "high" },
        },
      });

      expect(readBackendDefault(nativeDescriptor(), settings)).toEqual({
        baseModelId: "claude-sonnet-4-5",
        effort: "high",
      });
    });

    it("keeps returning a default whose model the user turned off", () => {
      const settings = settingsWith({
        claude: { enabledModels: ["cm-sonnet"], default: { configuredModelId: "cm-opus" } },
      });

      expect(readBackendDefault(nativeDescriptor(), settings)).toEqual({
        baseModelId: "claude-opus-4-5",
        effort: null,
      });
    });

    it("defers to a routing backend's own mapping, prefix included", () => {
      const settings = settingsWith({
        opencode: { enabledModels: ["cm-sonnet"], default: { configuredModelId: "cm-sonnet" } },
      });

      expect(readBackendDefault(routingDescriptor(), settings)).toEqual({
        baseModelId: "anthropic/claude-sonnet-4-5",
        effort: null,
      });
    });

    it("returns null when nothing is stored", () => {
      expect(readBackendDefault(nativeDescriptor(), settingsWith({}))).toBeNull();
    });

    it("returns null when the stored row no longer exists", () => {
      const settings = settingsWith({
        claude: { enabledModels: [], default: { configuredModelId: "cm-deleted" } },
      });

      expect(readBackendDefault(nativeDescriptor(), settings)).toBeNull();
    });
  });

  describe("findConfiguredModelId()", () => {
    it("finds the enabled model a wire id names", () => {
      const settings = settingsWith({ claude: { enabledModels: ["cm-sonnet", "cm-opus"] } });

      expect(findConfiguredModelId(nativeDescriptor(), "claude-opus-4-5", settings)).toBe(
        "cm-opus"
      );
    });

    it("keeps the stored row when re-writing a default the user has since turned off", () => {
      // The settings picker leaves a turned-off default selectable so its effort
      // can be changed and so it can be cleared; that write must not lose it.
      const settings = settingsWith({
        claude: { enabledModels: ["cm-sonnet"], default: { configuredModelId: "cm-opus" } },
      });

      expect(findConfiguredModelId(nativeDescriptor(), "claude-opus-4-5", settings)).toBe(
        "cm-opus"
      );
    });

    it("returns null for a wire id no model on this backend produces", () => {
      const settings = settingsWith({ claude: { enabledModels: ["cm-sonnet"] } });

      expect(findConfiguredModelId(nativeDescriptor(), "some-other-model", settings)).toBeNull();
    });
  });
});
