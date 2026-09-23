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
    it("https://github.com/logancyang/obsidian-copilot/issues/2916 names only the inventory-free fan-out preset", () => {
      expect(buildCodexModeMapping()).toEqual({
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
          modes: modes("read-only", availableModes),
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
              { kind: "setMode", nativeId: "read-only" },
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
              { kind: "setMode", nativeId: "agent" },
            ],
          },
        },
      });
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/551 shows Auto after an approved Plan returns to default collaboration", () => {
      const modeState = modes("agent", availableModes);

      expect(buildCodexModeState(modeState, [collaboration("plan")])?.current).toBe("plan");
      expect(buildCodexModeState(modeState, [collaboration("default")])?.current).toBe("auto");
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/551 shows Safe for the approval preset outside collaboration Plan", () => {
      const state = buildCodexModeState(modes("read-only", availableModes), [
        collaboration("default"),
      ]);

      expect(state?.current).toBe("default");
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/551 does not present an externally selected full-access preset as Auto", () => {
      const state = buildCodexModeState(modes("agent-full-access", availableModes), [
        collaboration("default"),
      ]);

      expect(state?.current).toBeNull();
      expect(state?.apply.auto).toEqual({
        kind: "sequence",
        steps: [
          { kind: "setConfigOption", configId: "collaboration_mode", value: "default" },
          { kind: "setMode", nativeId: "agent" },
        ],
      });
    });

    it.each([
      ["approval presets", modes("custom", ["custom"]), [collaboration("default")]],
      ["the collaboration control", modes("agent", availableModes), null],
    ] as const)("returns no picker when the adapter lacks %s", (_label, modeState, options) => {
      expect(buildCodexModeState(modeState, options ? [...options] : null)).toBeNull();
    });
  });
});
