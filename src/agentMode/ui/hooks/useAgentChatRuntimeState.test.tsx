import type { AgentChatBackend } from "@/agentMode/session/AgentChatBackend";
import type {
  AgentChatMessage,
  AskUserQuestionPrompt,
  CurrentPlan,
  PermissionPrompt,
} from "@/agentMode/session/types";
import { useAgentChatRuntimeState } from "@/agentMode/ui/hooks/useAgentChatRuntimeState";
import { act, renderHook } from "@testing-library/react";

interface FakeBackendState {
  messages: AgentChatMessage[];
  isStarting: boolean;
  hasPendingPlanPermission: boolean;
  currentPlan: CurrentPlan | null;
  pendingToolPermissions: PermissionPrompt[];
  pendingAskUserQuestions: AskUserQuestionPrompt[];
}

/**
 * Minimal stand-in for the backend the hook subscribes to. Only the getters
 * and `subscribe` the hook touches are implemented; the rest of
 * `AgentChatBackend` is irrelevant here and cast away.
 */
function makeFakeBackend(initial: Partial<FakeBackendState> = {}) {
  const state: FakeBackendState = {
    messages: initial.messages ?? [],
    isStarting: initial.isStarting ?? false,
    hasPendingPlanPermission: initial.hasPendingPlanPermission ?? false,
    currentPlan: initial.currentPlan ?? null,
    pendingToolPermissions: initial.pendingToolPermissions ?? [],
    pendingAskUserQuestions: initial.pendingAskUserQuestions ?? [],
  };
  const listeners = new Set<() => void>();

  const backend = {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getMessages: () => state.messages,
    isStarting: () => state.isStarting,
    hasPendingPlanPermission: () => state.hasPendingPlanPermission,
    getCurrentPlan: () => state.currentPlan,
    getPendingToolPermissions: () => state.pendingToolPermissions,
    getPendingAskUserQuestions: () => state.pendingAskUserQuestions,
  } as unknown as AgentChatBackend;

  return {
    backend,
    state,
    listenerCount: () => listeners.size,
    emit: () => listeners.forEach((l) => l()),
  };
}

const msg = (id: string): AgentChatMessage => ({ id }) as unknown as AgentChatMessage;

describe("useAgentChatRuntimeState", () => {
  it("returns the backend's initial snapshot", () => {
    const fake = makeFakeBackend({ messages: [msg("a")], isStarting: true });
    const { result } = renderHook(() => useAgentChatRuntimeState(fake.backend));

    expect(result.current.messages).toEqual([msg("a")]);
    expect(result.current.isStarting).toBe(true);
    expect(result.current.hasPendingPlanPermission).toBe(false);
    expect(result.current.currentPlan).toBeNull();
    expect(result.current.pendingToolPermissions).toEqual([]);
  });

  it("re-syncs every field when the backend notifies", () => {
    const fake = makeFakeBackend();
    const { result } = renderHook(() => useAgentChatRuntimeState(fake.backend));

    act(() => {
      fake.state.messages = [msg("x"), msg("y")];
      fake.state.isStarting = true;
      fake.state.hasPendingPlanPermission = true;
      fake.emit();
    });

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.isStarting).toBe(true);
    expect(result.current.hasPendingPlanPermission).toBe(true);
  });

  it("imperatively syncs to the new backend when the backend prop changes", () => {
    const first = makeFakeBackend({ messages: [msg("first")] });
    const second = makeFakeBackend({ messages: [msg("second")], isStarting: true });

    const { result, rerender } = renderHook(({ backend }) => useAgentChatRuntimeState(backend), {
      initialProps: { backend: first.backend },
    });
    expect(result.current.messages).toEqual([msg("first")]);

    rerender({ backend: second.backend });

    // The lazy initializers only ran for `first`; switching backends must pull
    // the new snapshot imperatively rather than keep stale values.
    expect(result.current.messages).toEqual([msg("second")]);
    expect(result.current.isStarting).toBe(true);
  });

  it("unsubscribes from the previous backend on switch and unmount", () => {
    const first = makeFakeBackend();
    const second = makeFakeBackend();
    const { rerender, unmount } = renderHook(({ backend }) => useAgentChatRuntimeState(backend), {
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
    const fake = makeFakeBackend();
    const { result, unmount } = renderHook(() => useAgentChatRuntimeState(fake.backend));

    unmount();
    expect(() =>
      act(() => {
        fake.state.messages = [msg("late")];
        fake.emit();
      })
    ).not.toThrow();
    // The hook detached its listener, so the late emit is a no-op.
    expect(result.current.messages).toEqual([]);
  });
});
