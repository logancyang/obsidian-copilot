import { act, renderHook } from "@testing-library/react";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import { useAttentionChatIds } from "@/agentMode/ui/hooks/useAttentionChatIds";
import { useRunningChatIds } from "@/agentMode/ui/hooks/useRunningChatIds";

/**
 * Minimal manager stand-in exposing only the surfaces the hooks read:
 * `subscribe` (returns an unsubscribe) plus the two live id-set getters (both
 * serve the same backing set — each test exercises one hook at a time). A
 * handle lets the test swap the current set and fire the subscriber.
 */
function makeFakeManager(initial: ReadonlySet<string>) {
  let current = initial;
  const listeners = new Set<() => void>();
  const manager = {
    getRunningChatIds: () => current,
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
    unsubscribed: () => listeners.size === 0,
  };
}

describe("useRunningChatIds", () => {
  it("returns the initial running set on mount", () => {
    const { manager } = makeFakeManager(new Set(["a"]));
    const { result } = renderHook(() => useRunningChatIds(manager));
    expect(result.current.has("a")).toBe(true);
  });

  it("updates when the set's contents change", () => {
    const fake = makeFakeManager(new Set(["a"]));
    const { result } = renderHook(() => useRunningChatIds(fake.manager));
    act(() => fake.emit(new Set(["a", "b"])));
    expect(result.current.has("b")).toBe(true);
  });

  it("keeps the same reference when contents are unchanged", () => {
    const fake = makeFakeManager(new Set(["a"]));
    const { result } = renderHook(() => useRunningChatIds(fake.manager));
    const before = result.current;
    // Same membership in a freshly-allocated Set must not churn the snapshot.
    act(() => fake.emit(new Set(["a"])));
    expect(result.current).toBe(before);
  });

  it("unsubscribes on unmount", () => {
    const fake = makeFakeManager(new Set());
    const { unmount } = renderHook(() => useRunningChatIds(fake.manager));
    unmount();
    expect(fake.unsubscribed()).toBe(true);
  });
});

describe("useAttentionChatIds", () => {
  // The shared snapshot machinery is exercised above; this only pins that the
  // attention wrapper reads the attention getter and stays subscribed.
  it("tracks the manager's attention set", () => {
    const fake = makeFakeManager(new Set(["done-1"]));
    const { result } = renderHook(() => useAttentionChatIds(fake.manager));
    expect(result.current.has("done-1")).toBe(true);
    act(() => fake.emit(new Set(["done-1", "done-2"])));
    expect(result.current.has("done-2")).toBe(true);
  });
});
