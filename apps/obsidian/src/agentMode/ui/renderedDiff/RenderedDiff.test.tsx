import {
  BLOCK_MOVED,
  IMAGE_REMOVED_AND_ADDED,
  NON_MARKDOWN_FILE,
  REMOVED_LIST_ITEM,
  TABLE_COLUMN_ADDED,
  TASK_BLOCK_INSERTED,
  TASK_CHECKBOX_TOGGLED,
  TWO_PARAGRAPHS_REWORDED,
  WORDING_CHANGE,
  type RenderedDiffFixture,
} from "@/agentMode/ui/renderedDiff/testing/fixtures";
import * as mergeMarkdown from "@/agentMode/ui/renderedDiff/mergeMarkdown";
import { appParsingRecordedFixtures } from "@/agentMode/ui/renderedDiff/testing/fixtureParserApp";
import { RenderedDiff, type RunRevoke } from "@/agentMode/ui/renderedDiff/RenderedDiff";
import { AppContext } from "@/context";
import { renderMarkdown } from "@/utils/renderMarkdown";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { App } from "obsidian";
import * as React from "react";

jest.mock("@/utils/renderMarkdown", () => ({ renderMarkdown: jest.fn() }));

const recordedApp = appParsingRecordedFixtures();

function diffElement(
  fixture: RenderedDiffFixture,
  app: App = recordedApp,
  revoke?: RunRevoke
): React.ReactElement {
  return (
    <AppContext.Provider value={app}>
      <RenderedDiff
        after={fixture.after}
        before={fixture.before}
        path={fixture.path}
        revoke={revoke}
      />
    </AppContext.Provider>
  );
}

async function revokeButtons(): Promise<HTMLElement[]> {
  return screen.findAllByRole("button", { name: "Revoke" });
}

function appHoldingParse(source: string): { app: App; release: () => void } {
  let release!: () => void;
  const until = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { app: appParsingRecordedFixtures({ source, until }), release };
}

const listEdges = (segment: Element): string[] =>
  Array.from(segment.classList).filter((name) => name.startsWith("[&>:"));

const textOf = (root: HTMLElement, selector: string): string[] =>
  Array.from(root.querySelectorAll(selector)).map((element) => element.textContent ?? "");

describe("RenderedDiff", () => {
  beforeEach(() => {
    jest.mocked(renderMarkdown).mockReset();
    jest.mocked(renderMarkdown).mockImplementation(async (_app, markdown, target) => {
      target.textContent = markdown;
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

    it("frames the image in a wholly removed block as removed and the one in a wholly added block as added (https://github.com/Brevilabs/obsidian-copilot-private/issues/727)", async () => {
      jest.mocked(renderMarkdown).mockImplementation(async (_app, markdown, target) => {
        const image = /!\[([^\]]*)\]\([^)]*\)/.exec(markdown);
        if (image === null) target.textContent = markdown;
        else target.createEl("img", { attr: { alt: image[1] } });
      });
      const { container } = render(diffElement(IMAGE_REMOVED_AND_ADDED));
      const framedAlt = (change: string): Array<string | null> =>
        Array.from(
          container.querySelectorAll(`div[data-change=${change}] [data-change=${change}] > img`)
        ).map((image) => image.getAttribute("alt"));

      await waitFor(() => expect(framedAlt("deleted")).toEqual(["Q2 chart"]));
      expect(framedAlt("inserted")).toEqual(["Q3 chart"]);
    });

    it("renders every segment under one Obsidian Markdown root so block margins collapse between segments as they do in the note (https://github.com/Brevilabs/obsidian-copilot-private/issues/751)", async () => {
      const { container } = render(diffElement(BLOCK_MOVED));

      await waitFor(() => expect(container.querySelector("[data-change=inserted]")).not.toBeNull());
      const roots = container.querySelectorAll(".markdown-rendered");
      expect(roots).toHaveLength(1);
      expect(roots[0]).toBe(container.firstElementChild);
    });

    it("drops the list margins between segments that split one list so a removed middle item sits as close as its siblings (https://github.com/Brevilabs/obsidian-copilot-private/issues/751)", async () => {
      const { container } = render(diffElement(REMOVED_LIST_ITEM));

      await waitFor(() => expect(container.querySelector("[data-change=deleted]")).not.toBeNull());
      const [first, deleted, last] = Array.from(
        container.firstElementChild!.children,
        (child) => child.querySelector("[data-change]")?.firstElementChild ?? child
      );
      expect([first, deleted, last].map(listEdges)).toEqual([
        ["[&>:last-child]:tw-mb-0"],
        ["[&>:first-child]:tw-mt-0", "[&>:last-child]:tw-mb-0"],
        ["[&>:first-child]:tw-mt-0"],
      ]);
    });

    it("moves a lone table's margins onto the container Obsidian scrolls it in, so they fall outside the highlight instead of padding it (https://github.com/Brevilabs/obsidian-copilot-private/issues/751)", async () => {
      const { container } = render(diffElement(TABLE_COLUMN_ADDED));

      await waitFor(() => expect(container.querySelector("[data-change=inserted]")).not.toBeNull());
      const blocks = Array.from(
        container.querySelectorAll("div[data-change] > div"),
        (block) => block.classList
      );
      expect(blocks).toHaveLength(2);
      for (const classes of blocks) {
        expect(classes).toContain("[&[style*=overflow-x]>table]:tw-my-0");
        expect(classes).toContain("[&[style*=overflow-x]]:tw-my-[var(--p-spacing)]");
      }
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

    it.each([
      [
        "a diff that offers Revoke",
        { current: TWO_PARAGRAPHS_REWORDED.after, onRevoke: jest.fn() },
      ],
      ["a diff that offers no Revoke", undefined],
    ])(
      "draws a bar in the margin beside each run of changes and none beside unchanged blocks in %s, so a small change is easy to spot (https://github.com/Brevilabs/obsidian-copilot-private/issues/910)",
      async (_name, revoke) => {
        const { container } = render(diffElement(TWO_PARAGRAPHS_REWORDED, recordedApp, revoke));

        await waitFor(() => expect(textOf(container, "del")).not.toEqual([]));
        const marked = Array.from(container.querySelectorAll("[data-change-bar]")).map(
          (bar) => bar.parentElement!.textContent
        );

        expect(marked).toEqual([
          expect.stringContaining("The pilot runs for"),
          expect.stringContaining("We report progress every"),
        ]);
        expect(marked.join("")).not.toContain("Budget is fixed");
      }
    );

    it("draws one bar beside the changed lines of a non-Markdown file (https://github.com/Brevilabs/obsidian-copilot-private/issues/910)", async () => {
      const { container } = render(diffElement(NON_MARKDOWN_FILE));

      await waitFor(() => expect(container.querySelector("pre")).not.toBeNull());
      const bars = container.querySelectorAll("pre [data-change-bar]");

      expect(bars).toHaveLength(1);
      expect(bars[0].parentElement!.querySelectorAll("[data-change=unchanged]")).toHaveLength(0);
    });

    it("frames each run of changes with its own Revoke button, leaving unchanged blocks outside every frame (https://github.com/Brevilabs/obsidian-copilot-private/issues/823)", async () => {
      const revoke: RunRevoke = { current: TWO_PARAGRAPHS_REWORDED.after, onRevoke: jest.fn() };
      render(diffElement(TWO_PARAGRAPHS_REWORDED, recordedApp, revoke));

      const frames = (await revokeButtons()).map((button) => button.parentElement!.textContent);

      expect(frames).toEqual([
        expect.stringContaining("The pilot runs for"),
        expect.stringContaining("We report progress every"),
      ]);
      expect(frames.join("")).not.toContain("Budget is fixed");
    });

    it("hands the clicked run's line ranges to the revoke handler", async () => {
      const onRevoke = jest.fn();
      render(
        diffElement(TWO_PARAGRAPHS_REWORDED, recordedApp, {
          current: TWO_PARAGRAPHS_REWORDED.after,
          onRevoke,
        })
      );

      fireEvent.click((await revokeButtons())[1]);

      expect(onRevoke).toHaveBeenCalledWith({
        before: { start: 5, end: 8 },
        after: { start: 5, end: 8 },
      });
    });

    it("disables only the Revoke of a run whose text changed in the note after the turn and says why on focus (https://github.com/Brevilabs/obsidian-copilot-private/issues/823)", async () => {
      const onRevoke = jest.fn();
      const current = TWO_PARAGRAPHS_REWORDED.after!.replace("every Monday", "every Tuesday");
      render(diffElement(TWO_PARAGRAPHS_REWORDED, recordedApp, { current, onRevoke }));

      const [first, second] = await revokeButtons();
      fireEvent.click(second);
      fireEvent.focus(second);

      expect(first.getAttribute("aria-disabled")).toBeNull();
      expect(second.getAttribute("aria-disabled")).toBe("true");
      expect(onRevoke).not.toHaveBeenCalled();
      expect(
        (await screen.findAllByText("This text changed in the note after the turn.")).length
      ).toBeGreaterThan(0);
    });

    it("disables every Revoke when the note no longer exists (https://github.com/Brevilabs/obsidian-copilot-private/issues/823)", async () => {
      render(
        diffElement(TWO_PARAGRAPHS_REWORDED, recordedApp, { current: null, onRevoke: jest.fn() })
      );

      const buttons = await revokeButtons();

      expect(buttons.map((button) => button.getAttribute("aria-disabled"))).toEqual([
        "true",
        "true",
      ]);
    });

    it("frames the changed lines of a non-Markdown file as one run with its Revoke button", async () => {
      render(
        diffElement(NON_MARKDOWN_FILE, recordedApp, {
          current: NON_MARKDOWN_FILE.after,
          onRevoke: jest.fn(),
        })
      );

      const [button] = await revokeButtons();

      expect(button.closest("pre")).not.toBeNull();
      expect(button.parentElement!.querySelectorAll("[data-change=unchanged]")).toHaveLength(0);
    });

    it("offers no Revoke when no revoke handler is given", async () => {
      const { container } = render(diffElement(TWO_PARAGRAPHS_REWORDED));

      await waitFor(() => expect(textOf(container, "del")).not.toEqual([]));
      expect(screen.queryByRole("button", { name: "Revoke" })).toBeNull();
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
