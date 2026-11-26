import { translateBackendState } from "@/agentMode/session/translateBackendState";
import type { BackendDescriptor, RawModeState } from "@/agentMode/session/types";
import { buildCursorModeMapping } from "./cursorModeMapping";

const descriptor = {
  getModeMapping: buildCursorModeMapping,
  wire: {
    encode: (selection: { baseModelId: string }) => selection.baseModelId,
    decode: (wireId: string) => ({
      selection: { baseModelId: wireId, effort: null },
      provider: null,
    }),
  },
} as unknown as BackendDescriptor;

function modes(currentModeId: string, ids: string[]): RawModeState {
  return {
    currentModeId,
    availableModes: ids.map((id) => ({ id, name: id })),
  };
}

describe("cursorModeMapping", () => {
  describe("buildCursorModeMapping()", () => {
    it("maps Default, Plan, and Auto onto Cursor's ask, plan, and agent modes", () => {
      const state = translateBackendState(
        {
          models: null,
          modes: modes("agent", ["ask", "plan", "agent"]),
          configOptions: null,
        },
        descriptor
      );

      expect(state.mode?.current).toBe("auto");
      expect(state.mode?.options.map((option) => option.value)).toEqual([
        "default",
        "plan",
        "auto",
      ]);
      expect(state.mode?.apply).toEqual({
        default: { kind: "setMode", nativeId: "ask" },
        plan: { kind: "setMode", nativeId: "plan" },
        auto: { kind: "setMode", nativeId: "agent" },
      });
    });

    it("shows Default when Cursor's current mode is ask", () => {
      const state = translateBackendState(
        { models: null, modes: modes("ask", ["ask", "plan", "agent"]), configOptions: null },
        descriptor
      );
      expect(state.mode?.current).toBe("default");
    });

    it("hides a Copilot mode Cursor did not advertise", () => {
      const state = translateBackendState(
        { models: null, modes: modes("ask", ["ask", "agent"]), configOptions: null },
        descriptor
      );
      expect(state.mode?.options.map((option) => option.value)).toEqual(["default", "auto"]);
    });
  });
});
