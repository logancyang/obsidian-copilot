import { useAgentHistoryControls } from "@/agentMode/ui/hooks/useAgentHistoryControls";
import { GLOBAL_SCOPE } from "@/agentMode/session/scope";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import type { ChatHistoryItem } from "@/components/chat-components/ChatHistoryPopover";
import type CopilotPlugin from "@/main";
import { act, renderHook } from "@testing-library/react";
import { Notice } from "obsidian";

const item = (id: string): ChatHistoryItem => ({ id }) as unknown as ChatHistoryItem;

function makeManager() {
  return {
    getChatHistoryItems: jest.fn(async () => [item("a"), item("b")]),
    updateChatTitle: jest.fn(async () => {}),
    deleteChatHistory: jest.fn(async () => ({ removed: ["chat file"], kept: [], failed: [] })),
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

describe("useAgentHistoryControls", () => {
  describe("useAgentHistoryControls()", () => {
    it("loads the history of every chat when no scope is given", async () => {
      const manager = makeManager() as AgentSessionManager & { getChatHistoryItems: jest.Mock };
      const { result } = renderControls(manager);

      await act(async () => {
        await result.current.loadChatHistory();
      });

      expect(manager.getChatHistoryItems).toHaveBeenCalledWith(undefined);
      expect(result.current.chatHistoryItems).toHaveLength(2);
    });

    it("loads only the chats of the given project scope", async () => {
      const manager = makeManager() as AgentSessionManager & { getChatHistoryItems: jest.Mock };
      const { result } = renderControls(manager, "project-1");

      await act(async () => {
        await result.current.loadChatHistory();
      });

      expect(manager.getChatHistoryItems).toHaveBeenCalledWith("project-1");
    });

    it("hides the previous scope's chats after a scope change until the new scope's load lands", async () => {
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

    it("ignores a load that resolves after its scope was replaced by another scope", async () => {
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

    it("reports the history as settled only once a load for the current scope completes", async () => {
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

    it("reports the history as settled with no chats when the load fails", async () => {
      const manager = makeManager() as AgentSessionManager & { getChatHistoryItems: jest.Mock };
      manager.getChatHistoryItems.mockRejectedValueOnce(new Error("vault read failed"));
      const { result } = renderControls(manager, "project-1");

      await act(async () => {
        await result.current.loadChatHistory();
      });

      expect(result.current.chatHistorySettled).toBe(true);
      expect(result.current.chatHistoryItems).toHaveLength(0);
    });

    it("deletes the chat and reloads the history of the same scope", async () => {
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

    it("shows one notice built from the delete report and never claims a full delete after a failure", async () => {
      const manager = makeManager() as AgentSessionManager & { deleteChatHistory: jest.Mock };
      manager.deleteChatHistory.mockResolvedValue({
        removed: ["chat file"],
        kept: [],
        failed: [{ copy: "session index entry", error: "disk full" }],
      });
      const { result } = renderControls(manager);
      (Notice as unknown as jest.Mock).mockClear();

      await act(async () => {
        await result.current.deleteChat("a");
      });

      expect(Notice).toHaveBeenCalledTimes(1);
      expect(Notice).toHaveBeenCalledWith(
        "Deletion was partial. Removed: chat file. Failed: session index entry (disk full)."
      );
    });
  });
});
