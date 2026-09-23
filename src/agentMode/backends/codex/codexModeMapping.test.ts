import { translateBackendState } from "@/agentMode/session/translateBackendState";
import type {
  BackendConfigOption,
  BackendDescriptor,
  RawModeState,
} from "@/agentMode/session/types";
import { buildCodexModeMapping, buildCodexModeState } from "./codexModeMapping";

function modes(currentModeId: string, ids: string[]): RawModeState {
  return {
    currentModeId,
    availableModes: ids.map((id) => ({ id, name: id })),
  };
}

function collaboration(value: "default" | "plan"): BackendConfigOption {
  return {
    id: "collaboration_mode",
    category: "collaboration_mode",
    type: "select",
    currentValue: value,
    options: [
      { value: "default", name: "Default" },
      { value: "plan", name: "Plan" },
    ],
  };
}

const availableModes = ["read-only", "agent", "agent-full-access"];

describe("codexModeMapping", () => {
  describe("buildCodexModeMapping()", () => {
    it("maps the adapter's approval presets and keeps its fan-out mode", () => {
      const modeState = modes("agent", availableModes);
      const mapping = buildCodexModeMapping(modeState);

      expect(mapping.canonical).toEqual({
        default: "agent",
        auto: "agent-full-access",
      });
      expect(mapping.readOnlyModeId).toBe("read-only");
    });

    it("https://github.com/logancyang/obsidian-copilot/issues/2916 omits the separate Zed adapter's legacy ids", () => {
      const mapping = buildCodexModeMapping(modes("auto", ["read-only", "auto", "full-access"]));

      expect(mapping.canonical).toEqual({
        default: undefined,
        auto: undefined,
      });
    });

    it("omits approval presets that the adapter does not advertise", () => {
      const mapping = buildCodexModeMapping(modes("custom", ["custom"]));

      expect(mapping.canonical).toEqual({
        default: undefined,
        auto: undefined,
      });
      expect(mapping.readOnlyModeId).toBeNull();
    });

    it("retains the inventory-free fan-out mode until the adapter reports modes", () => {
      expect(buildCodexModeMapping(null)).toEqual({
        kind: "setMode",
        canonical: {},
        readOnlyModeId: "read-only",
      });
    });
  });

  describe("buildCodexModeState()", () => {
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/551 offers Safe, real Plan, and Auto from separate adapter controls", () => {
      const state = translateBackendState(
        {
          models: null,
          modes: modes("agent", availableModes),
          configOptions: [collaboration("default")],
        },
        {
          getModeMapping: buildCodexModeMapping,
          getModeState: buildCodexModeState,
        } as unknown as BackendDescriptor
      );

      expect(state.mode).toEqual({
        current: "default",
        options: [
          { value: "default", label: "Default" },
          { value: "plan", label: "Plan" },
          { value: "auto", label: "Auto" },
        ],
        apply: {
          default: {
            kind: "sequence",
            steps: [
              { kind: "setMode", nativeId: "agent" },
              { kind: "setConfigOption", configId: "collaboration_mode", value: "default" },
            ],
          },
          plan: {
            kind: "sequence",
            steps: [
              { kind: "setMode", nativeId: "agent" },
              { kind: "setConfigOption", configId: "collaboration_mode", value: "plan" },
            ],
          },
          auto: {
            kind: "sequence",
            steps: [
              { kind: "setConfigOption", configId: "collaboration_mode", value: "default" },
              { kind: "setMode", nativeId: "agent-full-access" },
            ],
          },
        },
      });
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/551 shows Plan until the adapter returns to Default after approval", () => {
      const modeState = modes("agent", availableModes);

      expect(buildCodexModeState(modeState, [collaboration("plan")])?.current).toBe("plan");
      expect(buildCodexModeState(modeState, [collaboration("default")])?.current).toBe("default");
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/551 uses Safe for an older read-only session outside collaboration Plan", () => {
      const state = buildCodexModeState(modes("read-only", availableModes), [
        collaboration("default"),
      ]);

      expect(state?.current).toBe("default");
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/551 keeps approval choices while hiding Plan if collaboration mode is absent", () => {
      const state = buildCodexModeState(modes("agent-full-access", availableModes), null);

      expect(state?.current).toBe("auto");
      expect(state?.options).toEqual([
        { value: "default", label: "Default" },
        { value: "auto", label: "Auto" },
      ]);
      expect(state?.apply.plan).toBeUndefined();
    });

    it("returns no picker when the adapter advertises no supported approval presets", () => {
      expect(
        buildCodexModeState(modes("custom", ["custom"]), [collaboration("default")])
      ).toBeNull();
    });
  });
});
