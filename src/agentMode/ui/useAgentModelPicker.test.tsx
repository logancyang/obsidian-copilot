import { act, renderHook } from "@testing-library/react";
import type { AgentChatUIState } from "@/agentMode/session/AgentChatUIState";
import type { AgentSession } from "@/agentMode/session/AgentSession";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import type { BackendDescriptor, BackendState } from "@/agentMode/session/types";
import { useAgentModelPicker } from "./useAgentModelPicker";

const mockDescriptors = [{ id: "opencode" }] as BackendDescriptor[];

jest.mock("@/settings/model", () => ({
  useSettingsValue: jest.fn().mockReturnValue({}),
}));

jest.mock("@/agentMode/backends/registry", () => ({
  listBackendDescriptors: () => mockDescriptors,
}));

jest.mock("./agentModelPickerHelpers", () => ({
  buildAgentModelPicker: ({ manager }: { manager: AgentSessionManager }) => ({
    models: [],
    value: `${
      manager.getActiveSession()?.getState()?.model?.current.baseModelId ?? ""
    }:${manager.getModelCacheSignature("opencode")}`,
    onChange: jest.fn(),
  }),
}));

function stateWithModel(baseModelId: string): BackendState {
  return {
    model: {
      current: { baseModelId, effort: null },
      availableModels: [{ baseModelId, name: baseModelId, provider: null, effortOptions: [] }],
      apply: { kind: "setModel" },
    },
    mode: null,
  };
}

describe("useAgentModelPicker", () => {
  describe("useAgentModelPicker()", () => {
    it("rerenders from session and catalog signals without reading the legacy backend cache", () => {
      let state = stateWithModel("first");
      let catalogSignal = "catalog-one";
      let activeListener: (() => void) | null = null;
      let cacheListener: (() => void) | null = null;
      const activeUI = {
        subscribe: (listener: () => void) => {
          activeListener = listener;
          return () => {
            activeListener = null;
          };
        },
      } as unknown as AgentChatUIState;
      const session = {
        internalId: "active",
        backendId: "opencode",
        getStatus: () => "idle",
        getState: () => state,
        hasUserVisibleMessages: () => false,
      } as unknown as AgentSession;
      const manager = {
        getActiveSession: () => session,
        getActiveChatUIState: () => activeUI,
        subscribe: () => jest.fn(),
        subscribeModelCache: (listener: () => void) => {
          cacheListener = listener;
          return () => {
            cacheListener = null;
          };
        },
        getModelCacheSignature: () => catalogSignal,
      } as unknown as AgentSessionManager;

      const { result } = renderHook(() => useAgentModelPicker(manager));
      expect(result.current?.value).toBe("first:catalog-one");

      state = stateWithModel("second");
      act(() => activeListener?.());
      expect(result.current?.value).toBe("second:catalog-one");

      catalogSignal = "catalog-two";
      act(() => cacheListener?.());
      expect(result.current?.value).toBe("second:catalog-two");
    });
  });
});
