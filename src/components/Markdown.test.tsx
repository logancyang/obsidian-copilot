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
const BLANK_LINES_ISSUE_URL = "https://github.com/Brevilabs/obsidian-copilot-private/issues/751";

function appParsingParagraphs(until?: Promise<void>): App {
  const computeMetadataAsync = jest.fn(async (buffer: ArrayBuffer) => {
    await until;
    const lines = new TextDecoder().decode(buffer).split("\n");
    const sections = lines.flatMap((line, index) =>
      line === ""
        ? []
        : [
            {
              type: "paragraph",
              position: {
                start: { line: index, offset: index },
                end: { line: index, offset: index + 1 },
              },
            },
          ]
    );
    return { sections };
  });
  return { metadataCache: { computeMetadataAsync } } as unknown as App;
}

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

    it(`renders each blank line past the first as a <br> line when asked to keep blank lines for ${BLANK_LINES_ISSUE_URL}`, async () => {
      jest.mocked(renderMarkdown).mockResolvedValue(undefined);

      render(
        <AppContext.Provider value={appParsingParagraphs()}>
          <Markdown keepBlankLines sourcePath="" text={"Alpha\n\n\n\nBeta"} />
        </AppContext.Provider>
      );

      await waitFor(() =>
        expect(renderMarkdown).toHaveBeenCalledWith(
          expect.anything(),
          "Alpha\n\n<br>\n<br>\n\nBeta",
          expect.anything(),
          "",
          expect.anything()
        )
      );
    });

    it(`renders the Markdown as written when Obsidian's parser is unavailable for ${BLANK_LINES_ISSUE_URL}`, async () => {
      jest.mocked(renderMarkdown).mockResolvedValue(undefined);

      render(
        <AppContext.Provider value={new App()}>
          <Markdown keepBlankLines sourcePath="" text={"Alpha\n\n\n\nBeta"} />
        </AppContext.Provider>
      );

      await waitFor(() =>
        expect(renderMarkdown).toHaveBeenCalledWith(
          expect.anything(),
          "Alpha\n\n\n\nBeta",
          expect.anything(),
          "",
          expect.anything()
        )
      );
    });

    it(`never renders text whose blank-line parse finishes after newer text replaced it for ${BLANK_LINES_ISSUE_URL}`, async () => {
      jest.mocked(renderMarkdown).mockReset();
      jest.mocked(renderMarkdown).mockImplementation(async (_app, text, target) => {
        target.textContent = text;
      });
      let finishFirstParse: (() => void) | undefined;
      const firstApp = appParsingParagraphs(
        new Promise<void>((resolve) => {
          finishFirstParse = resolve;
        })
      );
      const view = render(
        <AppContext.Provider value={firstApp}>
          <Markdown keepBlankLines sourcePath="" text="Old release notes" />
        </AppContext.Provider>
      );

      view.rerender(
        <AppContext.Provider value={appParsingParagraphs()}>
          <Markdown keepBlankLines sourcePath="" text="Current release notes" />
        </AppContext.Provider>
      );
      expect(await screen.findByText("Current release notes")).not.toBeNull();
      await act(async () => finishFirstParse?.());

      expect(renderMarkdown).toHaveBeenCalledTimes(1);
      expect(screen.queryByText("Old release notes")).toBeNull();
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
