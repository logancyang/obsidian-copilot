import {
  BLOCK_MOVED,
  LOOSE_LIST_ITEM_EDIT,
  NON_MARKDOWN_FILE,
  TABLE_CELL_EDIT,
  TASK_BLOCK_INSERTED,
  TASK_CHECKBOX_TOGGLED,
  WORDING_CHANGE,
  type RenderedDiffFixture,
} from "@/agentMode/ui/renderedDiff/testing/fixtures";
import * as mergeMarkdown from "@/agentMode/ui/renderedDiff/mergeMarkdown";
import { appParsingRecordedFixtures } from "@/agentMode/ui/renderedDiff/testing/fixtureParserApp";
import {
  appParsing,
  type RecordedListItem,
} from "@/agentMode/ui/renderedDiff/testing/recordedParserApp";
import { RenderedDiff, type ChangeRun } from "@/agentMode/ui/renderedDiff/RenderedDiff";
import { AppContext } from "@/context";
import { renderMarkdown } from "@/utils/renderMarkdown";
import { act, render, waitFor } from "@testing-library/react";
import type { App } from "obsidian";
import * as React from "react";

jest.mock("@/utils/renderMarkdown", () => ({ renderMarkdown: jest.fn() }));

const recordedApp = appParsingRecordedFixtures();

function diffElement(
  fixture: RenderedDiffFixture,
  app: App = recordedApp,
  onChangeRuns?: (runs: readonly ChangeRun[]) => void
): React.ReactElement {
  return (
    <AppContext.Provider value={app}>
      <RenderedDiff
        after={fixture.after}
        before={fixture.before}
        path={fixture.path}
        onChangeRuns={onChangeRuns}
      />
    </AppContext.Provider>
  );
}

function renderBlocks(markdown: string, target: HTMLElement): void {
  const doc = target.ownerDocument;
  const element = (tag: string, text = ""): HTMLElement =>
    Object.assign(doc.createElement(tag), { textContent: text });
  for (const line of markdown.split("\n")) {
    const last = target.lastElementChild;
    if (line.startsWith("  - ")) {
      const parent = last?.lastElementChild;
      const list = parent?.querySelector(":scope > ul") ?? parent?.appendChild(element("ul"));
      list?.append(element("li", line.slice(4)));
    } else if (line.startsWith("- ")) {
      const list = last?.tagName === "UL" ? last : target.appendChild(element("ul"));
      list.append(element("li", line.slice(2)));
    } else if (line.startsWith(">")) {
      const quote =
        last?.tagName === "BLOCKQUOTE" ? last : target.appendChild(element("blockquote"));
      if (line.length > 1) quote.append(element("p", line.slice(2)));
    } else if (/^\|[\s|-]+\|$/.test(line)) {
      continue;
    } else if (line.startsWith("|")) {
      const table = last?.tagName === "TABLE" ? last : target.appendChild(element("table"));
      const body = table.querySelector("tbody") ?? table.appendChild(element("tbody"));
      const row = body.appendChild(element("tr"));
      for (const cell of line.split("|").slice(1, -1)) row.append(element("td", cell.trim()));
    } else if (line.trim() !== "") {
      target.append(element("p", line));
    }
  }
}

async function reportedRuns(
  fixture: RenderedDiffFixture,
  app: App = recordedApp
): Promise<readonly ChangeRun[]> {
  const onChangeRuns = jest.fn();
  render(diffElement(fixture, app, onChangeRuns));
  await waitFor(() => expect(onChangeRuns).toHaveBeenCalled());
  return onChangeRuns.mock.calls[0][0];
}

const runSummary = (runs: readonly ChangeRun[]): [string, string[]][] =>
  runs.map((run) => [run.kind, run.blocks.map((block) => block.element.textContent ?? "")]);

function appHoldingParse(source: string): { app: App; release: () => void } {
  let release!: () => void;
  const until = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { app: appParsingRecordedFixtures({ source, until }), release };
}

const textOf = (root: HTMLElement, selector: string): string[] =>
  Array.from(root.querySelectorAll(selector)).map((element) => element.textContent ?? "");

describe("RenderedDiff", () => {
  beforeEach(() => {
    jest.mocked(renderMarkdown).mockReset();
    jest.mocked(renderMarkdown).mockImplementation(async (_app, markdown, target) => {
      renderBlocks(markdown, target);
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("RenderedDiff()", () => {
    it("marks the replaced and replacing words inside a changed Markdown block", async () => {
      const { container } = render(diffElement(WORDING_CHANGE));

      await waitFor(() => expect(textOf(container, "del")).toEqual(["six", "two"]));
      expect(textOf(container, "ins")).toEqual(["eight", "three"]);
    });

    it("frames a moved block as a struck-through deleted block where it was and an inserted block where it went", async () => {
      const { container } = render(diffElement(BLOCK_MOVED));

      await waitFor(() =>
        expect(textOf(container, "[data-change=deleted]")).toEqual([
          "Budget is fixed for the quarter.",
        ])
      );
      expect(textOf(container, "[data-change=inserted]")).toEqual([
        "Budget is fixed for the quarter.",
      ]);
      const deleted = container.querySelector("[data-change=deleted]")!;
      const inserted = container.querySelector("[data-change=inserted]")!;
      expect(deleted.classList).toContain("tw-line-through");
      expect(deleted.classList).toContain("tw-bg-error");
      expect(inserted.classList).toContain("tw-bg-success");
    });

    it("shows a non-Markdown file as tinted verbatim lines without rendering it as Markdown", async () => {
      const { container } = render(diffElement(NON_MARKDOWN_FILE));

      await waitFor(() => expect(container.querySelector("pre")).not.toBeNull());
      const inserted = Array.from(container.querySelectorAll("pre [data-change=inserted]"));
      expect(inserted.map((line) => line.textContent)).toEqual([
        '    { "id": "a", "text": "Pilot" },',
        '    { "id": "b", "text": "Rollout" }',
      ]);
      expect(inserted.every((line) => line.classList.contains("tw-bg-success"))).toBe(true);
      expect(
        Array.from(container.querySelectorAll("pre [data-change=deleted]")).every((line) =>
          line.classList.contains("tw-bg-error")
        )
      ).toBe(true);
      expect(renderMarkdown).not.toHaveBeenCalled();
    });

    it.each([
      ["a changed task list", TASK_CHECKBOX_TOGGLED],
      ["an inserted task block", TASK_BLOCK_INSERTED],
    ])(
      "disables the task checkboxes in %s so a click cannot rewrite the note https://github.com/Brevilabs/obsidian-copilot-private/issues/348",
      async (_name, fixture) => {
        jest.mocked(renderMarkdown).mockImplementation(async (_app, markdown, target) => {
          const box = target.ownerDocument.createElement("input");
          box.type = "checkbox";
          target.append(box, markdown);
        });
        const { container } = render(diffElement(fixture));

        await waitFor(() =>
          expect(container.querySelector<HTMLInputElement>("input[type=checkbox]")?.disabled).toBe(
            true
          )
        );
        const boxes = Array.from(container.querySelectorAll<HTMLInputElement>("input"));
        expect(boxes.every((box) => box.disabled)).toBe(true);
      }
    );

    it("reports a paragraph whose words were both replaced as one modified change", async () => {
      const runs = await reportedRuns(WORDING_CHANGE);

      expect(runSummary(runs)).toEqual([
        ["modified", ["The pilot runs for sixeight weeks with twothree design partners."]],
      ]);
    });

    it("reports a moved block as a deleted change where it was and a separate inserted change where it went", async () => {
      const runs = await reportedRuns(BLOCK_MOVED);

      expect(runSummary(runs)).toEqual([
        ["deleted", ["Budget is fixed for the quarter."]],
        ["inserted", ["Budget is fixed for the quarter."]],
      ]);
    });

    it("groups adjacent changed lines of a verbatim file into one change", async () => {
      const runs = await reportedRuns(NON_MARKDOWN_FILE);

      expect(runSummary(runs)).toEqual([
        [
          "modified",
          [
            '    { "id": "a", "text": "Pilot" }',
            '    { "id": "a", "text": "Pilot" },',
            '    { "id": "b", "text": "Rollout" }',
          ],
        ],
      ]);
    });

    it("reports changed lines separated by an unchanged line as two changes", async () => {
      const runs = await reportedRuns({
        path: "config/regions.txt",
        before: "emea\napac\namer\n",
        after: "EMEA\napac\nAMER\n",
      });

      expect(runs.map((run) => run.blocks.length)).toEqual([2, 2]);
    });

    it.each([
      [
        "list item",
        LOOSE_LIST_ITEM_EDIT,
        [["modified", ["What does the rollback look like?like today?"]]],
      ],
      ["table row", TABLE_CELL_EDIT, [["modified", ["EMEA23Ready"]]]],
    ])(
      "marks only the changed %s rather than its whole list or table so the change sits beside the right line (https://github.com/Brevilabs/obsidian-copilot-private/issues/709)",
      async (_name, fixture, expected) => {
        const runs = await reportedRuns(fixture);

        expect(runSummary(runs)).toEqual(expected);
      }
    );

    it("marks each edited nested list item rather than the top-level item that holds them (https://github.com/Brevilabs/obsidian-copilot-private/issues/709)", async () => {
      const before =
        "- Launch plan\n  - Draft the runbook\n  - Book the review\n  - Send the invite\n";
      const after =
        "- Launch plan\n  - Draft the runbook today\n  - Book the review\n  - Send the invite now\n";
      const items: RecordedListItem[] = [
        [0, 0, -1],
        [1, 1, 0],
        [2, 2, 0],
        [3, 3, 0],
      ];

      const runs = await reportedRuns(
        { path: "projects/Alpha/Launch.md", before, after },
        appParsing({ sections: [["list", 0, 3]], listItems: items })
      );

      expect(runSummary(runs)).toEqual([
        ["inserted", ["Draft the runbook today"]],
        ["inserted", ["Send the invite now"]],
      ]);
    });

    it("marks each edited paragraph of a quote rather than the whole quote (https://github.com/Brevilabs/obsidian-copilot-private/issues/709)", async () => {
      const before =
        "> The pilot runs six weeks.\n>\n> Partners join in May.\n>\n> Budget is fixed.\n";
      const after =
        "> The pilot runs eight weeks.\n>\n> Partners join in May.\n>\n> Budget is final.\n";

      const runs = await reportedRuns(
        { path: "projects/Alpha/Brief.md", before, after },
        appParsing({ sections: [["blockquote", 0, 4]] })
      );

      expect(runSummary(runs)).toEqual([
        ["modified", ["The pilot runs sixeight weeks."]],
        ["modified", ["Budget is fixed.final."]],
      ]);
    });

    it("reports changes only once every rendered section has finished rendering (https://github.com/Brevilabs/obsidian-copilot-private/issues/709)", async () => {
      let releaseLast!: () => void;
      const lastRendered = new Promise<void>((resolve) => {
        releaseLast = resolve;
      });
      jest.mocked(renderMarkdown).mockImplementation(async (_app, markdown, target) => {
        if (
          markdown === "Budget is fixed for the quarter." &&
          target.parentElement?.dataset.change === "inserted"
        ) {
          await lastRendered;
        }
        renderBlocks(markdown, target);
      });
      const onChangeRuns = jest.fn();
      const { container } = render(diffElement(BLOCK_MOVED, recordedApp, onChangeRuns));
      await waitFor(() => expect(textOf(container, "[data-change=deleted] p")).toHaveLength(1));
      expect(onChangeRuns).not.toHaveBeenCalled();

      await act(async () => {
        releaseLast();
        await lastRendered;
      });

      await waitFor(() => expect(onChangeRuns).toHaveBeenCalledTimes(1));
      expect(runSummary(onChangeRuns.mock.calls[0][0])).toEqual([
        ["deleted", ["Budget is fixed for the quarter."]],
        ["inserted", ["Budget is fixed for the quarter."]],
      ]);
    });

    it("keeps the diff plan when re-rendered with the same file contents and path", async () => {
      const build = jest.spyOn(mergeMarkdown, "buildRenderedDiffPlan");
      const { container, rerender } = render(diffElement(NON_MARKDOWN_FILE));
      await waitFor(() => expect(container.querySelector("pre")).not.toBeNull());

      rerender(diffElement({ ...NON_MARKDOWN_FILE }));

      expect(build).toHaveBeenCalledTimes(1);
    });

    it("renders nothing until Obsidian's parser has produced the plan", async () => {
      const { app, release } = appHoldingParse(WORDING_CHANGE.before!);
      const { container } = render(diffElement(WORDING_CHANGE, app));

      expect(container.firstChild).toBeNull();

      release();
      await waitFor(() => expect(textOf(container, "del")).toEqual(["six", "two"]));
    });

    it("ignores a plan that finishes after the props moved to another file", async () => {
      const { app, release } = appHoldingParse(WORDING_CHANGE.before!);
      const build = jest.spyOn(mergeMarkdown, "buildRenderedDiffPlan");
      const { container, rerender } = render(diffElement(WORDING_CHANGE, app));
      rerender(diffElement(BLOCK_MOVED, app));
      await waitFor(() =>
        expect(textOf(container, "[data-change=deleted]")).toEqual([
          "Budget is fixed for the quarter.",
        ])
      );

      await act(async () => {
        release();
        await build.mock.results[0].value;
      });

      expect(textOf(container, "del")).toEqual([]);
      expect(textOf(container, "[data-change=deleted]")).toEqual([
        "Budget is fixed for the quarter.",
      ]);
    });

    it("hides the previous file's diff while the next file is still parsing (https://github.com/Brevilabs/obsidian-copilot-private/issues/348)", async () => {
      const { app, release } = appHoldingParse(BLOCK_MOVED.before!);
      const { container, rerender } = render(diffElement(WORDING_CHANGE, app));
      await waitFor(() => expect(textOf(container, "del")).toEqual(["six", "two"]));

      rerender(diffElement(BLOCK_MOVED, app));

      expect(container.firstChild).toBeNull();
      release();
      await waitFor(() =>
        expect(textOf(container, "[data-change=deleted]")).toEqual([
          "Budget is fixed for the quarter.",
        ])
      );
    });
  });
});
