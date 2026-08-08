import type { AgentChatBackend } from "@/agentMode/session/AgentChatBackend";
import type { SessionUsage } from "@/agentMode/session/types";
import { useSessionUsage } from "@/agentMode/ui/hooks/useSessionUsage";
import { act, renderHook } from "@testing-library/react";

/** Stand-in exposing only `getSessionUsage` + `subscribe`; rest cast away. */
function makeFakeBackend(initial: SessionUsage | null = null) {
  const state: { usage: SessionUsage | null } = { usage: initial };
  const listeners = new Set<() => void>();

  const backend = {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSessionUsage: () => state.usage,
  } as unknown as AgentChatBackend;

  return {
    backend,
    state,
    listenerCount: () => listeners.size,
    emit: () => listeners.forEach((l) => l()),
  };
}

const usage = (usedTokens: number): SessionUsage => ({ usedTokens, updatedAt: 1 });

describe("useSessionUsage", () => {
  it("returns the backend's initial usage snapshot", () => {
    const fake = makeFakeBackend(usage(10));
    const { result } = renderHook(() => useSessionUsage(fake.backend));
    expect(result.current).toEqual(usage(10));
  });

  it("returns null when the backend has no usage yet", () => {
    const fake = makeFakeBackend(null);
    const { result } = renderHook(() => useSessionUsage(fake.backend));
    expect(result.current).toBeNull();
  });

  it("re-syncs when the backend notifies", () => {
    const fake = makeFakeBackend(null);
    const { result } = renderHook(() => useSessionUsage(fake.backend));

    act(() => {
      fake.state.usage = usage(42);
      fake.emit();
    });

    expect(result.current).toEqual(usage(42));
  });

  it("imperatively syncs to a new backend when the prop changes", () => {
    const first = makeFakeBackend(usage(1));
    const second = makeFakeBackend(usage(2));

    const { result, rerender } = renderHook(({ backend }) => useSessionUsage(backend), {
      initialProps: { backend: first.backend },
    });
    expect(result.current).toEqual(usage(1));

    rerender({ backend: second.backend });
    expect(result.current).toEqual(usage(2));
  });

  it("unsubscribes on backend switch and unmount", () => {
    const first = makeFakeBackend();
    const second = makeFakeBackend();
    const { rerender, unmount } = renderHook(({ backend }) => useSessionUsage(backend), {
      initialProps: { backend: first.backend },
    });
    expect(first.listenerCount()).toBe(1);

    rerender({ backend: second.backend });
    expect(first.listenerCount()).toBe(0);
    expect(second.listenerCount()).toBe(1);

    unmount();
    expect(second.listenerCount()).toBe(0);
  });

  it("ignores notifications fired after unmount", () => {
    const fake = makeFakeBackend(null);
    const { result, unmount } = renderHook(() => useSessionUsage(fake.backend));

    unmount();
    expect(() =>
      act(() => {
        fake.state.usage = usage(99);
        fake.emit();
      })
    ).not.toThrow();
    expect(result.current).toBeNull();
  });
});
