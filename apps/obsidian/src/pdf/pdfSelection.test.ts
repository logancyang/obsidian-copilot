jest.mock("obsidian", () => ({
  ...jest.requireActual<Record<string, unknown>>("obsidian"),
  FileView: class FileView {},
}));

import { activePdfSelection } from "@/pdf/pdfSelection";
import type { App } from "obsidian";

const ISSUE_818 = "https://github.com/Brevilabs/obsidian-copilot-private/issues/818";

function openView(text: string, viewType = "pdf") {
  const page = document.createElement("div");
  page.textContent = text;
  document.body.append(page);
  const view = {
    file: { path: "Papers/Attention.pdf", basename: "Attention" },
    contentEl: page,
    getViewType: () => viewType,
  };
  const app = { workspace: { getActiveViewOfType: () => view } } as unknown as App;
  return { page, app };
}

function selectText(node: Node, end: number): void {
  const range = document.createRange();
  range.setStart(node, 0);
  range.setEnd(node, end);
  document.getSelection()!.removeAllRanges();
  document.getSelection()!.addRange(range);
}

describe("pdfSelection", () => {
  afterEach(() => {
    document.getSelection()!.removeAllRanges();
    document.body.replaceChildren();
  });

  describe("activePdfSelection()", () => {
    it(`reports text selected in the active PDF under the PDF's path (${ISSUE_818})`, () => {
      const { page, app } = openView("Attention is all you need");
      selectText(page.firstChild!, 9);

      expect(activePdfSelection(app)?.()).toMatchObject({
        location: "Papers/Attention.pdf",
        key: "pdf:Papers/Attention.pdf:Attention",
        context: {
          content: "Attention",
          sourceType: "note",
          noteTitle: "Attention",
          notePath: "Papers/Attention.pdf",
          startLine: 0,
          endLine: 0,
        },
      });
    });

    it(`reports nothing selected in the PDF when its selection collapses (${ISSUE_818})`, () => {
      const { page, app } = openView("Attention is all you need");
      selectText(page.firstChild!, 0);

      expect(activePdfSelection(app)?.()).toEqual({
        location: "Papers/Attention.pdf",
        context: null,
      });
    });

    it(`reports nothing selected in the PDF when the selection lies outside it (${ISSUE_818})`, () => {
      const { app } = openView("Attention is all you need");
      const other = document.createElement("div");
      other.textContent = "Elsewhere";
      document.body.append(other);
      selectText(other.firstChild!, 4);

      expect(activePdfSelection(app)?.()).toEqual({
        location: "Papers/Attention.pdf",
        context: null,
      });
    });

    it(`returns no reader when the active file view is not a PDF (${ISSUE_818})`, () => {
      const { app } = openView("Some image caption", "image");

      expect(activePdfSelection(app)).toBeNull();
    });
  });
});
