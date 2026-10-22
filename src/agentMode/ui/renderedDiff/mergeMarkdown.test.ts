import {
  DEL_CLOSE,
  DEL_OPEN,
  INS_CLOSE,
  INS_OPEN,
} from "@/agentMode/ui/renderedDiff/applySentinels";
import {
  ADDED_LIST_ITEM,
  BLANK_LINE_ADDED,
  BLOCK_MOVED,
  CODE_BLOCK_LINE_CHANGE,
  CRLF_TO_LF_CONVERSION,
  FILE_CREATED,
  FILE_EMPTIED,
  FRONTMATTER_TAG_ADDED,
  FRONTMATTER_UNCHANGED_BODY_EDIT,
  INNER_SPACE_WIDENED,
  LIST_HEAD_REMOVED,
  LIST_ITEM_WITH_CODE_EDIT,
  LOOSE_LIST_ITEM_EDIT,
  NON_MARKDOWN_FILE,
  ORDERED_LIST_ITEM_APPENDED,
  REMOVED_LIST_ITEM,
  SPACED_WORDING_CHANGE,
  TABLE_CELL_EDIT,
  TABLE_COLUMN_ADDED,
  TASK_CHECKBOX_TOGGLED,
  TASK_LIST_REORDERED,
  UNCHANGED_HEADING_AND_LIST,
} from "@/agentMode/ui/renderedDiff/testing/fixtures";
import {
  buildRenderedDiffPlan,
  diffCodeLines,
  isMarkdownPath,
} from "@/agentMode/ui/renderedDiff/mergeMarkdown";
import { appParsingRecordedFixtures } from "@/agentMode/ui/renderedDiff/testing/fixtureParserApp";
import { logWarn } from "@/logger";
import type { App } from "obsidian";

jest.mock("@/logger", () => ({ logWarn: jest.fn() }));

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

    it("shows an added final newline without losing the unterminated original line (https://github.com/Brevilabs/obsidian-copilot-private/issues/349)", () => {
      expect(diffCodeLines('{"ready":true}', '{"ready":true}\n')).toEqual([
        { change: "deleted", text: '{"ready":true}' },
        { change: "deleted", text: "\\ No newline at end of file" },
        { change: "inserted", text: '{"ready":true}' },
      ]);
    });

    it("shows a removed final newline without losing the unterminated replacement line (https://github.com/Brevilabs/obsidian-copilot-private/issues/349)", () => {
      expect(diffCodeLines('{"ready":true}\n', '{"ready":true}')).toEqual([
        { change: "deleted", text: '{"ready":true}' },
        { change: "inserted", text: '{"ready":true}' },
        { change: "inserted", text: "\\ No newline at end of file" },
      ]);
    });

    it("preserves unchanged and edited unterminated lines without inventing a newline change (https://github.com/Brevilabs/obsidian-copilot-private/issues/349)", () => {
      expect(diffCodeLines("same", "same")).toEqual([{ change: "unchanged", text: "same" }]);
      expect(diffCodeLines("context\nold", "context\nnew")).toEqual([
        { change: "unchanged", text: "context" },
        { change: "deleted", text: "old" },
        { change: "inserted", text: "new" },
      ]);
    });
  });

  describe("buildRenderedDiffPlan()", () => {
    const app = appParsingRecordedFixtures();

    it("preserves raw markers in an unchanged note verbatim without highlighting them (https://github.com/Brevilabs/obsidian-copilot-private/issues/348)", async () => {
      const text = "Keep \uE000 literal \uE003.";
      expect(await buildRenderedDiffPlan(app, text, text, true)).toEqual([
        { kind: "code", lines: [{ change: "unchanged", text }] },
      ]);
    });

    it("preserves raw markers in a changed note as verbatim changed lines (https://github.com/Brevilabs/obsidian-copilot-private/issues/348)", async () => {
      const marked = "\uE000added\uE001\uE002removed\uE003";
      expect(await buildRenderedDiffPlan(app, marked, "plain", true)).toEqual([
        {
          kind: "code",
          lines: [
            { change: "deleted", text: marked },
            { change: "inserted", text: "plain" },
          ],
        },
      ]);
    });

    it("renders a CRLF-to-LF conversion as unchanged instead of marking every line changed (https://github.com/Brevilabs/obsidian-copilot-private/issues/348)", async () => {
      const { before, after } = CRLF_TO_LF_CONVERSION;

      expect(await buildRenderedDiffPlan(app, before, after, true)).toEqual([
        { kind: "markdown", markdown: "# Alpha\n\nBody" },
      ]);
    });

    it("falls back to a verbatim line diff when the only change is blank lines rendering would hide (https://github.com/Brevilabs/obsidian-copilot-private/issues/348)", async () => {
      expect(
        await buildRenderedDiffPlan(app, BLANK_LINE_ADDED.before, BLANK_LINE_ADDED.after, true)
      ).toEqual([
        {
          kind: "code",
          lines: [
            { change: "unchanged", text: "Alpha" },
            { change: "unchanged", text: "" },
            { change: "inserted", text: "" },
            { change: "unchanged", text: "Beta" },
          ],
        },
      ]);
    });

    it("falls back to a verbatim line diff when the only marks wrap spaces rendering would hide (https://github.com/Brevilabs/obsidian-copilot-private/issues/348)", async () => {
      const { before, after } = INNER_SPACE_WIDENED;

      expect(await buildRenderedDiffPlan(app, before, after, true)).toEqual([
        {
          kind: "code",
          lines: [
            { change: "deleted", text: "The pilot runs." },
            { change: "inserted", text: "The pilot  runs." },
            { change: "unchanged", text: "We report weekly." },
          ],
        },
      ]);
    });

    it("shows a shape-preserving table edit as one merged table with the changed cell marked", async () => {
      expect(
        await buildRenderedDiffPlan(app, TABLE_CELL_EDIT.before, TABLE_CELL_EDIT.after, true)
      ).toEqual([
        {
          kind: "markdown",
          markdown: `| Region | Partners | Status |\n| --- | --- | --- |\n| EMEA | ${DEL_OPEN}2${DEL_CLOSE}${INS_OPEN}3${INS_CLOSE} | Ready |\n| APAC | 1 | Blocked |`,
        },
      ]);
    });

    it("shows a table whose column count changed as the old table removed and the new one added", async () => {
      const { before, after } = TABLE_COLUMN_ADDED;

      expect(await buildRenderedDiffPlan(app, before, after, true)).toEqual([
        {
          kind: "block",
          change: "deleted",
          markdown: "| Region | Partners |\n| --- | --- |\n| EMEA | 2 |",
        },
        {
          kind: "block",
          change: "inserted",
          markdown: "| Region | Partners | Status |\n| --- | --- | --- |\n| EMEA | 2 | Ready |",
        },
      ]);
    });

    it("shows a non-Markdown file as a single verbatim line diff", async () => {
      const plan = await buildRenderedDiffPlan(
        app,
        NON_MARKDOWN_FILE.before,
        NON_MARKDOWN_FILE.after,
        false
      );

      expect(plan).toHaveLength(1);
      expect(plan[0].kind).toBe("code");
    });

    it("diffs frontmatter as a line diff ahead of the body so no marker touches its fence", async () => {
      const plan = await buildRenderedDiffPlan(
        app,
        FRONTMATTER_TAG_ADDED.before,
        FRONTMATTER_TAG_ADDED.after,
        true
      );

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

    it("omits the frontmatter block entirely when the turn changed only the body", async () => {
      const plan = await buildRenderedDiffPlan(
        app,
        FRONTMATTER_UNCHANGED_BODY_EDIT.before,
        FRONTMATTER_UNCHANGED_BODY_EDIT.after,
        true
      );

      expect(plan.every((segment) => segment.kind !== "code")).toBe(true);
      expect(plan).toHaveLength(1);
    });

    it("diffs a fenced code block line by line instead of rendering it", async () => {
      const plan = await buildRenderedDiffPlan(
        app,
        CODE_BLOCK_LINE_CHANGE.before,
        CODE_BLOCK_LINE_CHANGE.after,
        true
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

    it("renders a created file as one inserted region so its paragraph gaps stay inside one highlight and its list stays one list (https://github.com/Brevilabs/obsidian-copilot-private/issues/751)", async () => {
      const plan = await buildRenderedDiffPlan(app, FILE_CREATED.before, FILE_CREATED.after, true);

      expect(plan).toEqual([
        {
          kind: "block",
          change: "inserted",
          markdown:
            "# Migration review\n\nAttendees: Ana, Bo, Kit.\n\n- Runbook is drafted\n- Rollback still open",
        },
      ]);
    });

    it("renders an emptied file as deleted blocks only", async () => {
      const plan = await buildRenderedDiffPlan(app, FILE_EMPTIED.before, FILE_EMPTIED.after, true);

      expect(
        plan.every((segment) => segment.kind === "block" && segment.change === "deleted")
      ).toBe(true);
    });

    it("shows a moved block as a deletion where it was and an insertion where it went", async () => {
      const plan = await buildRenderedDiffPlan(app, BLOCK_MOVED.before, BLOCK_MOVED.after, true);

      expect(plan).toEqual([
        { kind: "block", change: "deleted", markdown: "Budget is fixed for the quarter." },
        {
          kind: "markdown",
          markdown: "The pilot runs for six weeks.\n\nWe report progress every Friday.",
        },
        { kind: "block", change: "inserted", markdown: "Budget is fixed for the quarter." },
      ]);
    });

    it("renders neighbouring Markdown blocks in one pass so their structure survives", async () => {
      const { before, after } = UNCHANGED_HEADING_AND_LIST;
      const plan = await buildRenderedDiffPlan(app, before, after, true);

      expect(plan).toEqual([{ kind: "markdown", markdown: "# Alpha\n\n- One\n- Two" }]);
    });

    it("keeps each blank line past the first between blocks as a line break inside the same Markdown, so reference links and footnotes still resolve across them (https://github.com/Brevilabs/obsidian-copilot-private/issues/751)", async () => {
      const { before, after } = SPACED_WORDING_CHANGE;

      expect(await buildRenderedDiffPlan(app, before, after, true)).toEqual([
        {
          kind: "markdown",
          markdown: [
            "# Alpha pilot",
            '<div aria-hidden="true"><br><br></div>',
            `The pilot runs for ${DEL_OPEN}six${DEL_CLOSE}${INS_OPEN}eight${INS_CLOSE} weeks.`,
            '<div aria-hidden="true"><br></div>',
            "We report progress every Friday.",
          ].join("\n\n"),
        },
      ]);
    });

    it("shows an appended list item as that inserted item below the unchanged items", async () => {
      const { before, after } = ADDED_LIST_ITEM;

      expect(await buildRenderedDiffPlan(app, before, after, true)).toEqual([
        {
          kind: "markdown",
          markdown: "- Who owns the migration runbook?\n- What does the rollback look like?",
        },
        {
          kind: "block",
          change: "inserted",
          markdown: "- How long do we keep the old index?",
          continuesList: true,
        },
      ]);
    });

    it("shows a removed middle list item as that deleted item between the items that stay", async () => {
      const { before, after } = REMOVED_LIST_ITEM;

      expect(await buildRenderedDiffPlan(app, before, after, true)).toEqual([
        { kind: "markdown", markdown: "- Who owns the migration runbook?" },
        {
          kind: "block",
          change: "deleted",
          markdown: "- Do we still need the staging vault?",
          continuesList: true,
        },
        { kind: "markdown", markdown: "- What does the rollback look like?", continuesList: true },
      ]);
    });

    it("shows a removed first list item as that deleted item above the unchanged remainder", async () => {
      const { before, after } = LIST_HEAD_REMOVED;

      expect(await buildRenderedDiffPlan(app, before, after, true)).toEqual([
        { kind: "markdown", markdown: "Questions:" },
        { kind: "block", change: "deleted", markdown: "- One" },
        { kind: "markdown", markdown: "- Two" },
      ]);
    });

    it("shows a reordered task list as the moved task inserted where it went and deleted where it was", async () => {
      const { before, after } = TASK_LIST_REORDERED;

      expect(await buildRenderedDiffPlan(app, before, after, true)).toEqual([
        { kind: "block", change: "inserted", markdown: "- [ ] Send the invite" },
        {
          kind: "markdown",
          markdown: "- [ ] Draft the migration runbook\n- [ ] Book the review slot",
          continuesList: true,
        },
        {
          kind: "block",
          change: "deleted",
          markdown: "- [ ] Send the invite",
          continuesList: true,
        },
      ]);
    });

    it("keeps one rendered list when a toggled task sits among unchanged tasks", async () => {
      const { before, after } = TASK_CHECKBOX_TOGGLED;

      expect(await buildRenderedDiffPlan(app, before, after, true)).toEqual([
        {
          kind: "markdown",
          markdown: `- [ ] ${DEL_OPEN}Draft the migration runbook${DEL_CLOSE}\n- [x] ${INS_OPEN}Draft the migration runbook${INS_CLOSE}\n- [ ] Book the review slot`,
        },
      ]);
    });

    it("keeps ordered-list numbers by joining the unchanged items and numbering the appended one itself", async () => {
      const { before, after } = ORDERED_LIST_ITEM_APPENDED;

      expect(await buildRenderedDiffPlan(app, before, after, true)).toEqual([
        { kind: "markdown", markdown: "1. Draft\n2. Review\n3. Ship" },
        { kind: "block", change: "inserted", markdown: "4. Announce", continuesList: true },
      ]);
    });

    it("shows a changed list item holding a fenced code block as a line diff of that item while the next item stays rendered", async () => {
      const { before, after } = LIST_ITEM_WITH_CODE_EDIT;

      expect(await buildRenderedDiffPlan(app, before, after, true)).toEqual([
        {
          kind: "code",
          lines: [
            { change: "unchanged", text: "- Run the checks:" },
            { change: "unchanged", text: "  ```bash" },
            { change: "deleted", text: "  npm run verify" },
            { change: "inserted", text: "  npm run verify --strict" },
            { change: "unchanged", text: "  ```" },
          ],
        },
        { kind: "markdown", markdown: "- Ship the build", continuesList: true },
      ]);
    });

    it("keeps a loose list as one rendered block so its blank-line spacing survives (https://github.com/Brevilabs/obsidian-copilot-private/issues/348)", async () => {
      const { before, after } = LOOSE_LIST_ITEM_EDIT;

      expect(await buildRenderedDiffPlan(app, before, after, true)).toEqual([
        {
          kind: "markdown",
          markdown: `- Who owns the runbook?\n\n- What does the rollback look ${DEL_OPEN}like?${DEL_CLOSE}${INS_OPEN}like today?${INS_CLOSE}`,
        },
      ]);
    });

    it("returns one shared frozen empty plan for two empty texts, Markdown or not", async () => {
      const markdownPlan = await buildRenderedDiffPlan(app, "", "", true);
      const verbatimPlan = await buildRenderedDiffPlan(app, null, null, false);

      expect(markdownPlan).toEqual([]);
      expect(Object.isFrozen(markdownPlan)).toBe(true);
      expect(verbatimPlan).toBe(markdownPlan);
    });

    it("shows a verbatim line diff and logs a warning when Obsidian's parser rejects (https://github.com/Brevilabs/obsidian-copilot-private/issues/348)", async () => {
      const failure = new Error("parser unavailable");
      const rejectingApp = {
        metadataCache: { computeMetadataAsync: jest.fn().mockRejectedValue(failure) },
      } as unknown as App;

      const plan = await buildRenderedDiffPlan(
        rejectingApp,
        TABLE_CELL_EDIT.before,
        TABLE_CELL_EDIT.after,
        true
      );

      expect(plan).toEqual([
        {
          kind: "code",
          lines: [
            { change: "unchanged", text: "| Region | Partners | Status |" },
            { change: "unchanged", text: "| --- | --- | --- |" },
            { change: "deleted", text: "| EMEA | 2 | Ready |" },
            { change: "inserted", text: "| EMEA | 3 | Ready |" },
            { change: "unchanged", text: "| APAC | 1 | Blocked |" },
          ],
        },
      ]);
      expect(logWarn).toHaveBeenCalledWith(expect.stringContaining("line diff"), failure);
    });
  });
});
