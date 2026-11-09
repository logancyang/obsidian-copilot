import { AgentMarkdownText } from "@/agentMode/ui/AgentMarkdownText";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppContext } from "@/context";
import { renderMarkdown } from "@/utils/renderMarkdown";
import { act, render, screen } from "@testing-library/react";
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

    it("passes streamed text to the renderer word by word and the full text once streaming ends (https://github.com/Brevilabs/obsidian-copilot-private/issues/886)", () => {
      jest.useFakeTimers();
      const app = new App();
      jest.mocked(renderMarkdown).mockReset();
      jest.mocked(renderMarkdown).mockResolvedValue(undefined);
      const burst = "Here " + "is a steady reply ".repeat(30);
      const view = (text: string, streaming: boolean) => (
        <AppContext.Provider value={app}>
          <AgentMarkdownText app={app} text={text} streaming={streaming} />
        </AppContext.Provider>
      );
      const rendered = () => jest.mocked(renderMarkdown).mock.calls.at(-1)?.[1] ?? "";
      const { rerender } = render(view("Here ", true));
      rerender(view(burst, true));
      act(() => jest.advanceTimersByTime(20));
      expect(rendered().length).toBeGreaterThan("Here ".length);
      expect(rendered().length).toBeLessThan(burst.length);
      rerender(view(burst + "done.", false));
      expect(rendered()).toBe(burst + "done.");
      jest.useRealTimers();
    });

    it("labels only the links to notes in the turn's Miyo results as found by Miyo", async () => {
      renderLinks(["notes/Standing desk setup.md"]);

      const badge = await screen.findByRole("img", { name: "Found by Miyo" });
      expect(screen.getAllByRole("img", { name: "Found by Miyo" })).toHaveLength(1);
      expect(badge.parentElement?.nextElementSibling?.textContent).toBe("Standing desk setup");
    });

    it("resolves rendered links from the active note and asks for live Dataview query results (https://github.com/logancyang/obsidian-copilot/issues/3988)", async () => {
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
        expect.anything(),
        true
      );
    });
  });
});
