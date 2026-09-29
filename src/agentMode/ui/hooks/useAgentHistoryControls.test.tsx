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
    // global flat view) before the scoped refetch completes.
    const manager = makeManager() as AgentSessionManager & { getChatHistoryItems: jest.Mock };
    const { result, rerender } = renderControls(manager, "project-1");

    await act(async () => {
      await result.current.loadChatHistory();
    });
    expect(result.current.chatHistoryItems).toHaveLength(2);

    rerender({ s: "project-2" });
    expect(result.current.chatHistoryItems).toHaveLength(0);

    await act(async () => {
      await result.current.loadChatHistory();
    });
    expect(manager.getChatHistoryItems).toHaveBeenLastCalledWith("project-2");
    expect(result.current.chatHistoryItems).toHaveLength(2);
  });

  it("drops a stale out-of-order load whose scope was superseded mid-flight", async () => {
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

    let loadA!: Promise<void>;
    act(() => {
      loadA = result.current.loadChatHistory();
    });

    rerender({ s: "project-2" });
    let loadB!: Promise<void>;
    act(() => {
      loadB = result.current.loadChatHistory();
    });

    await act(async () => {
      resolvers["project-2"]([item("b1"), item("b2")]);
      await loadB;
    });
    expect(result.current.chatHistoryItems).toHaveLength(2);

    await act(async () => {
      resolvers["project-1"]([item("a1")]);
      await loadA;
    });
    expect(result.current.chatHistoryItems).toHaveLength(2);
  });

  it("reports settled only after a load for the CURRENT scope completes", async () => {
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
    expect(manager.getChatHistoryItems).toHaveBeenCalledWith("project-1");
  });
});
