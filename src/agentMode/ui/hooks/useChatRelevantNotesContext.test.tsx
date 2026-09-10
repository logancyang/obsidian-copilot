import { AgentHomeShelf } from "@/agentMode/ui/AgentHomeShelf";
import React from "react";
import { RelevantNotesShelfPanel } from "@/agentMode/ui/RelevantNotesShelfPanel";
import { useChatRelevantNotesContext } from "@/agentMode/ui/hooks/useChatRelevantNotesContext";
import type { AgentInputDraftControls } from "@/agentMode/ui/hooks/useAgentInputDrafts";
import type { AgentChatMessage } from "@/agentMode/session/types";
import { getChatRelevantNotesStore } from "@/search/chatRelevantNotesContext";
import { act, render, renderHook } from "@testing-library/react";
import { App, MarkdownView, TFile } from "obsidian";
jest.mock("obsidian", () => ({
  ...jest.requireActual("obsidian"),
  MarkdownView: class MarkdownView {},
}));
jest.mock("@/aiParams", () => ({
  useSelectedTextContexts: () => [[{ content: "literal excerpt", notePath: "excerpt.md" }]],
}));
jest.mock("@/hooks/useActiveFile", () => ({ useActiveFile: () => ({ path: "active.md" }) }));
jest.mock("@/miyo/miyoUtils", () => ({
  getMiyoFolderName: () => "Vault",
  getMiyoFilePath: (_app: unknown, path: string) => `Vault/${path}`,
}));
jest.mock("@/search/searchUtils", () => ({
  getMatchingPatterns: () => ({ inclusions: {}, exclusions: {} }),
  shouldIndexFile: () => true,
}));
describe("useChatRelevantNotesContext", () => {
  describe("useChatRelevantNotesContext()", () => {
    let app: App;
    let root: HTMLDivElement;
    let draft: AgentInputDraftControls;
    const user: AgentChatMessage = {
      id: "u",
      sender: "user",
      isVisible: true,
      message: "question",
      timestamp: null,
    };
    beforeEach(() => {
      app = {
        workspace: { on: jest.fn(), offref: jest.fn() },
        vault: {
          getFiles: () => [{ path: "project.md" }],
          getAbstractFileByPath: (path: string) =>
            Object.assign(new (TFile as unknown as new (path: string) => TFile)("file.md"), {
              path,
            }),
        },
      } as unknown as App;
      root = document.createElement("div");
      document.body.append(root);
      draft = {
        input: "draft",
        queue: [],
        images: [],
        contextNotes: [],
        includeActiveNote: false,
        loading: false,
        setContextNotes: jest.fn(),
      } as unknown as AgentInputDraftControls;
    });
    afterEach(() => {
      root.remove();
      jest.restoreAllMocks();
    });

    it.each(["pointerdown", "focusin"])(
      "selects the chat draft as the Relevant Notes source when its surface receives %s (https://github.com/Brevilabs/obsidian-copilot-private/issues/383)",
      (event) => {
        renderHook(() =>
          useChatRelevantNotesContext(
            app,
            root,
            "embeddings-chat",
            { ...draft, input: "How do embeddings work?" },
            [],
            undefined
          )
        );
        const store = getChatRelevantNotesStore(app);
        expect(store.getSnapshot()).toBeNull();

        act(() => {
          root.dispatchEvent(new Event(event, { bubbles: true }));
        });

        expect(store.getSnapshot()).toMatchObject({
          id: "embeddings-chat",
          request: {
            folder_name: "Vault",
            draft: "How do embeddings work?",
            messages: [],
            limit: 20,
          },
        });
      }
    );

    it("updates the selected chat's retrieval draft when the composer text changes (https://github.com/Brevilabs/obsidian-copilot-private/issues/383)", () => {
      const { rerender } = renderHook(
        ({ input }) =>
          useChatRelevantNotesContext(
            app,
            root,
            "embeddings-chat",
            { ...draft, input },
            [],
            undefined
          ),
        { initialProps: { input: "How do embeddings work?" } }
      );
      act(() => {
        root.dispatchEvent(new Event("pointerdown"));
      });

      rerender({ input: "How are embeddings stored?" });

      expect(getChatRelevantNotesStore(app).getSnapshot()).toMatchObject({
        id: "embeddings-chat",
        request: { draft: "How are embeddings stored?" },
      });
    });

    it("clears the selected chat when its surface unmounts (https://github.com/Brevilabs/obsidian-copilot-private/issues/383)", () => {
      const { unmount } = renderHook(() =>
        useChatRelevantNotesContext(app, root, "embeddings-chat", draft, [], undefined)
      );
      act(() => {
        root.dispatchEvent(new Event("pointerdown"));
      });
      expect(getChatRelevantNotesStore(app).getSnapshot()?.id).toBe("embeddings-chat");

      unmount();

      expect(getChatRelevantNotesStore(app).getSnapshot()).toBeNull();
    });
    it("builds retrieval history from visible user messages and assistant text, excluding reasoning and errors (https://github.com/Brevilabs/obsidian-copilot-private/issues/383)", () => {
      const assistant: AgentChatMessage = {
        ...user,
        id: "a",
        sender: "AI",
        message: "hidden",
        parts: [
          { kind: "thought", text: "reasoning" },
          { kind: "text", text: "answer" },
        ],
      };
      renderHook(() =>
        useChatRelevantNotesContext(
          app,
          root,
          "one",
          draft,
          [
            user,
            assistant,
            { ...user, id: "hidden", isVisible: false, message: "hidden instructions" },
            {
              ...assistant,
              id: "error",
              isErrorMessage: true,
              parts: undefined,
              message: "provider failed",
            },
          ],
          undefined
        )
      );
      void act(() => root.dispatchEvent(new Event("pointerdown", { bubbles: true })));
      const request = getChatRelevantNotesStore(app).getSnapshot()!.request;
      expect(request.messages).toEqual([
        { role: "user", content: "question" },
        { role: "assistant", content: "answer" },
      ]);
    });

    it("includes selected excerpts and project file references without implicitly attaching the active note (https://github.com/Brevilabs/obsidian-copilot-private/issues/383)", () => {
      renderHook(() => useChatRelevantNotesContext(app, root, "one", draft, [], undefined));

      act(() => {
        root.dispatchEvent(new Event("pointerdown"));
      });

      const request = getChatRelevantNotesStore(app).getSnapshot()!.request;
      expect(request.excerpts).toEqual(["literal excerpt"]);
      expect(request.file_paths).toEqual(["Vault/project.md"]);
    });
    it("includes the sent question immediately and adds the assistant answer only when streaming finishes (https://github.com/Brevilabs/obsidian-copilot-private/issues/383)", () => {
      const { rerender } = renderHook(
        ({ messages, loading }) =>
          useChatRelevantNotesContext(app, root, "one", { ...draft, loading }, messages, undefined),
        { initialProps: { messages: [] as AgentChatMessage[], loading: false } }
      );
      void act(() => root.dispatchEvent(new Event("pointerdown")));
      rerender({
        messages: [user, { ...user, id: "a", sender: "AI", message: "token" }],
        loading: true,
      });
      expect(getChatRelevantNotesStore(app).getSnapshot()!.request.messages).toEqual([
        { role: "user", content: "question" },
      ]);
      rerender({
        messages: [user, { ...user, id: "a", sender: "AI", message: "answer" }],
        loading: false,
      });
      expect(getChatRelevantNotesStore(app).getSnapshot()!.request.messages).toEqual([
        { role: "user", content: "question" },
        { role: "assistant", content: "answer" },
      ]);
    });
    it.each(["mount", "session switch"] as const)(
      "excludes an unfinished assistant reply after %s while retaining completed history (https://github.com/Brevilabs/obsidian-copilot-private/issues/383)",
      (entry) => {
        const prior: AgentChatMessage = {
          ...user,
          id: "prior",
          sender: "AI",
          message: "previous answer",
          turnStopReason: "end_turn",
        };
        const partial: AgentChatMessage = {
          ...user,
          id: "partial",
          sender: "AI",
          message: "partial answer",
        };
        const streamingMessages = [prior, user, partial];
        const { rerender } = renderHook(
          ({ id, messages }) =>
            useChatRelevantNotesContext(
              app,
              root,
              id,
              { ...draft, loading: true },
              messages,
              undefined
            ),
          {
            initialProps: {
              id: "first-chat",
              messages: entry === "mount" ? streamingMessages : [user],
            },
          }
        );
        act(() => {
          root.dispatchEvent(new Event("pointerdown"));
        });
        if (entry === "session switch")
          rerender({ id: "second-chat", messages: streamingMessages });

        expect(getChatRelevantNotesStore(app).getSnapshot()).toMatchObject({
          id: entry === "mount" ? "first-chat" : "second-chat",
          request: {
            messages: [
              { role: "assistant", content: "previous answer" },
              { role: "user", content: "question" },
            ],
          },
        });
      }
    );
    it("retains a completed answer while the next user turn starts (https://github.com/Brevilabs/obsidian-copilot-private/issues/383)", () => {
      const prior = {
        ...user,
        id: "prior",
        sender: "AI",
        message: "previous answer",
        turnStopReason: "end_turn" as const,
      };
      renderHook(() =>
        useChatRelevantNotesContext(
          app,
          root,
          "one",
          { ...draft, loading: true },
          [prior, user],
          undefined
        )
      );
      void act(() => root.dispatchEvent(new Event("pointerdown")));
      expect(getChatRelevantNotesStore(app).getSnapshot()!.request.messages).toEqual([
        { role: "assistant", content: "previous answer" },
        { role: "user", content: "question" },
      ]);
    });
    it("uses a queued message's raw text, excerpt, and note reference while counting its URL and image as skipped (https://github.com/Brevilabs/obsidian-copilot-private/issues/383)", () => {
      const queue = [
        {
          id: "q",
          text: "expanded private transport text",
          rawInput: "queued topic",
          context: {
            notes: [new (TFile as unknown as new (path: string) => TFile)("queued.md")],
            urls: ["https://example.com"],
            selectedTextContexts: [
              {
                content: "queued excerpt",
                notePath: "excerpt.md",
                sourceType: "note" as const,
                noteTitle: "Excerpt",
                startLine: 0,
                endLine: 1,
                id: "selection",
              },
            ],
          },
          promptContent: [
            { type: "image" as const, mimeType: "image/png", data: "private pixels" },
          ],
        },
      ];
      renderHook(() =>
        useChatRelevantNotesContext(
          app,
          root,
          "one",
          { ...draft, input: "", queue },
          [user],
          undefined
        )
      );
      void act(() => root.dispatchEvent(new Event("pointerdown")));
      const snapshot = getChatRelevantNotesStore(app).getSnapshot()!;
      expect(snapshot.request.messages?.at(-1)).toEqual({ role: "user", content: "queued topic" });
      expect(snapshot.request.excerpts).toContain("queued excerpt");
      expect(snapshot.request.file_paths).toContain("Vault/queued.md");
      expect(snapshot.skippedAttachments).toBe(2);
      expect(JSON.stringify(snapshot.request)).not.toContain("private");
    });
    it("keeps sent images in the skipped count after composer reset without sending pixels (https://github.com/Brevilabs/obsidian-copilot-private/issues/383)", () => {
      const sent: AgentChatMessage = {
        ...user,
        content: [
          { type: "text", text: "question" },
          { type: "image_url", image_url: { url: "data:image/png;base64,private-pixels" } },
        ],
      };
      const { rerender } = renderHook(
        ({ messages }) =>
          useChatRelevantNotesContext(
            app,
            root,
            "one",
            { ...draft, input: "" },
            messages,
            undefined
          ),
        { initialProps: { messages: [sent] } }
      );
      void act(() => root.dispatchEvent(new Event("pointerdown")));
      expect(getChatRelevantNotesStore(app).getSnapshot()!.skippedAttachments).toBe(1);
      rerender({ messages: [sent, { ...user, id: "answer", sender: "AI", message: "answer" }] });
      const snapshot = getChatRelevantNotesStore(app).getSnapshot()!;
      expect(snapshot.skippedAttachments).toBe(1);
      expect(snapshot.request.messages).toEqual([
        { role: "user", content: "question" },
        { role: "assistant", content: "answer" },
      ]);
      expect(JSON.stringify(snapshot.request)).not.toContain("private-pixels");
    });
    it("clears the selected chat when a Markdown editor becomes active even without a Relevant Notes pane (https://github.com/Brevilabs/obsidian-copilot-private/issues/383)", () => {
      renderHook(() => useChatRelevantNotesContext(app, root, "one", draft, [], undefined));
      void act(() => root.dispatchEvent(new Event("pointerdown")));
      expect(getChatRelevantNotesStore(app).getSnapshot()?.id).toBe("one");
      const listener = (app.workspace.on as jest.Mock).mock.calls.find(
        ([event]) => event === "active-leaf-change"
      )[1];
      void act(() => listener({ view: Object.create(MarkdownView.prototype) }));
      expect(getChatRelevantNotesStore(app).getSnapshot()).toBeNull();
    });
    it("keeps the previously selected chat when opening the Relevant Notes shelf tab in another chat (https://github.com/Brevilabs/obsidian-copilot-private/issues/383)", () => {
      const { getByRole } = render(
        <AgentHomeShelf
          sections={[
            { id: "chats", icon: <span />, title: "Chats", renderBody: () => <span /> },
            {
              id: "relevant-notes",
              icon: <span />,
              title: "Relevant Notes",
              renderBody: () => <span />,
            },
          ]}
        />,
        { container: root }
      );
      renderHook(() => useChatRelevantNotesContext(app, root, "one", draft, [], undefined));
      const other = {
        id: "other",
        request: { folder_name: "Vault", draft: "other topic" },
        skippedAttachments: 0,
        addFile: jest.fn(),
      };
      const store = getChatRelevantNotesStore(app);
      store.select(other);
      const tab = getByRole("tab", { name: "Relevant Notes" });
      void act(() => {
        tab.dispatchEvent(new Event("pointerdown", { bubbles: true }));
        tab.focus();
        tab.click();
      });
      expect(store.getSnapshot()).toBe(other);
    });
    it("does not steal a popout source when an unfocused document retains its composer activeElement (https://github.com/Brevilabs/obsidian-copilot-private/issues/383)", () => {
      const input = document.createElement("input");
      root.append(input);
      input.focus();
      const focus = jest.spyOn(document, "hasFocus").mockReturnValue(false);
      const store = getChatRelevantNotesStore(app);
      const popout = {
        id: "popout",
        request: { folder_name: "Vault", draft: "popout topic" },
        skippedAttachments: 0,
        addFile: jest.fn(),
      };
      store.select(popout);
      const { rerender } = renderHook(
        ({ text }) =>
          useChatRelevantNotesContext(app, root, "main", { ...draft, input: text }, [], undefined),
        { initialProps: { text: "main draft" } }
      );
      rerender({ text: "main update" });
      expect(document.activeElement).toBe(input);
      expect(store.getSnapshot()).toBe(popout);
      focus.mockRestore();
    });
    it("selects the new session's draft when the focused chat switches sessions (https://github.com/Brevilabs/obsidian-copilot-private/issues/383)", () => {
      const { rerender } = renderHook(
        ({ id, input }) =>
          useChatRelevantNotesContext(app, root, id, { ...draft, input }, [], undefined),
        { initialProps: { id: "first-chat", input: "How do embeddings work?" } }
      );
      act(() => {
        root.dispatchEvent(new Event("pointerdown"));
      });

      rerender({ id: "second-chat", input: "How does lexical search work?" });

      expect(getChatRelevantNotesStore(app).getSnapshot()).toMatchObject({
        id: "second-chat",
        request: { draft: "How does lexical search work?" },
      });
    });

    it("adds a recommended file to the new session's attachments after switching sessions (https://github.com/Brevilabs/obsidian-copilot-private/issues/383)", () => {
      const firstSessionSetter = jest.fn();
      const secondSessionSetter = jest.fn();
      const { rerender } = renderHook(
        ({ id, setContextNotes }) =>
          useChatRelevantNotesContext(app, root, id, { ...draft, setContextNotes }, [], undefined),
        { initialProps: { id: "first-chat", setContextNotes: firstSessionSetter } }
      );
      act(() => {
        root.dispatchEvent(new Event("pointerdown"));
      });
      rerender({ id: "second-chat", setContextNotes: secondSessionSetter });
      const existingNote = new (TFile as unknown as new (path: string) => TFile)("Existing.md");

      getChatRelevantNotesStore(app).getSnapshot()!.addFile("Embeddings.md");

      expect(firstSessionSetter).not.toHaveBeenCalled();
      expect(secondSessionSetter).toHaveBeenCalledTimes(1);
      const updateAttachments = secondSessionSetter.mock.calls[0][0];
      expect(updateAttachments([existingNote]).map((note: TFile) => note.path)).toEqual([
        "Existing.md",
        "Embeddings.md",
      ]);
    });
    it("keeps the editor as the source when clicking the Relevant Notes popout control (https://github.com/Brevilabs/obsidian-copilot-private/issues/383)", () => {
      const { getByRole } = render(
        <RelevantNotesShelfPanel onPopOut={jest.fn()}>
          <span>Notes</span>
        </RelevantNotesShelfPanel>,
        { container: root }
      );
      const shelf = getByRole("button", { name: "Open in separate pane" });
      renderHook(() => useChatRelevantNotesContext(app, root, "one", draft, [], undefined));
      void act(() => shelf.dispatchEvent(new Event("pointerdown", { bubbles: true })));
      expect(getChatRelevantNotesStore(app).getSnapshot()).toBeNull();
    });
  });
});
