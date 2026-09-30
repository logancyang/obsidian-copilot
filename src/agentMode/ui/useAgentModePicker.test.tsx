import { act, renderHook } from "@testing-library/react";
import type { AgentChatUIState } from "@/agentMode/session/AgentChatUIState";
import type { AgentSession } from "@/agentMode/session/AgentSession";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import type { BackendState } from "@/agentMode/session/types";
import { useAgentModePicker } from "./useAgentModePicker";

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

function stateWithMode(current: "default" | "plan"): BackendState {
  return {
    model: null,
    mode: {
      current,
      options: [
        { label: "Default", value: "default" },
        { label: "Plan", value: "plan" },
      ],
      apply: { default: { kind: "setMode" }, plan: { kind: "setMode" } },
    },
  } as unknown as BackendState;
}

describe("useAgentModePicker", () => {
  describe("useAgentModePicker()", () => {
    it("rebuilds the picker with the new current mode when the active session's mode changes", () => {
      let state = stateWithMode("default");
      let activeListener: (() => void) | null = null;
      const activeUI = {
        canSwitchMode: () => null,
        subscribe: (listener: () => void) => {
          activeListener = listener;
          return () => {
            activeListener = null;
          };
        },
      } as unknown as AgentChatUIState;
      const session = {
        internalId: "active",
        backendId: "codex",
        getStatus: () => "idle",
        getState: () => state,
      } as unknown as AgentSession;
      const manager = {
        getActiveSession: () => session,
        getActiveChatUIState: () => activeUI,
        subscribe: () => jest.fn(),
        subscribeModelCache: () => jest.fn(),
      } as unknown as AgentSessionManager;

      const { result } = renderHook(() => useAgentModePicker(manager));
      expect(result.current?.value).toBe("default");
      expect(result.current?.options.map((option) => option.label)).toEqual(["Default", "Plan"]);

      state = stateWithMode("plan");
      act(() => activeListener?.());

      expect(result.current?.value).toBe("plan");
    });
  });
});
