import { useAgentHistoryControls } from "@/agentMode/ui/hooks/useAgentHistoryControls";
import { GLOBAL_SCOPE } from "@/agentMode/session/scope";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import type { ChatHistoryItem } from "@/components/chat-components/ChatHistoryPopover";
import type CopilotPlugin from "@/main";
import { act, renderHook } from "@testing-library/react";

const item = (id: string): ChatHistoryItem => ({ id }) as unknown as ChatHistoryItem;

function makeManager() {
  return {
    getChatHistoryItems: jest.fn(async () => [item("a"), item("b")]),
    updateChatTitle: jest.fn(async () => {}),
    deleteChatHistory: jest.fn(async () => {}),
  } as unknown as AgentSessionManager & {
    getChatHistoryItems: jest.Mock;
    updateChatTitle: jest.Mock;
    deleteChatHistory: jest.Mock;
  };
}

const plugin = {} as unknown as CopilotPlugin;

const renderControls = (manager: AgentSessionManager, scope?: string) =>
  renderHook(({ s }: { s?: string }) => useAgentHistoryControls(manager, plugin, s), {
    initialProps: { s: scope },
  });

describe("useAgentHistoryControls scope", () => {
  it("regression: the global landing caller (no scope) loads ALL history", async () => {
    // Reason: the highest-risk regression in PR2a is silently scoping the global
    // Recent Chats list. Omitting `scope` must keep fetching every chat — the
    // manager treats `undefined` as the flat all-chats view.
    const manager = makeManager() as AgentSessionManager & { getChatHistoryItems: jest.Mock };
    const { result } = renderControls(manager);

    await act(async () => {
      await result.current.loadChatHistory();
    });

    expect(manager.getChatHistoryItems).toHaveBeenCalledWith(undefined);
    expect(result.current.chatHistoryItems).toHaveLength(2);
  });

  it("loads only the active scope's chats when a project scope is passed", async () => {
    const manager = makeManager() as AgentSessionManager & { getChatHistoryItems: jest.Mock };
    const { result } = renderControls(manager, "project-1");

    await act(async () => {
      await result.current.loadChatHistory();
    });

    expect(manager.getChatHistoryItems).toHaveBeenCalledWith("project-1");
  });

  it("GLOBAL_SCOPE behaves like the global all-chats view", async () => {
    const manager = makeManager() as AgentSessionManager & { getChatHistoryItems: jest.Mock };
    const { result } = renderControls(manager, GLOBAL_SCOPE);

    await act(async () => {
      await result.current.loadChatHistory();
    });

    expect(manager.getChatHistoryItems).toHaveBeenCalledWith(GLOBAL_SCOPE);
  });

  it("hides the previous scope's items on a scope change until the refetch lands", async () => {
    // Reason: AgentHome feeds one shared hook to both the project-landing Project
    // Chats and the conversation History popover. The `scope` prop flips
    // synchronously but the reload is async, so the stored items briefly belong to
    // the old scope — they must not flash (e.g. another project's chats, or the
    // global flat view) before the scoped refetch completes.
    const manager = makeManager() as AgentSessionManager & { getChatHistoryItems: jest.Mock };
    const { result, rerender } = renderControls(manager, "project-1");

    await act(async () => {
      await result.current.loadChatHistory();
    });
    expect(result.current.chatHistoryItems).toHaveLength(2);

    // Switch project before the new scope's items load → list clears, not stale.
    rerender({ s: "project-2" });
    expect(result.current.chatHistoryItems).toHaveLength(0);

    await act(async () => {
      await result.current.loadChatHistory();
    });
    expect(manager.getChatHistoryItems).toHaveBeenLastCalledWith("project-2");
    expect(result.current.chatHistoryItems).toHaveLength(2);
  });

  it("drops a stale out-of-order load whose scope was superseded mid-flight", async () => {
    // Reason: if the scope flips while an older fetch is still in flight and that
    // older fetch resolves AFTER the newer one, it must not write its stale items
    // back — otherwise the current scope's list is clobbered by the prior scope's
    // and sticks (the visible-scope guard would then blank it permanently).
    const resolvers: Record<string, (items: ChatHistoryItem[]) => void> = {};
    const manager = {
      getChatHistoryItems: jest.fn(
        (s?: string) =>
          new Promise<ChatHistoryItem[]>((resolve) => {
            resolvers[s ?? GLOBAL_SCOPE] = resolve;
          })
      ),
      updateChatTitle: jest.fn(async () => {}),
      deleteChatHistory: jest.fn(async () => {}),
    } as unknown as AgentSessionManager & { getChatHistoryItems: jest.Mock };

    const { result, rerender } = renderControls(manager, "project-1");

    // Start project-1's load (call A) and leave it pending.
    let loadA!: Promise<void>;
    act(() => {
      loadA = result.current.loadChatHistory();
    });

    // Scope flips to project-2; start its load (call B).
    rerender({ s: "project-2" });
    let loadB!: Promise<void>;
    act(() => {
      loadB = result.current.loadChatHistory();
    });

    // B lands first → project-2 items are shown.
    await act(async () => {
      resolvers["project-2"]([item("b1"), item("b2")]);
      await loadB;
    });
    expect(result.current.chatHistoryItems).toHaveLength(2);

    // A (stale project-1) resolves late → dropped, list stays on project-2's items.
    await act(async () => {
      resolvers["project-1"]([item("a1")]);
      await loadA;
    });
    expect(result.current.chatHistoryItems).toHaveLength(2);
  });

  it("reports settled only after a load for the CURRENT scope completes", async () => {
    // Reason: the project landing decides its layout (standalone Context vs the
    // tabbed shelf) from the chat count, so it must be able to tell "not loaded
    // yet" apart from "this project has no chats" — and a scope switch must
    // reset the flag until the new scope's load lands.
    const manager = makeManager() as AgentSessionManager & { getChatHistoryItems: jest.Mock };
    const { result, rerender } = renderControls(manager, "project-1");

    expect(result.current.chatHistorySettled).toBe(false);
    await act(async () => {
      await result.current.loadChatHistory();
    });
    expect(result.current.chatHistorySettled).toBe(true);

    rerender({ s: "project-2" });
    expect(result.current.chatHistorySettled).toBe(false);
    await act(async () => {
      await result.current.loadChatHistory();
    });
    expect(result.current.chatHistorySettled).toBe(true);
  });

  it("settles even when the load fails, leaving the items empty", async () => {
    // Reason: a failed first load must not leave the landing undecided forever
    // (blank below the composer) — it settles with an empty list and the landing
    // degrades to its zero-chat layout.
    const manager = makeManager() as AgentSessionManager & { getChatHistoryItems: jest.Mock };
    manager.getChatHistoryItems.mockRejectedValueOnce(new Error("vault read failed"));
    const { result } = renderControls(manager, "project-1");

    await act(async () => {
      await result.current.loadChatHistory();
    });

    expect(result.current.chatHistorySettled).toBe(true);
    expect(result.current.chatHistoryItems).toHaveLength(0);
  });

  it("refreshes within the same scope after a delete", async () => {
    const manager = makeManager() as AgentSessionManager & {
      getChatHistoryItems: jest.Mock;
      deleteChatHistory: jest.Mock;
    };
    const { result } = renderControls(manager, "project-1");

    await act(async () => {
      await result.current.deleteChat("a");
    });

    expect(manager.deleteChatHistory).toHaveBeenCalledWith("a");
    // The post-mutation reload must stay scoped, not fall back to global.
    expect(manager.getChatHistoryItems).toHaveBeenCalledWith("project-1");
  });
});
