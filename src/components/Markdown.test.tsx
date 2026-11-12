import { nativeUiSources } from "@/intelligentUi/nativeSources";
import { splitUiFences } from "@/intelligentUi/splitUiFences";
import { GOLDEN_EXAMPLES } from "@/intelligentUi/testing/golden";
import { Markdown } from "@/components/Markdown";
import { AppContext } from "@/context";
import { renderMarkdown } from "@/utils/renderMarkdown";
import { act, render, screen, waitFor } from "@testing-library/react";
import { App } from "obsidian";
import * as React from "react";

jest.mock("@/utils/renderMarkdown", () => ({
  renderMarkdown: jest.fn(),
}));

jest.mock("obsidian", () => ({
  ...jest.requireActual<typeof import("obsidian")>("obsidian"),
  setIcon: jest.fn(),
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

    it("leaves Obsidian Markdown styling to the enclosing rendered root when nested", async () => {
      jest.mocked(renderMarkdown).mockImplementation(async (_app, text, target) => {
        target.textContent = text;
      });

      const { container } = render(
        <AppContext.Provider value={new App()}>
          <Markdown className="tw-p-2" nested sourcePath="" text="Release notes" />
        </AppContext.Provider>
      );

      await waitFor(() => expect(container.textContent).toBe("Release notes"));
      expect(container.firstElementChild?.classList.contains("markdown-rendered")).toBe(false);
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

    it.each(Object.entries(GOLDEN_EXAMPLES))(
      "keeps completed %s layout nodes and prose order across streamed fence chunks (https://github.com/Brevilabs/obsidian-copilot-private/issues/883)",
      async (_name, source) => {
        jest.mocked(renderMarkdown).mockImplementation(async (_app, text, target) => {
          for (const segment of splitUiFences(text, true)) {
            if (segment.kind === "layout") {
              const block = target.createDiv({ cls: "block-language-copilot-ui" });
              nativeUiSources.set(block, segment.source.replace(/\n$/, ""));
            } else target.createDiv({ text: segment.source });
          }
        });
        const app = new App();
        const content = `Before\n\n\`\`\`copilot-ui\n${source}\n\`\`\`\n\nAfter`;
        const tree = (text: string, streaming: boolean) => (
          <AppContext.Provider value={app}>
            <Markdown text={text} sourcePath="" streaming={streaming} />
          </AppContext.Provider>
        );
        const view = render(tree("", true));
        let completed: Element[] = [];
        for (let end = 1; end <= content.length; end += 7) {
          view.rerender(tree(content.slice(0, end), true));
          await act(async () => {
            await Promise.allSettled(
              jest.mocked(renderMarkdown).mock.results.map((r) => r.value as Promise<void>)
            );
          });
          for (const element of completed) expect(view.container.contains(element)).toBe(true);
          completed = Array.from(view.container.querySelectorAll("[role]:not([role=status])"));
          expect(view.container.querySelector("pre")).toBeNull();
        }
        view.rerender(tree(content, false));
        await act(async () => {
          await Promise.allSettled(
            jest.mocked(renderMarkdown).mock.results.map((r) => r.value as Promise<void>)
          );
        });
        for (const element of completed) expect(view.container.contains(element)).toBe(true);
        expect(view.container.textContent).toMatch(/^Before[\s\S]*After$/);
        expect(view.container.querySelector('[role="status"]')).toBeNull();
        const fixed = render(tree(content, false));
        await act(async () => {
          await Promise.allSettled(
            jest.mocked(renderMarkdown).mock.results.map((r) => r.value as Promise<void>)
          );
        });
        const html = (element: HTMLElement) => element.innerHTML.replace(/:r\w+:/g, "ID");
        expect(html(view.container)).toBe(html(fixed.container));
        fixed.unmount();
        view.unmount();
      }
    );
    it("keeps an ordinary streamed reply on the existing Markdown renderer (https://github.com/Brevilabs/obsidian-copilot-private/issues/883)", async () => {
      jest.mocked(renderMarkdown).mockImplementation(async (_app, text, target) => {
        target.textContent = text;
      });
      const app = new App();
      const tree = (text: string) => (
        <AppContext.Provider value={app}>
          <Markdown text={text} sourcePath="Topic.md" streaming />
        </AppContext.Provider>
      );
      const view = render(tree("**Hello"));
      expect(await screen.findByText("**Hello")).toBeTruthy();
      view.rerender(tree("**Hello world**"));
      expect(await screen.findByText("**Hello world**")).toBeTruthy();
      expect(view.container.children).toHaveLength(1);
      expect(view.container.querySelector('[role="status"]')).toBeNull();
    });
  });
});
