import { buildAgentModePicker } from "./agentModePickerHelpers";
import type { AgentSession } from "@/agentMode/session/AgentSession";
import type { AgentChatUIState } from "@/agentMode/session/AgentChatUIState";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import type { BackendState } from "@/agentMode/session/types";

jest.mock("obsidian", () => ({
  Notice: jest.fn(),
  Modal: class {},
  App: class {},
}));

jest.mock("@/agentMode/backends/registry", () => ({
  backendRegistry: {},
  listBackendDescriptors: () => [],
  getActiveBackendDescriptor: () => undefined,
}));

function makeUIState(canSwitchMode: boolean | null): AgentChatUIState {
  return {
    canSwitchMode: () => canSwitchMode,
  } as unknown as AgentChatUIState;
}

function makeManager(opts: {
  backendId: string | null;
  state: BackendState | null;
  canSwitchMode?: boolean | null;
  applyMode?: jest.Mock;
}): AgentSessionManager {
  const session = opts.backendId
    ? ({
        backendId: opts.backendId,
        getState: () => opts.state,
      } as unknown as AgentSession)
    : null;
  return {
    getActiveSession: () => session,
    getActiveChatUIState: () => makeUIState(opts.canSwitchMode ?? null),
    getCachedBackendState: () => null,
    applyMode: opts.applyMode ?? jest.fn().mockResolvedValue(undefined),
  } as unknown as AgentSessionManager;
}

describe("buildAgentModePicker", () => {
  it("returns null when manager is null", () => {
    expect(buildAgentModePicker({ manager: null })).toBeNull();
  });

  it("returns null when there is no active backend", () => {
    expect(
      buildAgentModePicker({
        manager: makeManager({ backendId: null, state: null }),
      })
    ).toBeNull();
  });

  it("returns null when the active backend has no mode state", () => {
    expect(
      buildAgentModePicker({
        manager: makeManager({
          backendId: "codex",
          state: { model: null, mode: null },
        }),
      })
    ).toBeNull();
  });

  it("disabled mirrors canSwitchMode() === false", () => {
    const picker = buildAgentModePicker({
      manager: makeManager({
        backendId: "codex",
        state: {
          model: null,
          mode: {
            current: "plan",
            options: [{ value: "plan", label: "Plan" }],
            apply: { plan: { kind: "setMode", nativeId: "plan" } },
          },
        },
        canSwitchMode: false,
      }),
    });
    expect(picker?.disabled).toBe(true);
  });

  it("disabled is false when canSwitchMode returns true or null", () => {
    const state: BackendState = {
      model: null,
      mode: {
        current: "plan",
        options: [{ value: "plan", label: "Plan" }],
        apply: { plan: { kind: "setMode", nativeId: "plan" } },
      },
    };
    expect(
      buildAgentModePicker({
        manager: makeManager({ backendId: "codex", state, canSwitchMode: true }),
      })?.disabled
    ).toBe(false);
    expect(
      buildAgentModePicker({
        manager: makeManager({ backendId: "codex", state, canSwitchMode: null }),
      })?.disabled
    ).toBe(false);
  });

  it("onChange dispatches manager.applyMode with the per-option spec", () => {
    const applyMode = jest.fn().mockResolvedValue(undefined);
    const spec = { kind: "setMode" as const, nativeId: "plan" };
    const picker = buildAgentModePicker({
      manager: makeManager({
        backendId: "codex",
        state: {
          model: null,
          mode: {
            current: "default",
            options: [
              { value: "default", label: "Default" },
              { value: "plan", label: "Plan" },
            ],
            apply: { plan: spec },
          },
        },
        applyMode,
      }),
    });
    picker?.onChange("plan");
    expect(applyMode).toHaveBeenCalledWith("codex", spec);
  });

  it("onChange ignores selections without an apply spec", () => {
    const applyMode = jest.fn().mockResolvedValue(undefined);
    const picker = buildAgentModePicker({
      manager: makeManager({
        backendId: "codex",
        state: {
          model: null,
          mode: {
            current: "default",
            options: [
              { value: "default", label: "Default" },
              { value: "plan", label: "Plan" },
            ],
            apply: {},
          },
        },
        applyMode,
      }),
    });
    picker?.onChange("plan");
    expect(applyMode).not.toHaveBeenCalled();
  });
});
