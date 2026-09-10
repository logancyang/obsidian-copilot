import { useChatRelevantNotes } from "@/hooks/useChatRelevantNotes";
import {
  getChatRelevantNotesStore,
  type ChatRelevantNotesContext,
} from "@/search/chatRelevantNotesContext";
import { findChatRelevantNotes } from "@/search/findChatRelevantNotes";
import type { RelevantNotesResult } from "@/search/findRelevantNotes";
import { act, renderHook } from "@testing-library/react";
import type { App } from "obsidian";
jest.mock("@/search/findChatRelevantNotes", () => ({ findChatRelevantNotes: jest.fn() }));
const find = jest.mocked(findChatRelevantNotes);
const context = (id: string, draft: string): ChatRelevantNotesContext => ({
  id,
  request: { folder_name: "Vault", draft },
  skippedAttachments: 0,
  addFile: jest.fn(),
});
describe("useChatRelevantNotes", () => {
  describe("useChatRelevantNotes()", () => {
    let app: App;
    beforeEach(() => {
      jest.useFakeTimers();
      find.mockReset().mockResolvedValue({ notes: [], status: "no-matches" });
      app = { workspace: { on: jest.fn(), offref: jest.fn() } } as unknown as App;
    });
    afterEach(() => jest.useRealTimers());
    it("retrieves notes for the selected chat and exposes the returned ranking (https://github.com/Brevilabs/obsidian-copilot-private/issues/383)", async () => {
      const selectedChat = context("embeddings-chat", "How do embeddings work?");
      const matches: RelevantNotesResult = {
        status: "matches",
        notes: [
          {
            note: { path: "Embeddings.md", title: "Embeddings" },
            metadata: { score: 0.9, hasOutgoingLinks: false, hasBacklinks: false },
          },
        ],
      };
      find.mockResolvedValueOnce(matches);
      getChatRelevantNotesStore(app).select(selectedChat);
      const { result } = renderHook(() => useChatRelevantNotes(app, true, ""));
      expect(result.current.result.status).toBe("loading");

      await act(async () => {
        jest.advanceTimersByTime(500);
      });

      expect(find).toHaveBeenCalledWith(app, selectedChat);
      expect(result.current.context).toBe(selectedChat);
      expect(result.current.result).toEqual(matches);
    });

    it("searches only the latest draft after typing pauses for 500 ms (https://github.com/Brevilabs/obsidian-copilot-private/issues/383)", async () => {
      const store = getChatRelevantNotesStore(app);
      store.select(context("embeddings-chat", "How do"));
      renderHook(() => useChatRelevantNotes(app, true, ""));
      await act(async () => {
        jest.advanceTimersByTime(300);
      });
      const editedChat = context("embeddings-chat", "How do embeddings work?");
      act(() => store.update(editedChat));

      await act(async () => {
        jest.advanceTimersByTime(499);
      });
      expect(find).not.toHaveBeenCalled();
      await act(async () => {
        jest.advanceTimersByTime(1);
      });

      expect(find).toHaveBeenCalledTimes(1);
      expect(find).toHaveBeenCalledWith(app, editedChat);
    });

    it("does not repeat a completed search while the chat remains unchanged (https://github.com/Brevilabs/obsidian-copilot-private/issues/383)", async () => {
      getChatRelevantNotesStore(app).select(context("embeddings-chat", "How do embeddings work?"));
      const { result } = renderHook(() => useChatRelevantNotes(app, true, ""));
      await act(async () => {
        jest.advanceTimersByTime(500);
      });
      expect(result.current.result.status).toBe("no-matches");

      await act(async () => {
        jest.advanceTimersByTime(10000);
      });

      expect(find).toHaveBeenCalledTimes(1);
      expect(result.current.result.status).toBe("no-matches");
    });

    it("searches an unchanged chat again when refresh is requested (https://github.com/Brevilabs/obsidian-copilot-private/issues/383)", async () => {
      const selectedChat = context("embeddings-chat", "How do embeddings work?");
      getChatRelevantNotesStore(app).select(selectedChat);
      const { result } = renderHook(() => useChatRelevantNotes(app, true, ""));
      await act(async () => {
        jest.advanceTimersByTime(500);
      });
      find.mockResolvedValueOnce({ notes: [], status: "unavailable" });

      act(() => result.current.refresh());
      await act(async () => {
        jest.runOnlyPendingTimers();
      });

      expect(find).toHaveBeenCalledTimes(2);
      expect(find).toHaveBeenLastCalledWith(app, selectedChat);
      expect(result.current.result.status).toBe("unavailable");
    });
    it("leaves the editor as the source and does not search the chat while Live is off (https://github.com/Brevilabs/obsidian-copilot-private/issues/383)", async () => {
      getChatRelevantNotesStore(app).select(context("a", "topic"));
      const { result } = renderHook(() => useChatRelevantNotes(app, false, ""));
      await act(async () => {
        jest.runAllTimers();
      });
      expect(result.current.context).toBeNull();
      expect(find).not.toHaveBeenCalled();
    });
    it("leaves the editor as the source without searching when the selected chat is empty (https://github.com/Brevilabs/obsidian-copilot-private/issues/383)", async () => {
      getChatRelevantNotesStore(app).select(context("empty-chat", ""));
      const { result } = renderHook(() => useChatRelevantNotes(app, true, ""));

      await act(async () => {
        jest.runOnlyPendingTimers();
      });

      expect(result.current.context).toBeNull();
      expect(find).not.toHaveBeenCalled();
    });

    it("searches conversation history without waiting for a draft when the composer is empty (https://github.com/Brevilabs/obsidian-copilot-private/issues/383)", async () => {
      const historyChat = {
        ...context("history-chat", ""),
        request: {
          folder_name: "Vault",
          messages: [{ role: "user" as const, content: "How do embeddings work?" }],
        },
      };
      getChatRelevantNotesStore(app).select(historyChat);
      const { result } = renderHook(() => useChatRelevantNotes(app, true, ""));

      await act(async () => {
        jest.advanceTimersByTime(0);
      });

      expect(result.current.context).toBe(historyChat);
      expect(find).toHaveBeenCalledWith(app, historyChat);
      expect(result.current.result.status).toBe("no-matches");
    });

    it("keeps an attachment-only chat selected so its unusable-context result can be shown (https://github.com/Brevilabs/obsidian-copilot-private/issues/383)", async () => {
      const attachmentChat = { ...context("image-chat", ""), skippedAttachments: 1 };
      const response = {
        notes: [],
        status: "no-usable-context" as const,
        details: { skippedAttachments: 1 },
      };
      find.mockResolvedValueOnce(response);
      getChatRelevantNotesStore(app).select(attachmentChat);
      const { result } = renderHook(() => useChatRelevantNotes(app, true, ""));

      await act(async () => {
        jest.runOnlyPendingTimers();
      });

      expect(result.current.context).toBe(attachmentChat);
      expect(find).toHaveBeenCalledWith(app, attachmentChat);
      expect(result.current.result).toEqual(response);
    });

    it("returns control to the editor when Miyo does not support chat retrieval (https://github.com/Brevilabs/obsidian-copilot-private/issues/383)", async () => {
      find.mockResolvedValueOnce({ notes: [], status: "unsupported-service" });
      getChatRelevantNotesStore(app).select(context("embeddings-chat", "How do embeddings work?"));
      const { result } = renderHook(() => useChatRelevantNotes(app, true, ""));

      await act(async () => {
        jest.advanceTimersByTime(500);
      });

      expect(result.current.context).toBeNull();
      expect(result.current.result.status).toBe("unsupported-service");
    });

    it.each([
      "no-matches",
      "no-usable-context",
      "unavailable",
      "request-error",
      "request-too-large",
    ] as const)(
      "keeps the chat selected and exposes its %s result (https://github.com/Brevilabs/obsidian-copilot-private/issues/383)",
      async (status) => {
        const selectedChat = context("embeddings-chat", "How do embeddings work?");
        const response = { notes: [], status };
        find.mockResolvedValueOnce(response);
        getChatRelevantNotesStore(app).select(selectedChat);
        const { result } = renderHook(() => useChatRelevantNotes(app, true, ""));

        await act(async () => {
          jest.advanceTimersByTime(500);
        });

        expect(result.current.context).toBe(selectedChat);
        expect(result.current.result).toEqual(response);
      }
    );
    it("resumes chat retrieval on a new connection after the previous connection reported it unsupported (https://github.com/Brevilabs/obsidian-copilot-private/issues/383)", async () => {
      find.mockResolvedValueOnce({ notes: [], status: "unsupported-service" });
      getChatRelevantNotesStore(app).select(context("a", "topic"));
      const { result, rerender } = renderHook(
        ({ connection }) => useChatRelevantNotes(app, true, connection),
        { initialProps: { connection: "old" } }
      );
      await act(async () => {
        jest.advanceTimersByTime(500);
      });
      expect(result.current.context).toBeNull();
      rerender({ connection: "new" });
      await act(async () => {
        jest.runOnlyPendingTimers();
      });
      expect(result.current.context?.id).toBe("a");
      expect(find).toHaveBeenCalledTimes(2);
    });
    it("hides the previous connection's rows while its replacement request is pending (https://github.com/Brevilabs/obsidian-copilot-private/issues/383)", async () => {
      find.mockResolvedValueOnce({
        notes: [
          {
            note: { path: "old.md", title: "Old connection result" },
            metadata: { score: 0.8, hasOutgoingLinks: false, hasBacklinks: false },
          },
        ],
        status: "matches",
      });
      getChatRelevantNotesStore(app).select(context("a", "topic"));
      const { result, rerender } = renderHook(
        ({ connection }) => useChatRelevantNotes(app, true, connection),
        { initialProps: { connection: "old" } }
      );
      await act(async () => {
        jest.advanceTimersByTime(500);
      });
      expect(result.current.result.notes).toHaveLength(1);
      find.mockImplementationOnce(() => new Promise(() => {}));
      rerender({ connection: "new" });
      expect(result.current.result.status).toBe("loading");
      expect(result.current.result.notes).toHaveLength(0);
      await act(async () => {
        jest.runOnlyPendingTimers();
      });
      expect(result.current.result.notes).toHaveLength(0);
    });
    it("keeps the current chat result when a previous chat response arrives late (https://github.com/Brevilabs/obsidian-copilot-private/issues/383)", async () => {
      let resolve!: (value: RelevantNotesResult) => void;
      find.mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done;
          })
      );
      const store = getChatRelevantNotesStore(app);
      store.select(context("a", "first"));
      const { result } = renderHook(() => useChatRelevantNotes(app, true, ""));
      await act(async () => {
        jest.advanceTimersByTime(500);
      });
      act(() => store.select(context("b", "second")));
      await act(async () => {
        jest.advanceTimersByTime(500);
      });
      await act(async () => resolve({ notes: [], status: "unavailable" }));
      expect(result.current.context?.id).toBe("b");
      expect(result.current.result).toEqual({ notes: [], status: "no-matches" });
    });
  });
});
