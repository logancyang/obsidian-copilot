import { AgentMarkdownText } from "@/agentMode/ui/AgentMarkdownText";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppContext } from "@/context";
import { renderMarkdown } from "@/utils/renderMarkdown";
import { render, screen } from "@testing-library/react";
import { App, TFile } from "obsidian";
import * as React from "react";

jest.mock("@/utils/renderMarkdown", () => ({
  renderMarkdown: jest.fn(),
}));

describe("AgentMarkdownText", () => {
  describe("AgentMarkdownText()", () => {
    const tree = (app: App, text: string, miyoPaths: string[]) => (
      <AppContext.Provider value={app}>
        <TooltipProvider>
          <AgentMarkdownText app={app} text={text} miyoPaths={miyoPaths} />
        </TooltipProvider>
      </AppContext.Provider>
    );

    function renderLinks(miyoPaths: string[]) {
      const app = Object.assign(new App(), {
        workspace: { getActiveFile: jest.fn(() => null) },
        metadataCache: {
          getFirstLinkpathDest: (linkpath: string) => ({ path: `${linkpath}.md` }),
        },
      });
      jest.mocked(renderMarkdown).mockImplementation(async (_app, _text, target) => {
        for (const note of ["Standing desk setup", "Reading list"]) {
          target.createEl("a", {
            cls: "internal-link",
            text: note,
            attr: { "data-href": `notes/${note}` },
          });
        }
      });
      jest.mocked(renderMarkdown).mockClear();
      const text = "[[Standing desk setup]] [[Reading list]]";
      render(tree(app, text, miyoPaths));
    }

    it("labels only the links to notes in the turn's Miyo results as found by Miyo", async () => {
      renderLinks(["notes/Standing desk setup.md"]);

      const badge = await screen.findByRole("img", { name: "Found by Miyo" });
      expect(screen.getAllByRole("img", { name: "Found by Miyo" })).toHaveLength(1);
      expect(badge.parentElement?.nextElementSibling?.textContent).toBe("Standing desk setup");
    });

    it("resolves rendered links from the active note", async () => {
      const app = new App();
      const TFileConstructor = TFile as unknown as new (path: string) => TFile;
      const activeFile = new TFileConstructor("Projects/Active note.md");
      jest.mocked(app.workspace.getActiveFile).mockReturnValue(activeFile);
      jest.mocked(renderMarkdown).mockImplementation(async (_app, text, target) => {
        target.textContent = text;
      });

      render(
        <AppContext.Provider value={app}>
          <AgentMarkdownText app={app} text="[[Related note]]" />
        </AppContext.Provider>
      );

      expect(await screen.findByText("[[Related note]]")).not.toBeNull();
      expect(renderMarkdown).toHaveBeenCalledWith(
        app,
        "[[Related note]]",
        expect.any(HTMLElement),
        "Projects/Active note.md",
        expect.anything()
      );
    });
  });
});
