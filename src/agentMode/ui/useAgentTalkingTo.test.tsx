import { BUILTIN_AGENT } from "@/agents/types";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import { useAgentTalkingTo } from "@/agentMode/ui/useAgentTalkingTo";
import { openVaultPath } from "@/utils/openVaultPath";
import { act, renderHook } from "@testing-library/react";

jest.mock("@/utils/openVaultPath", () => ({ openVaultPath: jest.fn() }));
jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));

const APP = {} as unknown as import("obsidian").App;

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

      renderHook(() => useAgentTalkingTo(manager, APP));

      expect(manager.refreshAgents).toHaveBeenCalledTimes(1);
    });

    it("reports the manager's selection and publishes a new one", async () => {
      const manager = buildManager();
      const { result } = renderHook(() => useAgentTalkingTo(manager, APP));
      expect(result.current.selectedSlug).toBe(BUILTIN_AGENT.slug);

      await act(async () => result.current.select("jennifer"));

      expect(manager.setSelectedAgent).toHaveBeenCalledWith("jennifer");
      expect(result.current.selectedSlug).toBe("jennifer");
    });

    it("survives a failed folder read instead of tearing down the header", async () => {
      // The picker sits in the header of every chat, so a vault read that
      // throws must leave it rendered on the last roster it had.
      const manager = buildManager({
        refreshAgents: jest.fn(async () => {
          throw new Error("EACCES");
        }),
      });

      const { result } = renderHook(() => useAgentTalkingTo(manager, APP));
      await act(async () => result.current.refresh());

      expect(result.current.entries).toBe(ENTRIES);
    });

    it("opens the agent's memory note when the agent still has one", async () => {
      const manager = buildManager({
        resolveAgentMemoryPath: jest.fn(async () => "copilot/agents/jennifer/MEMORY.md"),
      });
      const { result } = renderHook(() => useAgentTalkingTo(manager, APP));

      await act(async () => result.current.openMemory("jennifer"));

      expect(openVaultPath).toHaveBeenCalledWith(APP, "copilot/agents/jennifer/MEMORY.md", {
        newLeaf: true,
      });
    });

    it("opens nothing when the agent's memory file cannot be resolved", async () => {
      const manager = buildManager({ resolveAgentMemoryPath: jest.fn(async () => null) });
      const { result } = renderHook(() => useAgentTalkingTo(manager, APP));

      await act(async () => result.current.openMemory("ghost"));

      expect(openVaultPath).not.toHaveBeenCalled();
    });

    it("clears the agent's memory through the manager", async () => {
      const manager = buildManager({ clearAgentMemory: jest.fn(async () => undefined) });
      const { result } = renderHook(() => useAgentTalkingTo(manager, APP));

      await act(async () => result.current.clearMemory("jennifer"));

      expect(manager.clearAgentMemory).toHaveBeenCalledWith("jennifer");
    });
  });
});
