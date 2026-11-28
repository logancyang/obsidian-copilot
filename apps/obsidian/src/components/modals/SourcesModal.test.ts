import type { App } from "obsidian";

jest.mock("obsidian", () => ({
  Modal: class Modal {
    app: unknown;
    contentEl = activeDocument.createElement("div");

    constructor(app: unknown) {
      this.app = app;
      this.contentEl.empty = () => {
        this.contentEl.replaceChildren();
      };
    }
  },
  Setting: class Setting {
    setName(): this {
      return this;
    }
    setHeading(): this {
      return this;
    }
  },
  TFile: class TFile {},
}));

import { SourcesModal } from "@/components/modals/SourcesModal";

function openSources(sources: ConstructorParameters<typeof SourcesModal>[1]) {
  const openLinkText = jest.fn().mockResolvedValue(undefined);
  const app = {
    vault: { getName: () => "My Vault", getAbstractFileByPath: () => null },
    workspace: { openLinkText },
  } as unknown as App;
  const modal = new SourcesModal(app, sources);
  modal.onOpen();
  return { item: modal.contentEl.querySelector("li") as HTMLLIElement, openLinkText };
}

describe("SourcesModal", () => {
  describe("SourcesModal", () => {
    describe("onOpen()", () => {
      it("links a vault source to its note and opens that note when clicked", () => {
        const { item, openLinkText } = openSources([
          { title: "Plan", path: "notes/plan.md", score: 0.9 },
        ]);

        const link = item.querySelector("a") as HTMLAnchorElement;
        expect(link.textContent).toBe("Plan (notes/plan.md)");
        expect(link.href).toBe("obsidian://open?vault=My%20Vault&file=notes%2Fplan.md");
        link.click();
        expect(openLinkText).toHaveBeenCalledWith("notes/plan.md", "");
      });

      it("shows a source from another Miyo folder as plain text with its label, with no vault link to open — https://github.com/logancyang/obsidian-copilot/issues/3508", () => {
        const { item, openLinkText } = openSources([
          {
            title: "Idea",
            path: "Research/idea.md",
            score: 0.8,
            outsideVaultLabel: "Research",
          },
        ]);

        expect(item.querySelector("a")).toBeNull();
        expect(item.textContent).toContain("Idea (Research/idea.md)");
        expect(
          Array.from(item.querySelectorAll("span")).some((span) => span.textContent === "Research")
        ).toBe(true);
        (item.firstElementChild as HTMLElement).click();
        expect(openLinkText).not.toHaveBeenCalled();
      });
    });
  });
});
