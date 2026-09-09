import { AgentHomeShelf } from "@/agentMode/ui/AgentHomeShelf";
import React from "react";
import { RelevantNotesShelfPanel } from "@/agentMode/ui/RelevantNotesShelfPanel";
import { serializeFanoutComposite, type FanoutTurn } from "@/agentMode/session/fanout/fanoutTypes";
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
    afterEach(() => root.remove());
    it("sends literal excerpts, project references and visible prose only (https://github.com/Brevilabs/obsidian-copilot-private/issues/383)", () => {
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
        useChatRelevantNotesContext(app, root, "one", draft, [user, assistant], undefined)
      );
      void act(() => root.dispatchEvent(new Event("pointerdown", { bubbles: true })));
      const request = getChatRelevantNotesStore(app).getSnapshot()!.request;
      expect(request.messages).toEqual([
        { role: "user", content: "question" },
        { role: "assistant", content: "answer" },
      ]);
      expect(request.excerpts).toEqual(["literal excerpt"]);
      expect(request.file_paths).toEqual(["Vault/project.md"]);
      expect(JSON.stringify(request)).not.toContain("active.md");
      expect(JSON.stringify(request)).not.toContain("reasoning");
    });
    it("preserves the sent user while suppressing streamed tokens until completion (https://github.com/Brevilabs/obsidian-copilot-private/issues/383)", () => {
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
      expect(getChatRelevantNotesStore(app).getSnapshot()!.request.messages).toHaveLength(2);
    });
    it("omits a streaming assistant on initial mount and session switch (https://github.com/Brevilabs/obsidian-copilot-private/issues/383)", () => {
      const prior = {
        ...user,
        id: "prior",
        sender: "AI",
        message: "previous answer",
        turnStopReason: "end_turn" as const,
      };
      const partial = { ...user, id: "partial", sender: "AI", message: "partial answer" };
      const { rerender } = renderHook(
        ({ id, loading, messages }) =>
          useChatRelevantNotesContext(app, root, id, { ...draft, loading }, messages, undefined),
        { initialProps: { id: "one", loading: true, messages: [prior, user, partial] } }
      );
      void act(() => root.dispatchEvent(new Event("pointerdown")));
      expect(getChatRelevantNotesStore(app).getSnapshot()!.request.messages).toEqual([
        { role: "assistant", content: "previous answer" },
        { role: "user", content: "question" },
      ]);
      rerender({ id: "two", loading: true, messages: [user, partial] });
      expect(getChatRelevantNotesStore(app).getSnapshot()!.request.messages).toEqual([
        { role: "user", content: "question" },
      ]);
      rerender({ id: "two", loading: false, messages: [user, { ...partial, message: "final" }] });
      expect(getChatRelevantNotesStore(app).getSnapshot()!.request.messages?.at(-1)?.content).toBe(
        "final"
      );
    });
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
      expect(getChatRelevantNotesStore(app).getSnapshot()!.request.messages).toHaveLength(2);
    });
    it("retains queued text, excerpts, indexed files and skipped images after composer reset (https://github.com/Brevilabs/obsidian-copilot-private/issues/383)", () => {
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
    it("tracks editor focus with no recommendation consumer mounted (https://github.com/Brevilabs/obsidian-copilot-private/issues/383)", () => {
      renderHook(() => useChatRelevantNotesContext(app, root, "one", draft, [], undefined));
      void act(() => root.dispatchEvent(new Event("pointerdown")));
      expect(getChatRelevantNotesStore(app).getSnapshot()?.id).toBe("one");
      const listener = (app.workspace.on as jest.Mock).mock.calls.find(
        ([event]) => event === "active-leaf-change"
      )[1];
      void act(() => listener({ view: Object.create(MarkdownView.prototype) }));
      expect(getChatRelevantNotesStore(app).getSnapshot()).toBeNull();
    });
    it("preserves another source when selecting the real Relevant Notes tab (https://github.com/Brevilabs/obsidian-copilot-private/issues/383)", () => {
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
    it("sends fanout prose without persisted hidden metadata (https://github.com/Brevilabs/obsidian-copilot-private/issues/383)", () => {
      const turn: FanoutTurn = {
        answers: { codex: { backendId: "codex", status: "done", text: "answer" } },
        summary: { status: "done", text: "summary" },
      };
      const composite = serializeFanoutComposite(turn, (id) => id);
      renderHook(() =>
        useChatRelevantNotesContext(
          app,
          root,
          "one",
          draft,
          [{ ...user, sender: "AI", message: composite }],
          undefined
        )
      );
      void act(() => root.dispatchEvent(new Event("pointerdown")));
      const text = getChatRelevantNotesStore(app).getSnapshot()!.request.messages![0].content;
      expect(text).toContain("answer");
      expect(text).toContain("summary");
      expect(text).not.toContain("<!--");
      expect(text).not.toContain('status="');
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
    it("transfers the focused source on session switch and Add targets that session (https://github.com/Brevilabs/obsidian-copilot-private/issues/383)", () => {
      const { rerender } = renderHook(
        ({ id }) => useChatRelevantNotesContext(app, root, id, draft, [], undefined),
        { initialProps: { id: "one" } }
      );
      void act(() => root.dispatchEvent(new Event("pointerdown")));
      rerender({ id: "two" });
      const selected = getChatRelevantNotesStore(app).getSnapshot()!;
      expect(selected.id).toBe("two");
      selected.addFile("added.md");
      const update = (draft.setContextNotes as jest.Mock).mock.calls[0][0];
      expect(update([])[0].path).toBe("added.md");
    });
    it("preserves editor source when interacting with Relevant Notes (https://github.com/Brevilabs/obsidian-copilot-private/issues/383)", () => {
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
