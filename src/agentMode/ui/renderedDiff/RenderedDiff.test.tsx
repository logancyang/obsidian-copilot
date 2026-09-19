import {
  ADDED_LIST_ITEM,
  BLOCK_MOVED,
  CJK_EDIT,
  CODE_BLOCK_LINE_CHANGE,
  FILE_CREATED,
  FILE_EMPTIED,
  FRONTMATTER_TAG_ADDED,
  FRONTMATTER_UNCHANGED_BODY_EDIT,
  HEADING_LEVEL_CHANGE,
  LINK_HREF_CHANGE,
  NON_MARKDOWN_FILE,
  REMOVED_LIST_ITEM,
  TABLE_CELL_EDIT,
  TABLE_ROW_ADDED,
  TABLE_ROW_REMOVED,
  TASK_CHECKBOX_TOGGLED,
  WHOLE_NOTE,
  WIKILINK_RENAME,
  WORDING_CHANGE,
  type RenderedDiffFixture,
} from "@/agentMode/ui/renderedDiff/fixtures";
import { DEL_CLOSE, INS_OPEN } from "@/agentMode/ui/renderedDiff/applySentinels";
import { RenderedDiff } from "@/agentMode/ui/renderedDiff/RenderedDiff";
import { AppContext } from "@/context";
import { renderMarkdown } from "@/utils/renderMarkdown";
import { act, render } from "@testing-library/react";
import { App } from "obsidian";
import * as React from "react";

jest.mock("@/utils/renderMarkdown", () => ({ renderMarkdown: jest.fn() }));

/**
 * A stand-in for Obsidian's renderer: it turns the subset of Markdown the
 * fixtures use into the same DOM shapes Obsidian produces — headings, lists with
 * task checkboxes, tables, links and code — and copies every other character
 * through as a text node. The sentinel post-pass only cares about text nodes and
 * element boundaries, so this is enough to assert what the reader will see
 * without running Obsidian.
 */
function renderStandIn(markdown: string, target: HTMLElement): void {
  const lines = markdown.split("\n");
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (line.trim() === "") {
      index++;
      continue;
    }
    const heading = /^(#{1,6}) /.exec(line);
    if (heading !== null) {
      const element = target.ownerDocument.createElement(`h${heading[1].length}`);
      appendInline(element, line.slice(heading[0].length));
      target.appendChild(element);
      index++;
      continue;
    }
    if (line.startsWith("```")) {
      const start = index;
      index++;
      while (index < lines.length && !lines[index].startsWith("```")) index++;
      const pre = target.ownerDocument.createElement("pre");
      pre.textContent = lines.slice(start + 1, index).join("\n");
      target.appendChild(pre);
      index++;
      continue;
    }
    if (line.includes("|")) {
      const start = index;
      while (index < lines.length && lines[index].includes("|")) index++;
      target.appendChild(buildTable(target.ownerDocument, lines.slice(start, index)));
      continue;
    }
    if (/^[-*+] /.test(line)) {
      const list = target.ownerDocument.createElement("ul");
      while (index < lines.length && /^[-*+] /.test(lines[index])) {
        list.appendChild(buildListItem(target.ownerDocument, lines[index].slice(2)));
        index++;
      }
      target.appendChild(list);
      continue;
    }
    const start = index;
    while (index < lines.length && isParagraphLine(lines[index])) index++;
    const paragraph = target.ownerDocument.createElement("p");
    appendInline(paragraph, lines.slice(start, index).join("\n"));
    target.appendChild(paragraph);
  }
}

function isParagraphLine(line: string): boolean {
  return (
    line.trim() !== "" &&
    !/^#{1,6} /.test(line) &&
    !/^[-*+] /.test(line) &&
    !line.startsWith("```") &&
    !line.includes("|")
  );
}

function buildListItem(doc: Document, content: string): HTMLElement {
  const item = doc.createElement("li");
  const task = /^\[([ xX])\] /.exec(content);
  if (task !== null) {
    const checkbox = doc.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = task[1] !== " ";
    item.appendChild(checkbox);
    appendInline(item, content.slice(task[0].length));
    return item;
  }
  appendInline(item, content);
  return item;
}

function buildTable(doc: Document, rows: readonly string[]): HTMLElement {
  const table = doc.createElement("table");
  const head = doc.createElement("thead");
  head.appendChild(buildRow(doc, rows[0], "th"));
  table.appendChild(head);
  const body = doc.createElement("tbody");
  for (const row of rows.slice(2)) body.appendChild(buildRow(doc, row, "td"));
  table.appendChild(body);
  return table;
}

function buildRow(doc: Document, row: string, cellTag: "th" | "td"): HTMLElement {
  const element = doc.createElement("tr");
  const cells = row.split("|").slice(1, -1);
  for (const cell of cells) {
    const cellElement = doc.createElement(cellTag);
    appendInline(cellElement, cell.trim());
    element.appendChild(cellElement);
  }
  return element;
}

const INLINE = /!?\[\[([^\]]*)\]\]|\[([^\]]*)\]\(([^)]*)\)|`([^`]*)`|\*\*([^*]*)\*\*/g;

function appendInline(target: HTMLElement, text: string): void {
  const doc = target.ownerDocument;
  let cursor = 0;
  INLINE.lastIndex = 0;
  for (let match = INLINE.exec(text); match !== null; match = INLINE.exec(text)) {
    if (match.index > cursor) {
      target.appendChild(doc.createTextNode(text.slice(cursor, match.index)));
    }
    target.appendChild(buildInlineElement(doc, match));
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) target.appendChild(doc.createTextNode(text.slice(cursor)));
}

function buildInlineElement(doc: Document, match: RegExpExecArray): HTMLElement {
  const [, wikilink, linkText, href, code, bold] = match;
  if (wikilink !== undefined) {
    const anchor = doc.createElement("a");
    anchor.className = "internal-link";
    anchor.setAttribute("data-href", wikilink);
    anchor.textContent = wikilink;
    return anchor;
  }
  if (linkText !== undefined) {
    const anchor = doc.createElement("a");
    anchor.setAttribute("href", href);
    anchor.textContent = linkText;
    return anchor;
  }
  if (code !== undefined) {
    const element = doc.createElement("code");
    element.textContent = code;
    return element;
  }
  const strong = doc.createElement("strong");
  strong.textContent = bold;
  return strong;
}

async function renderFixture(fixture: RenderedDiffFixture): Promise<HTMLElement> {
  const app = new App();
  const view = render(
    <AppContext.Provider value={app}>
      <RenderedDiff after={fixture.after} before={fixture.before} path={fixture.path} />
    </AppContext.Provider>
  );
  await act(async () => {
    await Promise.resolve();
  });
  return view.container;
}

const textOf = (root: HTMLElement, selector: string): string[] =>
  Array.from(root.querySelectorAll(selector)).map((element) => element.textContent ?? "");

const SENTINEL = new RegExp(`[${INS_OPEN}-${DEL_CLOSE}]`);
const PRIVATE_USE = new RegExp(`[${String.fromCharCode(0xe000)}-${String.fromCharCode(0xf8ff)}]`);

const deletions = (root: HTMLElement): string[] => textOf(root, "del.copilot-diff-del");
const insertions = (root: HTMLElement): string[] => textOf(root, "ins.copilot-diff-ins");

describe("RenderedDiff", () => {
  beforeEach(() => {
    jest.mocked(renderMarkdown).mockReset();
    jest.mocked(renderMarkdown).mockImplementation(async (_app, markdown, target) => {
      renderStandIn(markdown, target);
    });
  });

  describe("RenderedDiff()", () => {
    it.each(["added", "removed"])(
      "shows the final newline being %s in a non-Markdown file with a missing-newline marker (https://github.com/Brevilabs/obsidian-copilot-private/issues/349)",
      async (direction) => {
        const text = '{"ready":true}';
        const root = await renderFixture({
          path: "config.json",
          before: direction === "added" ? text : `${text}\n`,
          after: direction === "added" ? `${text}\n` : text,
        });

        const marker = "\\ No newline at end of file";
        expect(textOf(root, "pre > div")).toEqual(
          direction === "added" ? [text, marker, text] : [text, text, marker]
        );
        expect(textOf(root, ".diff-line-del")).toEqual(
          direction === "added" ? [text, marker] : [text]
        );
        expect(textOf(root, ".diff-line-ins")).toEqual(
          direction === "removed" ? [text, marker] : [text]
        );
        expect(renderMarkdown).not.toHaveBeenCalled();
      }
    );

    it("preserves raw markers and unchanged content without invented highlights (https://github.com/Brevilabs/obsidian-copilot-private/issues/348)", async () => {
      const text = "# Literal \uE000addition\uE001 and \uE002deletion\uE003";
      const root = await renderFixture({ path: "Literal.md", before: text, after: text });

      expect(root.textContent).toBe(text);
      expect(textOf(root, "pre > div")).toEqual([text]);
      expect(root.querySelector("ins, del, .diff-line-ins, .diff-line-del")).toBeNull();
      expect(renderMarkdown).not.toHaveBeenCalled();
    });

    it("keeps raw markers verbatim while highlighting only changed lines (https://github.com/Brevilabs/obsidian-copilot-private/issues/348)", async () => {
      const unchanged = "Keep \uE000addition\uE001 and \uE002deletion\uE003 literal.";
      const root = await renderFixture({
        path: "Literal.md",
        before: `${unchanged}\nOld wording`,
        after: `${unchanged}\nNew wording`,
      });

      expect(textOf(root, "pre > div")).toEqual([unchanged, "Old wording", "New wording"]);
      expect(textOf(root, ".diff-line-del")).toEqual(["Old wording"]);
      expect(textOf(root, ".diff-line-ins")).toEqual(["New wording"]);
      expect(root.querySelector("ins, del")).toBeNull();
      expect(renderMarkdown).not.toHaveBeenCalled();
    });

    it("strikes the replaced words and highlights their replacements in place", async () => {
      const root = await renderFixture(WORDING_CHANGE);

      expect(deletions(root)).toEqual(["six", "two"]);
      expect(insertions(root)).toEqual(["eight", "three"]);
      expect(root.querySelector("p")?.textContent).toContain("We report progress every Friday.");
    });

    it("shows a re-levelled heading as both headings, the old one struck through", async () => {
      const root = await renderFixture(HEADING_LEVEL_CHANGE);

      expect(root.querySelector("h2 del.copilot-diff-del")?.textContent).toBe("Rollout plan");
      expect(root.querySelector("h3 ins.copilot-diff-ins")?.textContent).toBe("Rollout plan");
    });

    it("highlights an added list item while keeping it a list item", async () => {
      const root = await renderFixture(ADDED_LIST_ITEM);

      expect(root.querySelectorAll("li")).toHaveLength(3);
      expect(insertions(root)).toEqual(["How long do we keep the old index?"]);
      expect(deletions(root)).toEqual([]);
    });

    it("keeps a removed list item in place with its text struck through", async () => {
      const root = await renderFixture(REMOVED_LIST_ITEM);

      expect(root.querySelectorAll("li")).toHaveLength(3);
      expect(deletions(root)).toEqual(["Do we still need the staging vault?"]);
    });

    it("shows a ticked task as the unticked line removed and the ticked line added", async () => {
      const root = await renderFixture(TASK_CHECKBOX_TOGGLED);

      const boxes = Array.from(root.querySelectorAll<HTMLInputElement>("input[type=checkbox]"));
      expect(boxes.map((box) => box.checked)).toEqual([false, true, false]);
      expect(deletions(root)).toEqual(["Draft the migration runbook"]);
      expect(insertions(root)).toEqual(["Draft the migration runbook"]);
    });

    it("replaces a link whose URL changed while both versions still render as links", async () => {
      const root = await renderFixture(LINK_HREF_CHANGE);

      const anchors = Array.from(root.querySelectorAll("a"));
      expect(anchors.map((anchor) => anchor.getAttribute("href"))).toEqual([
        "https://example.com/checklists/v1",
        "https://example.com/checklists/v2",
      ]);
      expect(anchors[0].querySelector("del.copilot-diff-del")?.textContent).toBe(
        "rollout checklist"
      );
      expect(anchors[1].querySelector("ins.copilot-diff-ins")?.textContent).toBe(
        "rollout checklist"
      );
    });

    it("replaces a renamed wikilink and keeps both versions resolvable", async () => {
      const root = await renderFixture(WIKILINK_RENAME);

      const anchors = Array.from(root.querySelectorAll("a.internal-link"));
      expect(anchors.map((anchor) => anchor.getAttribute("data-href"))).toEqual([
        "Migration runbook",
        "Migration runbook 2026",
      ]);
      expect(deletions(root)).toEqual(["Migration runbook"]);
      expect(insertions(root)).toEqual(["Migration runbook 2026"]);
    });

    it("marks only the edited cell of a table and leaves its row untagged", async () => {
      const root = await renderFixture(TABLE_CELL_EDIT);

      expect(deletions(root)).toEqual(["2"]);
      expect(insertions(root)).toEqual(["3"]);
      expect(root.querySelector("tr.copilot-diff-row-del")).toBeNull();
      expect(root.querySelector("tr.copilot-diff-row-ins")).toBeNull();
    });

    it("tags an added table row as a whole while keeping the table columns intact", async () => {
      const root = await renderFixture(TABLE_ROW_ADDED);

      const row = root.querySelector("tr.copilot-diff-row-ins");
      expect(row?.querySelectorAll("td")).toHaveLength(3);
      expect(insertions(root)).toEqual(["AMER", "4", "Ready"]);
    });

    it("keeps a removed table row in the table and tags it as a whole", async () => {
      const root = await renderFixture(TABLE_ROW_REMOVED);

      expect(root.querySelectorAll("tbody tr")).toHaveLength(2);
      expect(root.querySelector("tr.copilot-diff-row-del")).not.toBeNull();
      expect(deletions(root)).toEqual(["APAC", "1", "Blocked"]);
    });

    it("shows a changed code line as a line diff rather than rendering it", async () => {
      const root = await renderFixture(CODE_BLOCK_LINE_CHANGE);

      const code = root.querySelector("pre.copilot-diff-code");
      expect(code?.querySelector(".diff-line-del")?.textContent).toBe("npm run migrate --dry-run");
      expect(code?.querySelector(".diff-line-ins")?.textContent).toBe(
        "npm run migrate --dry-run --verbose"
      );
    });

    it("shows an added frontmatter tag as a line diff above the body", async () => {
      const root = await renderFixture(FRONTMATTER_TAG_ADDED);

      expect(root.querySelector("pre.copilot-diff-code .diff-line-ins")?.textContent).toBe(
        "  - rollout"
      );
      expect(root.querySelector("p")?.textContent).toBe("The pilot runs for six weeks.");
    });

    it("shows no frontmatter block when the turn changed only the body", async () => {
      const root = await renderFixture(FRONTMATTER_UNCHANGED_BODY_EDIT);

      expect(root.querySelector("pre.copilot-diff-code")).toBeNull();
      expect(root.querySelector(".copilot-diff-del")?.textContent).toBe("six");
      expect(root.querySelector(".copilot-diff-ins")?.textContent).toBe("eight");
    });

    it("shows a moved block as a removed block where it was and an added block where it went", async () => {
      const root = await renderFixture(BLOCK_MOVED);

      expect(root.querySelector(".copilot-diff-block-del")?.textContent).toBe(
        "Budget is fixed for the quarter."
      );
      expect(root.querySelector(".copilot-diff-block-ins")?.textContent).toBe(
        "Budget is fixed for the quarter."
      );
    });

    it("diffs CJK prose per character because it carries no word spaces", async () => {
      const root = await renderFixture(CJK_EDIT);

      expect(deletions(root)).toEqual(["准备"]);
      expect(insertions(root)).toEqual(["验收"]);
    });

    it("presents a created file entirely as added blocks", async () => {
      const root = await renderFixture(FILE_CREATED);

      expect(root.querySelectorAll(".copilot-diff-block-del")).toHaveLength(0);
      expect(root.querySelectorAll(".copilot-diff-block-ins").length).toBeGreaterThan(0);
      expect(root.querySelector("h1")?.textContent).toBe("Migration review");
    });

    it("presents an emptied file entirely as removed blocks", async () => {
      const root = await renderFixture(FILE_EMPTIED);

      expect(root.querySelectorAll(".copilot-diff-block-ins")).toHaveLength(0);
      expect(root.querySelectorAll(".copilot-diff-block-del").length).toBeGreaterThan(0);
    });

    it("shows a non-Markdown file as a verbatim line diff and never renders it", async () => {
      const root = await renderFixture(NON_MARKDOWN_FILE);

      expect(root.querySelector("pre.copilot-diff-code")).not.toBeNull();
      expect(jest.mocked(renderMarkdown)).not.toHaveBeenCalled();
      expect(textOf(root, ".diff-line-ins")).toEqual([
        '    { "id": "a", "text": "Pilot" },',
        '    { "id": "b", "text": "Rollout" }',
      ]);
    });

    it("leaves no sentinel code point in the text of a document that exercises every block kind", async () => {
      const root = await renderFixture(WHOLE_NOTE);

      expect(PRIVATE_USE.test(root.textContent ?? "")).toBe(false);
      expect(root.querySelectorAll("table")).toHaveLength(1);
      expect(root.querySelector("h1")?.textContent).toBe("Alpha pilot");
      expect(deletions(root).length).toBeGreaterThan(0);
      expect(insertions(root).length).toBeGreaterThan(0);
    });

    it("never places a marker inside a URL or an inline code span", async () => {
      const root = await renderFixture({
        path: "notes/Guarantees.md",
        before: "Run `npm run verify` after [the checklist](https://example.com/v1).",
        after: "Run `npm run check` after [the checklist](https://example.com/v2).",
      });

      // Splitting on the markers proves each construct survives inside one
      // unmarked run, which is the guarantee the renderer depends on.
      const pieces = jest.mocked(renderMarkdown).mock.calls[0][1].split(SENTINEL);
      for (const construct of [
        "`npm run verify`",
        "`npm run check`",
        "[the checklist](https://example.com/v1)",
        "[the checklist](https://example.com/v2)",
      ]) {
        expect(pieces.some((piece) => piece.includes(construct))).toBe(true);
      }
      expect(root.querySelector("code")?.textContent).toBe("npm run verify");
    });
  });
});
