import { useChatRelevantNotes } from "@/hooks/useChatRelevantNotes";
import {
  getChatRelevantNotesStore,
  type ChatRelevantNotesContext,
} from "@/search/chatRelevantNotesContext";
import { findChatRelevantNotes } from "@/search/findChatRelevantNotes";
import { act, renderHook } from "@testing-library/react";
import type { App } from "obsidian";
jest.mock("@/search/findChatRelevantNotes", () => ({ findChatRelevantNotes: jest.fn() }));
const find = findChatRelevantNotes as jest.Mock;
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
    it("debounces drafts by 500 ms and stays idle after settling (https://github.com/Brevilabs/obsidian-copilot-private/issues/383)", async () => {
      getChatRelevantNotesStore(app).select(context("a", "topic"));
      renderHook(() => useChatRelevantNotes(app, true, "", false));
      await act(async () => {
        jest.advanceTimersByTime(499);
      });
      expect(find).not.toHaveBeenCalled();
      await act(async () => {
        jest.advanceTimersByTime(1);
      });
      expect(find).toHaveBeenCalledTimes(1);
      await act(async () => {
        jest.advanceTimersByTime(10000);
      });
      expect(find).toHaveBeenCalledTimes(1);
    });
    it("ignores chat when Live is off (https://github.com/Brevilabs/obsidian-copilot-private/issues/383)", async () => {
      getChatRelevantNotesStore(app).select(context("a", "topic"));
      const { result } = renderHook(() => useChatRelevantNotes(app, false, "", false));
      await act(async () => {
        jest.runAllTimers();
      });
      expect(result.current.context).toBeNull();
      expect(find).not.toHaveBeenCalled();
    });
    it("keeps history-only and unsupported-only chats as sources, with empty fallback (https://github.com/Brevilabs/obsidian-copilot-private/issues/383)", () => {
      const store = getChatRelevantNotesStore(app);
      store.select(context("a", ""));
      const { result } = renderHook(() => useChatRelevantNotes(app, true, "", false));
      expect(result.current.context).toBeNull();
      act(() => store.select({ ...context("a", ""), skippedAttachments: 1 }));
      expect(result.current.context).not.toBeNull();
      act(() =>
        store.select({
          ...context("a", ""),
          request: { folder_name: "Vault", messages: [{ role: "user", content: "history" }] },
        })
      );
      expect(result.current.context).not.toBeNull();
    });
    it.each([
      "unsupported-service",
      "no-matches",
      "no-usable-context",
      "unavailable",
      "request-error",
      "request-too-large",
    ])(
      "restores the editor only for unsupported service, not %s results (https://github.com/Brevilabs/obsidian-copilot-private/issues/383)",
      async (status) => {
        find.mockResolvedValue({ notes: [], status });
        getChatRelevantNotesStore(app).select(context("a", "topic"));
        const { result } = renderHook(() => useChatRelevantNotes(app, true, "", false));
        await act(async () => {
          jest.advanceTimersByTime(500);
        });
        expect(result.current.context === null).toBe(status === "unsupported-service");
        expect(result.current.result.status).toBe(status);
      }
    );
    it("tries the new endpoint again after switching connections (https://github.com/Brevilabs/obsidian-copilot-private/issues/383)", async () => {
      find.mockResolvedValueOnce({ notes: [], status: "unsupported-service" });
      getChatRelevantNotesStore(app).select(context("a", "topic"));
      const { result, rerender } = renderHook(
        ({ connection }) => useChatRelevantNotes(app, true, connection, false),
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
      find.mockResolvedValueOnce({ notes: [{ note: { path: "old.md" } }], status: "matches" });
      getChatRelevantNotesStore(app).select(context("a", "topic"));
      const { result, rerender } = renderHook(
        ({ connection }) => useChatRelevantNotes(app, true, connection, false),
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
    it("rejects a superseded response (https://github.com/Brevilabs/obsidian-copilot-private/issues/383)", async () => {
      let resolve!: (value: unknown) => void;
      find.mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done;
          })
      );
      const store = getChatRelevantNotesStore(app);
      store.select(context("a", "first"));
      const { result } = renderHook(() => useChatRelevantNotes(app, true, "", false));
      await act(async () => {
        jest.advanceTimersByTime(500);
      });
      act(() => store.select(context("b", "second")));
      await act(async () => {
        jest.advanceTimersByTime(500);
      });
      await act(async () => resolve({ notes: [], status: "unavailable" }));
      expect(result.current.result.status).toBe("no-matches");
    });
  });
});
