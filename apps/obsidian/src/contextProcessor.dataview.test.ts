import { ContextProcessor } from "@/contextProcessor";
import { DATAVIEW_BLOCK_TAG } from "@/constants";

jest.mock("@/logger");

function setPlugins(plugins: Record<string, unknown>): void {
  (window.app as unknown as { plugins: { plugins: Record<string, unknown> } }).plugins.plugins =
    plugins;
}

function installDataview(query: jest.Mock): void {
  setPlugins({ dataview: { api: { query } } });
}

function installDataviewResult(value: unknown): void {
  installDataview(jest.fn().mockResolvedValue({ successful: true, value }));
}

window.app = {
  plugins: {
    plugins: {},
  },
} as unknown as typeof window.app;

describe("contextProcessor", () => {
  describe("ContextProcessor", () => {
    let contextProcessor: ContextProcessor;

    beforeEach(() => {
      contextProcessor = ContextProcessor.getInstance(window.app);
      setPlugins({});
    });

    describe("processDataviewBlocks()", () => {
      it("replaces a dataview block with its original query and executed result", async () => {
        installDataviewResult({ type: "list", values: [{ path: "note1.md" }] });

        const result = await contextProcessor.processDataviewBlocks(
          '```dataview\nLIST WHERE contains(tags, "#project")\n```',
          "test.md"
        );

        expect(result).toContain(`<${DATAVIEW_BLOCK_TAG}>`);
        expect(result).toContain("<query_type>dataview</query_type>");
        expect(result).toContain(
          '<original_query>\nLIST WHERE contains(tags, "#project")\n</original_query>'
        );
        expect(result).toContain("<executed_result>\n- [[note1.md]]\n</executed_result>");
      });

      it.each([
        ["trailing spaces after the fence", "```dataview  \nLIST\n```"],
        ["a tab after the fence", "```dataview\t\nLIST\n```"],
        ["Windows CRLF line endings", "```dataview\r\nLIST\r\n```"],
      ])("matches a dataview block with %s", async (_label, content) => {
        installDataviewResult({ type: "list", values: [{ path: "note1.md" }] });

        const result = await contextProcessor.processDataviewBlocks(content, "test.md");

        expect(result).toContain("<query_type>dataview</query_type>");
        expect(result).toContain("[[note1.md]]");
      });

      it("keeps multi-line queries intact in the original query", async () => {
        installDataviewResult({ type: "list", values: [] });
        const content = `\`\`\`dataview
LIST
WHERE contains(tags, "#project")
  AND file.mtime > date(today) - dur(7 days)
SORT file.mtime DESC
\`\`\``;

        const result = await contextProcessor.processDataviewBlocks(content, "test.md");

        expect(result).toContain(
          '<original_query>\nLIST\nWHERE contains(tags, "#project")\n  AND file.mtime > date(today) - dur(7 days)\nSORT file.mtime DESC\n</original_query>'
        );
      });

      it("processes every dataview block in the note and keeps the surrounding text", async () => {
        installDataview(
          jest
            .fn()
            .mockResolvedValueOnce({
              successful: true,
              value: { type: "list", values: [{ path: "note1.md" }] },
            })
            .mockResolvedValueOnce({
              successful: true,
              value: { type: "list", values: [{ path: "note2.md" }] },
            })
        );
        const content =
          "# Before\n\n```dataview\nLIST\n```\n\nMiddle text\n\n```dataview\nLIST\n```\n\n# After\n";

        const result = await contextProcessor.processDataviewBlocks(content, "test.md");

        expect(result.match(new RegExp(`<${DATAVIEW_BLOCK_TAG}>`, "g"))).toHaveLength(2);
        expect(result).toContain("[[note1.md]]");
        expect(result).toContain("[[note2.md]]");
        expect(result).toContain("# Before");
        expect(result).toContain("Middle text");
        expect(result).toContain("# After");
      });

      it("formats LIST results as a bullet list of links", async () => {
        installDataviewResult({
          type: "list",
          values: [{ path: "note1.md" }, { path: "note2.md" }, { path: "note3.md" }],
        });

        const result = await contextProcessor.processDataviewBlocks(
          "```dataview\nLIST\n```",
          "test.md"
        );

        expect(result).toContain("- [[note1.md]]\n- [[note2.md]]\n- [[note3.md]]");
      });

      it("formats TABLE results as a Markdown table", async () => {
        installDataviewResult({
          type: "table",
          headers: ["File", "Size"],
          values: [
            [{ path: "note1.md" }, 100],
            [{ path: "note2.md" }, 200],
          ],
        });

        const result = await contextProcessor.processDataviewBlocks(
          "```dataview\nTABLE file.size\n```",
          "test.md"
        );

        expect(result).toContain(
          "| File | Size |\n| --- | --- |\n| [[note1.md]] | 100 |\n| [[note2.md]] | 200 |"
        );
      });

      it("formats TASK results as checkbox items reflecting completion", async () => {
        installDataviewResult({
          type: "task",
          values: [
            { text: "Task 1", completed: false },
            { text: "Task 2", completed: true },
          ],
        });

        const result = await contextProcessor.processDataviewBlocks(
          "```dataview\nTASK\n```",
          "test.md"
        );

        expect(result).toContain("- [ ] Task 1\n- [x] Task 2");
      });

      it("renders nested arrays of links as a comma-separated list item", async () => {
        installDataviewResult({
          type: "list",
          values: [[{ path: "note1.md" }, { path: "note2.md" }]],
        });

        const result = await contextProcessor.processDataviewBlocks(
          "```dataview\nLIST\n```",
          "test.md"
        );

        expect(result).toContain("- [[note1.md]], [[note2.md]]");
      });

      it("renders null and undefined list values as empty items", async () => {
        installDataviewResult({ type: "list", values: [null, { path: "note1.md" }, undefined] });

        const result = await contextProcessor.processDataviewBlocks(
          "```dataview\nLIST\n```",
          "test.md"
        );

        expect(result).toContain("<executed_result>\n- \n- [[note1.md]]\n- \n</executed_result>");
      });

      it("reports No results when the query returns no rows", async () => {
        installDataviewResult({ type: "list", values: [] });

        const result = await contextProcessor.processDataviewBlocks(
          "```dataview\nLIST WHERE false\n```",
          "test.md"
        );

        expect(result).toContain("<executed_result>\nNo results\n</executed_result>");
      });

      it("reports the Dataview error message when the query fails", async () => {
        installDataview(
          jest.fn().mockResolvedValue({ successful: false, error: "Invalid syntax" })
        );

        const result = await contextProcessor.processDataviewBlocks(
          "```dataview\nINVALID QUERY\n```",
          "test.md"
        );

        expect(result).toContain("<error>Invalid syntax</error>");
        expect(result).toContain("<original_query>\nINVALID QUERY\n</original_query>");
      });

      it("reports a timeout when the query takes longer than five seconds", async () => {
        jest.useFakeTimers();
        try {
          installDataview(jest.fn().mockReturnValue(new Promise(() => {})));

          const pending = contextProcessor.processDataviewBlocks(
            "```dataview\nLIST\n```",
            "test.md"
          );
          await jest.advanceTimersByTimeAsync(5000);

          expect(await pending).toContain("<error>Query timeout</error>");
        } finally {
          jest.useRealTimers();
        }
      });

      it("keeps dataviewjs blocks and marks their execution as unsupported without running a query", async () => {
        const query = jest.fn();
        installDataview(query);

        const result = await contextProcessor.processDataviewBlocks(
          "```dataviewjs\ndv.pages()\n```",
          "test.md"
        );

        expect(result).toContain("<query_type>dataviewjs</query_type>");
        expect(result).toContain("<original_query>\ndv.pages()\n</original_query>");
        expect(result).toContain("DataviewJS execution not yet supported");
        expect(query).not.toHaveBeenCalled();
      });

      it("returns the content unchanged when the Dataview plugin is not installed", async () => {
        const content = "```dataview\nLIST\n```";

        expect(await contextProcessor.processDataviewBlocks(content, "test.md")).toBe(content);
      });

      it("returns the content unchanged when the Dataview plugin exposes no API", async () => {
        setPlugins({ dataview: {} });
        const content = "```dataview\nLIST\n```";

        expect(await contextProcessor.processDataviewBlocks(content, "test.md")).toBe(content);
      });

      it("leaves non-dataview code blocks and plain text untouched", async () => {
        installDataviewResult({ type: "list", values: [] });
        const content = "Intro\n```javascript\nconst x = 1;\n```";

        expect(await contextProcessor.processDataviewBlocks(content, "test.md")).toBe(content);
      });
    });
  });
});
