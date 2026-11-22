import { SELECTED_TEXT_TAG, WEB_SELECTED_TEXT_TAG } from "@/constants";
import { ContextProcessor } from "@/contextProcessor";
import { NoteSelectedTextContext, WebSelectedTextContext } from "@/types/message";

const noteContext: NoteSelectedTextContext = {
  id: "note-1",
  sourceType: "note",
  content: "function fibonacci(n) {\n  return n <= 1 ? n : fibonacci(n-1) + fibonacci(n-2);\n}",
  noteTitle: "Algorithms",
  notePath: "dev/algorithms.md",
  startLine: 10,
  endLine: 12,
};

const webContext: WebSelectedTextContext = {
  id: "web-1",
  sourceType: "web",
  content: "# React Documentation\n\nReact is a JavaScript library for building user interfaces.",
  title: "React Docs",
  url: "https://react.dev/learn",
};

describe("contextProcessor", () => {
  describe("ContextProcessor", () => {
    let processor: ContextProcessor;

    beforeEach(() => {
      processor = ContextProcessor.getInstance(window.app);
    });

    describe("processSelectedTextContexts()", () => {
      it("formats a note selection with title, path, line range, and content", () => {
        const result = processor.processSelectedTextContexts([noteContext]);

        expect(result).toBe(
          `\n\n<${SELECTED_TEXT_TAG}>\n<title>Algorithms</title>\n<path>dev/algorithms.md</path>\n<start_line>10</start_line>\n<end_line>12</end_line>\n<content>\n${noteContext.content}\n</content>\n</${SELECTED_TEXT_TAG}>`
        );
      });

      it("formats a web selection with title, url, and content and no note fields", () => {
        const result = processor.processSelectedTextContexts([webContext]);

        expect(result).toBe(
          `\n\n<${WEB_SELECTED_TEXT_TAG}>\n<title>React Docs</title>\n<url>https://react.dev/learn</url>\n<content>\n${webContext.content}\n</content>\n</${WEB_SELECTED_TEXT_TAG}>`
        );
      });

      it("emits note and web selections in the order given", () => {
        const result = processor.processSelectedTextContexts([webContext, noteContext]);

        expect(result.indexOf(`<${WEB_SELECTED_TEXT_TAG}>`)).toBeGreaterThanOrEqual(0);
        expect(result.indexOf(`<${WEB_SELECTED_TEXT_TAG}>`)).toBeLessThan(
          result.indexOf(`<${SELECTED_TEXT_TAG}>`)
        );
      });

      it("escapes XML special characters in note title and path", () => {
        const result = processor.processSelectedTextContexts([
          { ...noteContext, noteTitle: "Test <Note>", notePath: "test/path&file.md" },
        ]);

        expect(result).toContain("<title>Test &lt;Note&gt;</title>");
        expect(result).toContain("<path>test/path&amp;file.md</path>");
      });

      it("escapes XML special characters in web title, url, and content", () => {
        const result = processor.processSelectedTextContexts([
          {
            ...webContext,
            title: "Page <Title>",
            url: "https://example.com/page?a=1&b=2",
            content: "Content with <html> tags",
          },
        ]);

        expect(result).toContain("<title>Page &lt;Title&gt;</title>");
        expect(result).toContain("<url>https://example.com/page?a=1&amp;b=2</url>");
        expect(result).toContain("Content with &lt;html&gt; tags");
      });

      it("includes a Reading view excerpt and path without unknown line tags (https://github.com/Brevilabs/obsidian-copilot-private/issues/597)", () => {
        const result = processor.processSelectedTextContexts([
          {
            id: "reading-excerpt",
            sourceType: "note",
            content: "Rendered note passage",
            noteTitle: "Research",
            notePath: "Projects/Research.md",
            startLine: 0,
            endLine: 0,
          },
        ]);

        expect(result).toContain("<path>Projects/Research.md</path>");
        expect(result).toContain("<content>\nRendered note passage\n</content>");
        expect(result).not.toContain("<start_line>");
        expect(result).not.toContain("<end_line>");
      });

      it("returns an empty string when there are no selections", () => {
        expect(processor.processSelectedTextContexts([])).toBe("");
        expect(processor.processSelectedTextContexts(undefined)).toBe("");
      });
    });
  });
});
