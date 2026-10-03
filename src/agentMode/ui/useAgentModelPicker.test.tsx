import { act, renderHook } from "@testing-library/react";
import type { AgentChatUIState } from "@/agentMode/session/AgentChatUIState";
import type { AgentSession } from "@/agentMode/session/AgentSession";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import type { BackendDescriptor, BackendState } from "@/agentMode/session/types";
import type CopilotPlugin from "@/main";
import { useAgentModelPicker } from "./useAgentModelPicker";

let mockInstallKind: "ready" | "incompatible" = "ready";
let mockInstallListener: (() => void) | null = null;
const mockDescriptors = [
  {
    id: "opencode",
    getInstallState: () =>
      mockInstallKind === "ready"
        ? ({ kind: "ready", source: "managed" } as const)
        : ({
            kind: "incompatible",
            source: "managed",
            currentVersion: "1.15.0",
            minVersion: "1.16.0",
            message: "Update required",
          } as const),
    subscribeInstallState: (_plugin: CopilotPlugin, listener: () => void) => {
      mockInstallListener = listener;
      return () => {
        mockInstallListener = null;
      };
    },
  },
] as unknown as BackendDescriptor[];
const plugin = {} as CopilotPlugin;

jest.mock("@/settings/model", () => ({
  useSettingsValue: jest.fn().mockReturnValue({}),
}));

jest.mock("@/agentMode/backends/registry", () => ({
  listBackendDescriptors: () => mockDescriptors,
}));

jest.mock("./agentModelPickerHelpers", () => ({
  buildAgentModelPicker: ({
    manager,
    descriptors,
  }: {
    manager: AgentSessionManager;
    descriptors: BackendDescriptor[];
  }) => ({
    models: [],
    value: `${
      manager.getActiveSession()?.getState()?.model?.current.baseModelId ?? ""
    }:${manager.getModelCacheSignature("opencode")}:${descriptors[0].getInstallState({} as never).kind}`,
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
  beforeEach(() => {
    mockInstallKind = "ready";
    mockInstallListener = null;
  });

  describe("useAgentModelPicker()", () => {
    it("rerenders from session, catalog, and backend readiness signals", () => {
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

      const { result } = renderHook(() => useAgentModelPicker(manager, plugin));
      expect(result.current?.value).toBe("first:catalog-one:ready");

      state = stateWithModel("second");
      act(() => activeListener?.());
      expect(result.current?.value).toBe("second:catalog-one:ready");

      catalogSignal = "catalog-two";
      act(() => cacheListener?.());
      expect(result.current?.value).toBe("second:catalog-two:ready");

      mockInstallKind = "incompatible";
      act(() => mockInstallListener?.());
      expect(result.current?.value).toBe("second:catalog-two:incompatible");
    });
  });
});
