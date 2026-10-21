import { Markdown } from "@/components/Markdown";
import { AppContext } from "@/context";
import { renderMarkdown } from "@/utils/renderMarkdown";
import { act, render, screen, waitFor } from "@testing-library/react";
import { App } from "obsidian";
import * as React from "react";

jest.mock("@/utils/renderMarkdown", () => ({
  renderMarkdown: jest.fn(),
}));

const ISSUE_URL = "https://github.com/Brevilabs/obsidian-copilot-private/issues/317";

describe("Markdown", () => {
  describe("Markdown()", () => {
    it("renders text with Obsidian Markdown styling", async () => {
      jest.mocked(renderMarkdown).mockImplementation(async (_app, text, target) => {
        const heading = target.doc.createElement("h1");
        heading.textContent = text;
        target.appendChild(heading);
      });

      const { container } = render(
        <AppContext.Provider value={new App()}>
          <Markdown className="tw-p-2" sourcePath="" text="Release notes" />
        </AppContext.Provider>
      );

      await waitFor(() => expect(screen.getByRole("heading").textContent).toBe("Release notes"));
      expect(container.firstElementChild?.classList.contains("markdown-rendered")).toBe(true);
      expect(container.firstElementChild?.classList.contains("tw-p-2")).toBe(true);
    });

    it(`runs post-render handling only after Obsidian finishes for ${ISSUE_URL}`, async () => {
      let finishRender: (() => void) | undefined;
      jest.mocked(renderMarkdown).mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            finishRender = resolve;
          })
      );
      const onRendered = jest.fn();
      const view = render(
        <AppContext.Provider value={new App()}>
          <Markdown onRendered={onRendered} sourcePath="" text="Release notes" />
        </AppContext.Provider>
      );

      expect(onRendered).not.toHaveBeenCalled();
      await act(async () => finishRender?.());

      expect(onRendered).toHaveBeenCalledWith(view.container.firstElementChild);
    });

    it(`falls back to readable text when Obsidian cannot render the Markdown for ${ISSUE_URL}`, async () => {
      jest.mocked(renderMarkdown).mockRejectedValue(new Error("renderer unavailable"));

      render(
        <AppContext.Provider value={new App()}>
          <Markdown sourcePath="" text="Release notes remain readable" />
        </AppContext.Provider>
      );

      expect(await screen.findByText("Release notes remain readable")).not.toBeNull();
    });

    it(`does not let an obsolete failed render replace newer content for ${ISSUE_URL}`, async () => {
      let rejectFirstRender: ((error: Error) => void) | undefined;
      jest
        .mocked(renderMarkdown)
        .mockImplementationOnce(
          () =>
            new Promise<void>((_resolve, reject) => {
              rejectFirstRender = reject;
            })
        )
        .mockImplementationOnce(async (_app, text, target) => {
          target.textContent = text;
        });
      const app = new App();
      const view = render(
        <AppContext.Provider value={app}>
          <Markdown sourcePath="" text="Old release notes" />
        </AppContext.Provider>
      );

      view.rerender(
        <AppContext.Provider value={app}>
          <Markdown sourcePath="" text="Current release notes" />
        </AppContext.Provider>
      );
      expect(await screen.findByText("Current release notes")).not.toBeNull();

      await act(async () => rejectFirstRender?.(new Error("obsolete render failed")));

      expect(screen.getByText("Current release notes")).not.toBeNull();
      expect(screen.queryByText("Old release notes")).toBeNull();
    });
  });
});
