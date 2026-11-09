import { REVEAL_COMMIT_MS, REVEAL_LAG_MS, useSmoothedText } from "@/hooks/useSmoothedText";
import { act, renderHook } from "@testing-library/react";

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/886";
const DIAGRAM_ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/888";
const CHART = "```mermaid\nflowchart LR\n  A --> B\n```\n";
const words = (count: number, from = 0) =>
  Array.from({ length: count }, (_, index) => `word${from + index} `).join("");
const advance = (ms: number) => act(() => jest.advanceTimersByTime(ms));

describe("useSmoothedText", () => {
  describe("useSmoothedText()", () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it("shows finished text unchanged and the first streamed chunk without delay", () => {
      expect(renderHook(() => useSmoothedText("Saved reply.", false)).result.current).toBe(
        "Saved reply."
      );
      expect(renderHook(() => useSmoothedText("First words ", true)).result.current).toBe(
        "First words "
      );
    });

    it(`reveals a streamed burst progressively in whole words (${ISSUE})`, () => {
      const first = words(2);
      const burst = first + words(30, 2);
      const { result, rerender } = renderHook(({ text }) => useSmoothedText(text, true), {
        initialProps: { text: first },
      });
      rerender({ text: burst });
      expect(result.current).toBe(first);
      advance(20);
      const partial = result.current;
      expect(partial.length).toBeGreaterThan(first.length);
      expect(partial.length).toBeLessThan(burst.length);
      expect(burst.startsWith(partial)).toBe(true);
      expect(partial).toMatch(/ $/);
    });

    it(`catches up with any burst within the lag bound (${ISSUE})`, () => {
      const burst = words(400);
      const { result, rerender } = renderHook(({ text }) => useSmoothedText(text, true), {
        initialProps: { text: "" },
      });
      rerender({ text: burst });
      advance(REVEAL_LAG_MS + REVEAL_COMMIT_MS + 20);
      expect(result.current).toBe(burst);
    });

    it(`commits at most once per commit interval while revealing (${ISSUE})`, () => {
      let renders = 0;
      const burst = words(400);
      const { rerender } = renderHook(
        ({ text }) => {
          renders++;
          return useSmoothedText(text, true);
        },
        { initialProps: { text: "" } }
      );
      rerender({ text: burst });
      renders = 0;
      advance(1000);
      expect(renders).toBeLessThanOrEqual(Math.ceil(1000 / REVEAL_COMMIT_MS) + 1);
    });

    it(`keeps the commit cap and the lag bound while new chunks arrive every frame (${ISSUE})`, () => {
      const { result, rerender } = renderHook(({ text }) => useSmoothedText(text, true), {
        initialProps: { text: "" },
      });
      const commits = new Set<string>();
      let text = "";
      for (let chunk = 0; chunk < 60; chunk++) {
        text += words(10, chunk * 10);
        rerender({ text });
        advance(16);
        commits.add(result.current);
      }
      expect(commits.size).toBeLessThanOrEqual(Math.ceil((60 * 16) / REVEAL_COMMIT_MS) + 1);
      advance(REVEAL_LAG_MS + REVEAL_COMMIT_MS + 20);
      expect(result.current).toBe(text);
    });

    it(`holds an unfinished last word until a space arrives or streaming ends (${ISSUE})`, () => {
      const { result, rerender } = renderHook(
        ({ text, streaming }) => useSmoothedText(text, streaming),
        { initialProps: { text: "Open the ", streaming: true } }
      );
      rerender({ text: "Open the vault and conf", streaming: true });
      advance(500);
      expect(result.current).toBe("Open the vault and ");
      rerender({ text: "Open the vault and confirm", streaming: false });
      expect(result.current).toBe("Open the vault and confirm");
    });

    it(`reveals unspaced scripts one character at a time (${ISSUE})`, () => {
      const { result, rerender } = renderHook(({ text }) => useSmoothedText(text, true), {
        initialProps: { text: "你" },
      });
      rerender({ text: "你好世界朋友们今天" });
      advance(20);
      expect(result.current.length).toBeGreaterThan(1);
      expect(result.current.length).toBeLessThan(9);
      advance(REVEAL_LAG_MS + REVEAL_COMMIT_MS);
      expect(result.current).toBe("你好世界朋友们今天");
    });

    it(`keeps spaced scripts such as Korean whole-word, holding an unfinished word (${ISSUE})`, () => {
      const { result, rerender } = renderHook(({ text }) => useSmoothedText(text, true), {
        initialProps: { text: "안녕하세요 " },
      });
      rerender({ text: "안녕하세요 오늘은 좋은 날" });
      advance(500);
      expect(result.current).toBe("안녕하세요 오늘은 좋은 ");
    });

    it(`withholds a Mermaid block until its closing fence arrives (${DIAGRAM_ISSUE})`, () => {
      const intro = "Here is the flow:\n\n";
      const { result, rerender } = renderHook(({ text }) => useSmoothedText(text, true), {
        initialProps: { text: intro + CHART.slice(0, 30) },
      });
      expect(result.current).toBe(intro);
      rerender({ text: intro + CHART + "\nDone. " });
      for (let elapsed = 0; elapsed < 500; elapsed += 10) {
        advance(10);
        expect(result.current === intro || result.current.startsWith(intro + CHART)).toBe(true);
      }
      expect(result.current).toBe(intro + CHART + "\nDone. ");
    });

    it(`shows a withheld Mermaid block once streaming ends, even unclosed (${DIAGRAM_ISSUE})`, () => {
      const partial = "Flow:\n\n" + CHART.slice(0, 30);
      const { result, rerender } = renderHook(
        ({ text, streaming }) => useSmoothedText(text, streaming),
        { initialProps: { text: partial, streaming: true } }
      );
      rerender({ text: partial, streaming: false });
      expect(result.current).toBe(partial);
    });

    it(`keeps streaming other code blocks and Mermaid examples inside longer fences (${DIAGRAM_ISSUE})`, () => {
      const code = "Run:\n\n```ts\nconst a = 1;\n";
      expect(renderHook(() => useSmoothedText(code, true)).result.current).toBe(code);
      const example = "Syntax:\n\n````markdown\n" + CHART + "````\n\nAfter ";
      expect(renderHook(() => useSmoothedText(example, true)).result.current).toBe(example);
    });

    it(`treats a Mermaid block in a blockquote as finished once the blockquote ends (${DIAGRAM_ISSUE})`, () => {
      const quoted = "> ```mermaid\n> graph TD\n> A --> B\n";
      expect(renderHook(() => useSmoothedText(quoted, true)).result.current).toBe("");
      const after = quoted + "\nOutside explanation. ";
      expect(renderHook(() => useSmoothedText(after, true)).result.current).toBe(after);
    });

    it("shows the whole text at once when streaming ends or the text is replaced", () => {
      const { result, rerender } = renderHook(
        ({ text, streaming }) => useSmoothedText(text, streaming),
        { initialProps: { text: "Start ", streaming: true } }
      );
      rerender({ text: "Start " + words(100), streaming: true });
      rerender({ text: "Start " + words(100), streaming: false });
      expect(result.current).toBe("Start " + words(100));
      rerender({ text: "Regenerated answer ", streaming: true });
      expect(result.current).toBe("Regenerated answer ");
    });
  });
});
