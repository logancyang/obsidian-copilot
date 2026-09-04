import {
  ROW_EXIT_MS,
  useRelevantNoteRowTransitions,
} from "@/components/chat-components/ui/useRelevantNoteRowTransitions";
import type { RelevantNoteEntry } from "@/search/findRelevantNotes";
import { act, renderHook } from "@testing-library/react";

function entry(path: string, score = 0.5): RelevantNoteEntry {
  return {
    note: { path, title: path.replace(/\.md$/, "") },
    metadata: { score, hasOutgoingLinks: false, hasBacklinks: false },
  };
}

function paths(rows: readonly { note: RelevantNoteEntry; exiting: boolean }[]): string[] {
  return rows.map((row) => `${row.note.note.path}${row.exiting ? ":exiting" : ""}`);
}

function entering(rows: readonly { note: RelevantNoteEntry; entering: boolean }[]): string[] {
  return rows.filter((row) => row.entering).map((row) => row.note.note.path);
}

function renderTransitions(initialProps: { notes: RelevantNoteEntry[]; sourceKey: string }) {
  return renderHook(
    ({ notes, sourceKey }: { notes: RelevantNoteEntry[]; sourceKey: string }) =>
      useRelevantNoteRowTransitions(notes, sourceKey, true),
    { initialProps }
  );
}

describe("useRelevantNoteRowTransitions", () => {
  describe("useRelevantNoteRowTransitions()", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("mirrors the results it is given on first render", () => {
      const { result } = renderHook(() =>
        useRelevantNoteRowTransitions([entry("a.md"), entry("b.md")], "Source.md", true)
      );

      expect(paths(result.current.rows)).toEqual(["a.md", "b.md"]);
    });

    it("reorders rows to match a new ranking", () => {
      const { result, rerender } = renderHook(
        ({ notes }: { notes: RelevantNoteEntry[] }) =>
          useRelevantNoteRowTransitions(notes, "Source.md", true),
        { initialProps: { notes: [entry("a.md", 0.9), entry("b.md", 0.4)] } }
      );

      rerender({ notes: [entry("b.md", 0.95), entry("a.md", 0.3)] });

      expect(paths(result.current.rows)).toEqual(["b.md", "a.md"]);
    });

    it("holds a departed note in its previous slot so its removal can be seen (https://github.com/Brevilabs/obsidian-copilot-private/issues/362)", () => {
      const { result, rerender } = renderHook(
        ({ notes }: { notes: RelevantNoteEntry[] }) =>
          useRelevantNoteRowTransitions(notes, "Source.md", true),
        { initialProps: { notes: [entry("a.md"), entry("b.md"), entry("c.md")] } }
      );

      rerender({ notes: [entry("a.md"), entry("c.md")] });

      expect(paths(result.current.rows)).toEqual(["a.md", "b.md:exiting", "c.md"]);
    });

    it("drops a departed note once its removal has played", () => {
      const { result, rerender } = renderHook(
        ({ notes }: { notes: RelevantNoteEntry[] }) =>
          useRelevantNoteRowTransitions(notes, "Source.md", true),
        { initialProps: { notes: [entry("a.md"), entry("b.md")] } }
      );
      rerender({ notes: [entry("a.md")] });

      act(() => {
        jest.advanceTimersByTime(ROW_EXIT_MS);
      });

      expect(paths(result.current.rows)).toEqual(["a.md"]);
    });

    it("removes a departed note immediately when the reader has asked for reduced motion (https://github.com/Brevilabs/obsidian-copilot-private/issues/362)", () => {
      const { result, rerender } = renderHook(
        ({ notes }: { notes: RelevantNoteEntry[] }) =>
          useRelevantNoteRowTransitions(notes, "Source.md", false),
        { initialProps: { notes: [entry("a.md"), entry("b.md")] } }
      );

      rerender({ notes: [entry("a.md")] });

      expect(paths(result.current.rows)).toEqual(["a.md"]);
    });

    it("shows a note that returns before its removal finished as present again", () => {
      const { result, rerender } = renderHook(
        ({ notes }: { notes: RelevantNoteEntry[] }) =>
          useRelevantNoteRowTransitions(notes, "Source.md", true),
        { initialProps: { notes: [entry("a.md"), entry("b.md")] } }
      );
      rerender({ notes: [entry("a.md")] });

      rerender({ notes: [entry("a.md"), entry("b.md")] });

      expect(paths(result.current.rows)).toEqual(["a.md", "b.md"]);
    });

    it("shows the results for a note the reader just opened at once (https://github.com/Brevilabs/obsidian-copilot-private/issues/362)", () => {
      const { result, rerender } = renderTransitions({
        notes: [entry("a.md"), entry("b.md")],
        sourceKey: "Source.md",
      });

      rerender({ notes: [entry("c.md")], sourceKey: "Other.md" });

      expect(paths(result.current.rows)).toEqual(["c.md"]);
      expect(entering(result.current.rows)).toEqual([]);
    });

    it("shows a list filling from empty at once rather than as an arrival (https://github.com/Brevilabs/obsidian-copilot-private/issues/362)", () => {
      const { result, rerender } = renderTransitions({ notes: [], sourceKey: "Source.md" });

      rerender({ notes: [entry("a.md")], sourceKey: "Source.md" });

      expect(entering(result.current.rows)).toEqual([]);
    });

    it("plays an arrival only for a note joining a list already on screen", () => {
      const { result, rerender } = renderTransitions({
        notes: [entry("a.md")],
        sourceKey: "Source.md",
      });

      rerender({ notes: [entry("a.md"), entry("b.md")], sourceKey: "Source.md" });

      expect(entering(result.current.rows)).toEqual(["b.md"]);
    });

    it("does not replay the arrival of a row that stays on screen through a re-rank", () => {
      const { result, rerender } = renderTransitions({
        notes: [entry("a.md")],
        sourceKey: "Source.md",
      });
      rerender({ notes: [entry("a.md"), entry("b.md")], sourceKey: "Source.md" });

      rerender({ notes: [entry("b.md"), entry("a.md")], sourceKey: "Source.md" });

      expect(entering(result.current.rows)).toEqual(["b.md"]);
    });

    it("slides a row that changed rank from its previous position", () => {
      const offsets = new Map<string, number>([
        ["a.md", 0],
        ["b.md", 48],
      ]);
      const animate = jest.fn();
      const nodeFor = (path: string) =>
        ({
          get offsetTop() {
            return offsets.get(path) ?? 0;
          },
          animate,
        }) as unknown as HTMLElement;

      const { result, rerender } = renderHook(
        ({ notes }: { notes: RelevantNoteEntry[] }) =>
          useRelevantNoteRowTransitions(notes, "Source.md", true),
        { initialProps: { notes: [entry("a.md"), entry("b.md")] } }
      );
      result.current.registerRow("a.md")(nodeFor("a.md"));
      result.current.registerRow("b.md")(nodeFor("b.md"));
      rerender({ notes: [entry("a.md"), entry("b.md")] });
      animate.mockClear();

      offsets.set("a.md", 48);
      offsets.set("b.md", 0);
      rerender({ notes: [entry("b.md"), entry("a.md")] });

      expect(animate).toHaveBeenCalledTimes(2);
      expect(animate.mock.calls[0][0]).toEqual([
        { transform: "translateY(-48px)" },
        { transform: "translateY(0px)" },
      ]);
    });

    it("leaves rows in place when the reader has asked for reduced motion", () => {
      const animate = jest.fn();
      let offsetTop = 0;
      const node = {
        get offsetTop() {
          return offsetTop;
        },
        animate,
      } as unknown as HTMLElement;

      const { result, rerender } = renderHook(
        ({ notes }: { notes: RelevantNoteEntry[] }) =>
          useRelevantNoteRowTransitions(notes, "Source.md", false),
        { initialProps: { notes: [entry("a.md"), entry("b.md")] } }
      );
      result.current.registerRow("a.md")(node);
      rerender({ notes: [entry("a.md"), entry("b.md")] });

      offsetTop = 48;
      rerender({ notes: [entry("b.md"), entry("a.md")] });

      expect(animate).not.toHaveBeenCalled();
    });
  });
});
