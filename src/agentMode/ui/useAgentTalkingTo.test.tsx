import { BUILTIN_AGENT } from "@/agents/types";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import { useAgentTalkingTo } from "@/agentMode/ui/useAgentTalkingTo";
import { act, renderHook } from "@testing-library/react";

jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));

// Stable reference, as the manager's own getter is: `useSyncExternalStore`
// loops forever on a snapshot that allocates.
const ENTRIES = [BUILTIN_AGENT];

function buildManager(overrides: Partial<Record<string, unknown>> = {}) {
  let selectedSlug = BUILTIN_AGENT.slug;
  const listeners = new Set<() => void>();
  const manager = {
    getAgentEntries: () => ENTRIES,
    getSelectedAgentSlug: () => selectedSlug,
    setSelectedAgent: jest.fn(async (slug: string) => {
      selectedSlug = slug;
      for (const listener of listeners) listener();
    }),
    refreshAgents: jest.fn(async () => undefined),
    getActiveChatUIState: () => null,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    subscribeModelCache: () => () => {},
    ...overrides,
  };
  return manager as unknown as AgentSessionManager & typeof manager;
}

beforeEach(() => jest.clearAllMocks());

describe("useAgentTalkingTo", () => {
  describe("useAgentTalkingTo()", () => {
    it("re-reads the agents folder on mount so a just-created agent is listed", () => {
      const manager = buildManager();

      renderHook(() => useAgentTalkingTo(manager));

      expect(manager.refreshAgents).toHaveBeenCalledTimes(1);
    });

    it("reports the manager's selection and publishes a new one", async () => {
      const manager = buildManager();
      const { result } = renderHook(() => useAgentTalkingTo(manager));
      expect(result.current.selectedSlug).toBe(BUILTIN_AGENT.slug);

      await act(async () => result.current.select("jennifer"));

      expect(manager.setSelectedAgent).toHaveBeenCalledWith("jennifer");
      expect(result.current.selectedSlug).toBe("jennifer");
    });

    it("survives a failed folder read instead of tearing down the composer", async () => {
      // The roster feeds the composer's model picker, so a vault read that
      // throws must leave it rendered on the last roster it had.
      const manager = buildManager({
        refreshAgents: jest.fn(async () => {
          throw new Error("EACCES");
        }),
      });

      const { result } = renderHook(() => useAgentTalkingTo(manager));
      await act(async () => result.current.refresh());

      expect(result.current.entries).toBe(ENTRIES);
    });
  });
});
