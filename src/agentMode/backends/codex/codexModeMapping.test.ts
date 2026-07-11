import { translateBackendState } from "@/agentMode/session/translateBackendState";
import type { BackendDescriptor, RawModeState } from "@/agentMode/session/types";
import { buildCodexModeMapping } from "./codexModeMapping";

function modes(currentModeId: string, ids: string[]): RawModeState {
  return {
    currentModeId,
    availableModes: ids.map((id) => ({ id, name: id })),
  };
}

describe("buildCodexModeMapping", () => {
  it("maps the current agentclientprotocol adapter inventory", () => {
    const modeState = modes("agent", ["read-only", "agent", "agent-full-access"]);
    const mapping = buildCodexModeMapping(modeState);
    const state = translateBackendState({ models: null, modes: modeState, configOptions: null }, {
      getModeMapping: buildCodexModeMapping,
    } as unknown as BackendDescriptor);

    expect(mapping.canonical).toEqual({
      default: "agent",
      plan: "read-only",
      auto: "agent-full-access",
    });
    expect(mapping.readOnlyModeId).toBe("read-only");
    expect(state.mode).toEqual({
      current: "default",
      options: [
        { value: "default", label: "Default" },
        { value: "plan", label: "Plan" },
        { value: "auto", label: "Auto" },
      ],
      apply: {
        default: { kind: "setMode", nativeId: "agent" },
        plan: { kind: "setMode", nativeId: "read-only" },
        auto: { kind: "setMode", nativeId: "agent-full-access" },
      },
    });
  });

  it("keeps the legacy zed adapter inventory working", () => {
    const mapping = buildCodexModeMapping(modes("auto", ["read-only", "auto", "full-access"]));

    expect(mapping.canonical).toEqual({
      default: "auto",
      plan: "read-only",
      auto: "full-access",
    });
  });

  it("prefers a genuine native plan mode when advertised", () => {
    const mapping = buildCodexModeMapping(
      modes("plan", ["read-only", "agent", "plan", "agent-full-access"])
    );

    expect(mapping.canonical.plan).toBe("plan");
  });

  it("omits canonical choices that the adapter does not advertise", () => {
    const mapping = buildCodexModeMapping(modes("custom", ["custom"]));

    expect(mapping.canonical).toEqual({
      default: undefined,
      plan: undefined,
      auto: undefined,
    });
    expect(mapping.readOnlyModeId).toBeNull();
  });

  it("retains the legacy read-only contract for inventory-free fan-out setup", () => {
    expect(buildCodexModeMapping(null)).toEqual({
      kind: "setMode",
      canonical: { default: "auto", plan: "read-only", auto: "full-access" },
      readOnlyModeId: "read-only",
    });
  });
});
