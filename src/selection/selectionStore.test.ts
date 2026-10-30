import {
  attachSelection,
  clearSelection,
  dismissSelection,
  getSelectedTextContexts,
  reportSelection,
  subscribeSelection,
  useSelectedTextContexts,
} from "@/selection/selectionStore";
import type { NoteSelectedTextContext, WebSelectedTextContext } from "@/types/message";
import { act, renderHook } from "@testing-library/react";

const ISSUE_797 = "https://github.com/Brevilabs/obsidian-copilot-private/issues/797";

let nextId = 0;
const noteExcerpt = (notePath: string, content: string): NoteSelectedTextContext => ({
  id: `note-${nextId++}`,
  content,
  sourceType: "note",
  noteTitle: notePath.replace(/\.md$/, ""),
  notePath,
  startLine: 1,
  endLine: 1,
});
const webExcerpt = (url: string, content: string): WebSelectedTextContext => ({
  id: `web-${nextId++}`,
  content,
  sourceType: "web",
  title: "Page",
  url,
});
const select = (context: NoteSelectedTextContext | WebSelectedTextContext, key: string) =>
  reportSelection({
    location: context.sourceType === "web" ? context.url : context.notePath,
    key,
    context,
  });

describe("selectionStore", () => {
  beforeEach(() => clearSelection());

  describe("reportSelection()", () => {
    it("attaches a reported selection and replaces it with the next one from any source", () => {
      const note = noteExcerpt("Research.md", "Excerpt");
      const web = webExcerpt("https://example.com/", "Quote");

      select(note, "replace:note");
      expect(getSelectedTextContexts()).toEqual([note]);

      select(web, "replace:web");
      expect(getSelectedTextContexts()).toEqual([web]);
    });

    it("keeps the attached selection when the same selection is reported again", () => {
      const first = noteExcerpt("Research.md", "Excerpt");
      select(first, "repeat:key");

      select(noteExcerpt("Research.md", "Excerpt"), "repeat:key");

      expect(getSelectedTextContexts()).toEqual([first]);
    });

    it(`clears the attached selection when its own note reports nothing selected (${ISSUE_797})`, () => {
      select(noteExcerpt("Research.md", "Excerpt"), "own:select");

      reportSelection({ location: "Research.md", key: "own:empty", context: null });

      expect(getSelectedTextContexts()).toEqual([]);
    });

    it(`keeps the attached selection when another note reports nothing selected (${ISSUE_797})`, () => {
      const excerpt = noteExcerpt("Research.md", "Excerpt");
      select(excerpt, "other:select");

      reportSelection({ location: "Draft.md", key: "other:empty", context: null });

      expect(getSelectedTextContexts()).toEqual([excerpt]);
    });

    it("attaches the same selection again once the user deselected it in between", () => {
      select(noteExcerpt("Research.md", "Excerpt"), "again:select");
      reportSelection({ location: "Research.md", key: "again:empty", context: null });

      const again = noteExcerpt("Research.md", "Excerpt");
      select(again, "again:select");

      expect(getSelectedTextContexts()).toEqual([again]);
    });
  });

  describe("attachSelection()", () => {
    it("attaches a command's selection, which its note's later empty report clears", () => {
      const excerpt = noteExcerpt("Research.md", "Excerpt");

      attachSelection(excerpt);
      expect(getSelectedTextContexts()).toEqual([excerpt]);

      reportSelection({ location: "Research.md", key: "command:empty", context: null });
      expect(getSelectedTextContexts()).toEqual([]);
    });
  });

  describe("dismissSelection()", () => {
    it(`keeps a removed selection removed while the same selection is reported, until it changes (${ISSUE_797})`, () => {
      const excerpt = webExcerpt("https://example.com/", "Quote");
      select(excerpt, "dismiss:quote");

      dismissSelection(excerpt.id);
      select(webExcerpt("https://example.com/", "Quote"), "dismiss:quote");
      expect(getSelectedTextContexts()).toEqual([]);

      const changed = webExcerpt("https://example.com/", "Longer quote");
      select(changed, "dismiss:longer");
      expect(getSelectedTextContexts()).toEqual([changed]);
    });

    it("leaves the attached selection when the id belongs to no attached selection", () => {
      const excerpt = noteExcerpt("Research.md", "Excerpt");
      select(excerpt, "unknown:select");

      dismissSelection("not-attached");

      expect(getSelectedTextContexts()).toEqual([excerpt]);
    });
  });

  describe("clearSelection()", () => {
    it(`removes the selection for a new message without bringing it back on the next identical report (${ISSUE_797})`, () => {
      select(noteExcerpt("Research.md", "Excerpt"), "sent:select");

      clearSelection();
      select(noteExcerpt("Research.md", "Excerpt"), "sent:select");

      expect(getSelectedTextContexts()).toEqual([]);
    });
  });

  describe("getSelectedTextContexts()", () => {
    it("returns the same empty list every time nothing is attached", () => {
      expect(getSelectedTextContexts()).toBe(getSelectedTextContexts());
    });
  });

  describe("useSelectedTextContexts()", () => {
    it("re-renders with the attached selection and with the empty list once it is cleared", () => {
      const { result } = renderHook(() => useSelectedTextContexts());
      const excerpt = noteExcerpt("Research.md", "Excerpt");

      act(() => select(excerpt, "hook:select"));
      expect(result.current).toEqual([excerpt]);

      act(() => clearSelection());
      expect(result.current).toEqual([]);
    });
  });

  describe("subscribeSelection()", () => {
    it("notifies the listener of each change until it unsubscribes", () => {
      const listener = jest.fn();
      const unsubscribe = subscribeSelection(listener);
      const excerpt = noteExcerpt("Research.md", "Excerpt");

      select(excerpt, "subscribe:select");
      unsubscribe();
      clearSelection();

      expect(listener.mock.calls).toEqual([[[excerpt]]]);
    });
  });
});
