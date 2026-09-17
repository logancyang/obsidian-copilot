import {
  BLOCK_MOVED,
  CODE_BLOCK_LINE_CHANGE,
  FILE_CREATED,
  FILE_EMPTIED,
  FRONTMATTER_TAG_ADDED,
  FRONTMATTER_UNCHANGED_BODY_EDIT,
  NON_MARKDOWN_FILE,
} from "@/agentMode/ui/renderedDiff/fixtures";
import {
  buildRenderedDiffPlan,
  diffCodeLines,
  isMarkdownPath,
} from "@/agentMode/ui/renderedDiff/mergeMarkdown";

describe("mergeMarkdown", () => {
  describe("isMarkdownPath()", () => {
    it("accepts the note extensions Obsidian renders", () => {
      expect(isMarkdownPath("projects/Alpha/Project brief.md")).toBe(true);
      expect(isMarkdownPath("notes/README.markdown")).toBe(true);
    });

    it("rejects data files whose changed characters would disappear once rendered", () => {
      expect(isMarkdownPath("projects/Alpha/Board.canvas")).toBe(false);
      expect(isMarkdownPath("data/export.json")).toBe(false);
      expect(isMarkdownPath("Makefile")).toBe(false);
    });
  });

  describe("diffCodeLines()", () => {
    it("classifies every line of both sides without interpreting their content", () => {
      expect(diffCodeLines("one\ntwo\n", "one\ntwo changed\n")).toEqual([
        { change: "unchanged", text: "one" },
        { change: "deleted", text: "two" },
        { change: "inserted", text: "two changed" },
      ]);
    });

    it("returns nothing for two empty texts", () => {
      expect(diffCodeLines("", "")).toEqual([]);
    });
  });

  describe("buildRenderedDiffPlan()", () => {
    it("shows a non-Markdown file as a single verbatim line diff", () => {
      const plan = buildRenderedDiffPlan(NON_MARKDOWN_FILE.before, NON_MARKDOWN_FILE.after, {
        markdown: false,
      });

      expect(plan).toHaveLength(1);
      expect(plan[0].kind).toBe("code");
    });

    it("diffs frontmatter as a line diff ahead of the body so no marker touches its fence", () => {
      const plan = buildRenderedDiffPlan(FRONTMATTER_TAG_ADDED.before, FRONTMATTER_TAG_ADDED.after);

      expect(plan[0]).toEqual({
        kind: "code",
        lines: [
          { change: "unchanged", text: "---" },
          { change: "unchanged", text: "tags:" },
          { change: "unchanged", text: "  - project" },
          { change: "inserted", text: "  - rollout" },
          { change: "unchanged", text: "status: draft" },
          { change: "unchanged", text: "---" },
        ],
      });
      expect(plan[1]).toEqual({ kind: "markdown", markdown: "The pilot runs for six weeks." });
    });

    it("omits the frontmatter block entirely when the turn changed only the body", () => {
      const plan = buildRenderedDiffPlan(
        FRONTMATTER_UNCHANGED_BODY_EDIT.before,
        FRONTMATTER_UNCHANGED_BODY_EDIT.after
      );

      expect(plan.every((segment) => segment.kind !== "code")).toBe(true);
      expect(plan).toHaveLength(1);
    });

    it("diffs a fenced code block line by line instead of rendering it", () => {
      const plan = buildRenderedDiffPlan(
        CODE_BLOCK_LINE_CHANGE.before,
        CODE_BLOCK_LINE_CHANGE.after
      );

      expect(plan.map((segment) => segment.kind)).toEqual(["markdown", "code"]);
      expect(plan[1]).toEqual({
        kind: "code",
        lines: [
          { change: "unchanged", text: "```bash" },
          { change: "deleted", text: "npm run migrate --dry-run" },
          { change: "inserted", text: "npm run migrate --dry-run --verbose" },
          { change: "unchanged", text: "npm run verify" },
          { change: "unchanged", text: "```" },
        ],
      });
    });

    it("renders a created file as inserted blocks only", () => {
      const plan = buildRenderedDiffPlan(FILE_CREATED.before, FILE_CREATED.after);

      expect(
        plan.every((segment) => segment.kind === "block" && segment.change === "inserted")
      ).toBe(true);
    });

    it("renders an emptied file as deleted blocks only", () => {
      const plan = buildRenderedDiffPlan(FILE_EMPTIED.before, FILE_EMPTIED.after);

      expect(
        plan.every((segment) => segment.kind === "block" && segment.change === "deleted")
      ).toBe(true);
    });

    it("shows a moved block as a deletion where it was and an insertion where it went", () => {
      const plan = buildRenderedDiffPlan(BLOCK_MOVED.before, BLOCK_MOVED.after);

      expect(plan).toEqual([
        { kind: "block", change: "deleted", markdown: "Budget is fixed for the quarter." },
        {
          kind: "markdown",
          markdown: "The pilot runs for six weeks.\n\nWe report progress every Friday.",
        },
        { kind: "block", change: "inserted", markdown: "Budget is fixed for the quarter." },
      ]);
    });

    it("renders neighbouring Markdown blocks in one pass so their structure survives", () => {
      const plan = buildRenderedDiffPlan("# Alpha\n\n- One\n- Two\n", "# Alpha\n\n- One\n- Two\n");

      expect(plan).toEqual([{ kind: "markdown", markdown: "# Alpha\n\n- One\n- Two" }]);
    });

    it("returns nothing for a file that did not change", () => {
      expect(buildRenderedDiffPlan("", "")).toEqual([]);
    });
  });
});
