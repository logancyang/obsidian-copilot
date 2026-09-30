import { act, renderHook } from "@testing-library/react";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import { useAttentionChatIds } from "@/agentMode/ui/hooks/useAttentionChatIds";

function makeFakeManager(initial: ReadonlySet<string>) {
  let current = initial;
  const listeners = new Set<() => void>();
  const manager = {
    getAttentionChatIds: () => current,
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  } as unknown as AgentSessionManager;
  return {
    manager,
    emit: (next: ReadonlySet<string>) => {
      current = next;
      for (const l of listeners) l();
    },
  };
}

describe("useAttentionChatIds", () => {
  describe("useAttentionChatIds()", () => {
    it("tracks the manager's attention set as it changes", () => {
      const fake = makeFakeManager(new Set(["done-1"]));
      const { result } = renderHook(() => useAttentionChatIds(fake.manager));
      expect(result.current.has("done-1")).toBe(true);

      act(() => fake.emit(new Set(["done-1", "done-2"])));

      expect(result.current.has("done-2")).toBe(true);
    });
  });
});
