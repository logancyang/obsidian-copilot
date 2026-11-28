import { act, renderHook } from "@testing-library/react";
import type { AgentChatUIState } from "@/agentMode/session/AgentChatUIState";
import type { AgentSession } from "@/agentMode/session/AgentSession";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import type { BackendState } from "@/agentMode/session/types";
import { SessionClientContext } from "@/agentMode/ui/hooks/useSessionSlice";
import { fakeSessionClient } from "@/agentMode/ui/testing/fakeSessionClient";
import type { PickerAgent, PickerCatalog } from "@copilot/protocol/pickerCatalog";
import React from "react";
import { useAgentModelPicker } from "./useAgentModelPicker";

jest.mock("./agentModelPickerHelpers", () => ({
  buildAgentModelPicker: ({
    manager,
    catalog,
  }: {
    manager: AgentSessionManager;
    catalog: PickerCatalog;
  }) => ({
    models: [],
    value: `${manager.getActiveSession()?.getState()?.model?.current.baseModelId ?? ""}:${catalog.agents
      .map((agent) => agent.installKind)
      .join(",")}:${manager.isTiedToAgent("active") ? "tied" : "free"}`,
    onChange: jest.fn(),
  }),
}));

function catalogWith(installKind: PickerAgent["installKind"]): PickerCatalog {
  return {
    defaultAgent: "opencode",
    agents: [{ id: "opencode", installKind } as PickerAgent],
  };
}

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
    it("rerenders from the active chat's model, whether the chat is tied to its agent, and the host's picker catalog", () => {
      let state = stateWithModel("first");
      let tied = false;
      let activeListener: (() => void) | null = null;
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
      } as unknown as AgentSession;
      const manager = {
        getActiveSession: () => session,
        getActiveChatUIState: () => activeUI,
        subscribe: () => jest.fn(),
        subscribeModelCache: () => jest.fn(),
        isTiedToAgent: () => tied,
      } as unknown as AgentSessionManager;
      const fake = fakeSessionClient({}, { pickerCatalog: catalogWith("ready") });
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <SessionClientContext.Provider value={fake.client}>
          {children}
        </SessionClientContext.Provider>
      );

      const { result } = renderHook(() => useAgentModelPicker(manager), { wrapper });
      expect(result.current?.value).toBe("first:ready:free");

      state = stateWithModel("second");
      act(() => activeListener?.());
      expect(result.current?.value).toBe("second:ready:free");

      act(() => fake.setHostState({ pickerCatalog: catalogWith("incompatible") }));
      expect(result.current?.value).toBe("second:incompatible:free");

      tied = true;
      act(() => activeListener?.());
      expect(result.current?.value).toBe("second:incompatible:tied");
    });
  });
});
