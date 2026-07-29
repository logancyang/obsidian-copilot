import { renderHook } from "@testing-library/react";
import type { AgentChatUIState } from "@/agentMode/session/AgentChatUIState";
import type { AgentSession } from "@/agentMode/session/AgentSession";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
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

describe("useAgentModePicker", () => {
  describe("useAgentModePicker()", () => {
    it("does not read shared cached state while the active session is starting", () => {
      const getCachedBackendState = jest.fn();
      const activeUI = {
        canSwitchMode: () => null,
        subscribe: () => jest.fn(),
      } as unknown as AgentChatUIState;
      const session = {
        internalId: "active",
        backendId: "codex",
        getStatus: () => "starting",
        getState: () => null,
      } as unknown as AgentSession;
      const manager = {
        getActiveSession: () => session,
        getActiveChatUIState: () => activeUI,
        subscribe: () => jest.fn(),
        subscribeModelCache: () => jest.fn(),
        getCachedBackendState,
      } as unknown as AgentSessionManager;

      const { result } = renderHook(() => useAgentModePicker(manager));

      expect(result.current).toBeNull();
      expect(getCachedBackendState).not.toHaveBeenCalled();
    });
  });
});
