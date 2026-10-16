import { AgentMarkdownText } from "@/agentMode/ui/AgentMarkdownText";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppContext } from "@/context";
import { renderMarkdown } from "@/utils/renderMarkdown";
import { render, screen, waitFor } from "@testing-library/react";
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
        vault: { getName: () => "step-2" },
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
      return {
        ...render(tree(app, text, miyoPaths)),
        app,
        tree: (t: string) => tree(app, t, miyoPaths),
      };
    }

    it("labels only the links to notes in the turn's Miyo results as found by Miyo", async () => {
      renderLinks(["step-2/notes/Standing desk setup.md"]);

      const badge = await screen.findByRole("img", { name: "Found by Miyo" });
      expect(screen.getAllByRole("img", { name: "Found by Miyo" })).toHaveLength(1);
      expect(badge.parentElement?.nextElementSibling?.textContent).toBe("Standing desk setup");
    });

    it("keeps one badge per Miyo-found link when the text re-renders as the answer streams", async () => {
      const { rerender, tree } = renderLinks(["step-2/notes/Standing desk setup.md"]);
      await screen.findByRole("img", { name: "Found by Miyo" });

      rerender(tree("[[Standing desk setup]] [[Reading list]] and more words"));

      await waitFor(() => expect(renderMarkdown).toHaveBeenCalledTimes(2));
      await screen.findByRole("img", { name: "Found by Miyo" });
      expect(screen.getAllByRole("img", { name: "Found by Miyo" })).toHaveLength(1);
    });

    it("shows no badge when the turn has no Miyo results", async () => {
      renderLinks([]);

      expect(await screen.findByText("Reading list")).not.toBeNull();
      expect(screen.queryByRole("img", { name: "Found by Miyo" })).toBeNull();
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
