import { act, renderHook } from "@testing-library/react";
import type { AgentSession, AgentSessionListener } from "@/agentMode/session/AgentSession";
import { useSessionLabel } from "@/agentMode/ui/hooks/useSessionLabel";

function makeFakeSession(initial: string | null) {
  let label = initial;
  const listeners = new Set<AgentSessionListener>();
  const session = {
    getLabel: () => label,
    subscribe: (listener: AgentSessionListener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } as unknown as AgentSession;
  return {
    session,
    setLabel: (next: string | null) => {
      label = next;
      for (const listener of listeners) listener.onLabelChanged?.();
    },
    listenerCount: () => listeners.size,
  };
}

describe("useSessionLabel", () => {
  describe("useSessionLabel()", () => {
    it("returns the session's current label", () => {
      const fake = makeFakeSession("Trip plan");

      const { result } = renderHook(() => useSessionLabel(fake.session));

      expect(result.current).toBe("Trip plan");
    });

    it("returns null for an unlabeled session and for no session", () => {
      const fake = makeFakeSession(null);

      expect(renderHook(() => useSessionLabel(fake.session)).result.current).toBeNull();
      expect(renderHook(() => useSessionLabel(undefined)).result.current).toBeNull();
    });

    it("follows label changes, such as the agent titling the chat after its first reply", () => {
      const fake = makeFakeSession(null);
      const { result } = renderHook(() => useSessionLabel(fake.session));

      act(() => fake.setLabel("Summarize my week"));

      expect(result.current).toBe("Summarize my week");
    });

    it("stops listening when unmounted", () => {
      const fake = makeFakeSession("A");
      const { unmount } = renderHook(() => useSessionLabel(fake.session));
      expect(fake.listenerCount()).toBe(1);

      unmount();

      expect(fake.listenerCount()).toBe(0);
    });
  });
});
