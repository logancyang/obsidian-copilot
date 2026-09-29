import { renderHook } from "@testing-library/react";
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
    it("returns null while the active session is starting", () => {
      const session = {
        internalId: "active",
        backendId: "codex",
        getStatus: () => "starting",
        getState: () => null,
        canSwitchMode: () => null,
        subscribe: () => jest.fn(),
      } as unknown as AgentSession;
      const manager = {
        getActiveSession: () => session,
        subscribe: () => jest.fn(),
        subscribeModelCache: () => jest.fn(),
      } as unknown as AgentSessionManager;

      const { result } = renderHook(() => useAgentModePicker(manager));

      expect(result.current).toBeNull();
    });
  });
});
