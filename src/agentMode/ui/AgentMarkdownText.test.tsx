import { AgentMarkdownText } from "@/agentMode/ui/AgentMarkdownText";
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
