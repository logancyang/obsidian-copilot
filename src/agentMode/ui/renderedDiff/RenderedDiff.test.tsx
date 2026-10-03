import {
  BLOCK_MOVED,
  NON_MARKDOWN_FILE,
  TASK_CHECKBOX_TOGGLED,
  WORDING_CHANGE,
  type RenderedDiffFixture,
} from "@/agentMode/ui/renderedDiff/fixtures";
import * as mergeMarkdown from "@/agentMode/ui/renderedDiff/mergeMarkdown";
import { RenderedDiff } from "@/agentMode/ui/renderedDiff/RenderedDiff";
import { AppContext } from "@/context";
import { renderMarkdown } from "@/utils/renderMarkdown";
import { render, waitFor } from "@testing-library/react";
import { App } from "obsidian";
import * as React from "react";

jest.mock("@/utils/renderMarkdown", () => ({ renderMarkdown: jest.fn() }));

function diffElement(fixture: RenderedDiffFixture): React.ReactElement {
  return (
    <AppContext.Provider value={new App()}>
      <RenderedDiff after={fixture.after} before={fixture.before} path={fixture.path} />
    </AppContext.Provider>
  );
}

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

    it("shows a non-Markdown file as tinted verbatim lines without rendering it as Markdown", () => {
      const { container } = render(diffElement(NON_MARKDOWN_FILE));

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
      ["an inserted task block", { path: "Tasks.md", before: null, after: "- [ ] Book it\n" }],
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

    it("keeps the diff plan when re-rendered with the same file contents and path", () => {
      const build = jest.spyOn(mergeMarkdown, "buildRenderedDiffPlan");
      const { rerender } = render(diffElement(NON_MARKDOWN_FILE));

      rerender(diffElement({ ...NON_MARKDOWN_FILE }));

      expect(build).toHaveBeenCalledTimes(1);
    });
  });
});
