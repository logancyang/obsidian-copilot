import { nativeUiSources } from "@/intelligentUi/nativeSources";
import { AppContext } from "@/context";
import { LayoutMarkdown } from "@/intelligentUi/ui/LayoutMarkdown";
import { renderMarkdown } from "@/utils/renderMarkdown";
import { act, render } from "@testing-library/react";
import { App, Component } from "obsidian";
import React from "react";

jest.mock("@/utils/renderMarkdown", () => ({ renderMarkdown: jest.fn() }));
const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/883";
const app = {} as App;
const tree = (text: string) => (
  <AppContext.Provider value={app}>
    <LayoutMarkdown text={text} sourcePath="Topic.md" />
  </AppContext.Provider>
);

describe("LayoutMarkdown", () => {
  describe("LayoutMarkdown()", () => {
    beforeEach(() => jest.clearAllMocks());
    afterEach(() => jest.restoreAllMocks());
    it(`keeps reference links and footnotes in the whole-document Markdown context (${ISSUE})`, async () => {
      const source =
        "[Guide][g] and note[^1]\n\n```copilot-ui\n<text>Layout</text>\n```\n\n[g]: https://example.com\n[^1]: A note";
      jest.mocked(renderMarkdown).mockImplementation(async (_app, text, target) => {
        const block = target.createDiv({ cls: "block-language-copilot-ui" });
        nativeUiSources.set(block, "<text>Layout</text>");
        target.createEl("a", { text: "Guide", attr: { href: "https://example.com" } });
      });
      const view = render(tree(source));
      await act(async () => {
        await jest.mocked(renderMarkdown).mock.results[0].value;
      });
      expect(renderMarkdown).toHaveBeenCalledWith(
        app,
        source,
        expect.any(HTMLElement),
        "Topic.md",
        expect.any(Component),
        false
      );
      expect(view.container.querySelector("a")?.getAttribute("href")).toBe("https://example.com");
      expect(view.container.textContent).toContain("Layout");
    });
    it.each(["", "\t"])(
      `keeps a quoted layout before a distinct top-level fence with %p language spacing (${ISSUE})`,
      async (spacing) => {
        const containerTag = "blockquote";
        const source =
          "> ```copilot-ui\n> <text>Quoted</text>\n> ```\n\n```" +
          spacing +
          "copilot-ui\n<text>Top</text>\n```";
        jest.mocked(renderMarkdown).mockImplementation(async (_app, text, target) => {
          const quoted = target
            .createEl(containerTag)
            .createDiv({ cls: "block-language-copilot-ui" });
          nativeUiSources.set(quoted, "<text>Quoted</text>");
          const top = target.createDiv({ cls: "block-language-copilot-ui" });
          nativeUiSources.set(top, "<text>Top</text>");
        });
        const view = render(tree(source));
        await act(async () => {
          await jest.mocked(renderMarkdown).mock.results[0].value;
        });
        expect(view.container.querySelector(containerTag)?.textContent).toBe("Quoted");
        expect(view.container.textContent).toBe("QuotedTop");
        expect(view.container.querySelector(containerTag)?.nextElementSibling?.textContent).toBe(
          "Top"
        );
      }
    );
    it(`retains distinct identical native layouts in their nested locations across later prose (${ISSUE})`, async () => {
      const body = '<card title="Same"><text>One</text></card>';
      const source = `\`\`\`copilot-ui\n${body}\n\`\`\`\n> \`\`\`copilot-ui\n> ${body}\n> \`\`\`\n\`\`\`copilot-ui\n${body}\n\`\`\``;
      jest.mocked(renderMarkdown).mockImplementation(async (_app, _text, target) => {
        for (const nested of [false, true, false]) {
          const parent = nested ? target.createEl("blockquote") : target;
          const block = parent.createDiv({ cls: "block-language-copilot-ui" });
          nativeUiSources.set(block, body);
        }
      });
      const view = render(tree(source));
      await act(async () => {
        await jest.mocked(renderMarkdown).mock.results[0].value;
      });
      const cards = Array.from(view.container.querySelectorAll("[role=region]"));
      expect(cards).toHaveLength(3);
      expect(cards[1].closest("blockquote")).not.toBeNull();
      expect(cards[0]).not.toBe(cards[1]);
      view.rerender(tree(source + "\nAfter"));
      await act(async () => {
        await jest.mocked(renderMarkdown).mock.results[1].value;
      });
      expect(Array.from(view.container.querySelectorAll("[role=region]"))).toEqual(cards);
    });
    it(`discards stale detached output and unloads late registered resources (${ISSUE})`, async () => {
      let finish!: () => void;
      jest
        .mocked(renderMarkdown)
        .mockImplementationOnce(
          (_app, _text, target) =>
            new Promise<void>((resolve) => {
              finish = () => {
                target.textContent = "Old";
                resolve();
              };
            })
        )
        .mockImplementation(async (_app, _text, target) => {
          target.textContent = "Current";
        });
      const unload = jest.spyOn(Component.prototype, "unload");
      const view = render(tree("old"));
      view.rerender(tree("current"));
      await act(async () => {
        await jest.mocked(renderMarkdown).mock.results[1].value;
      });
      expect(view.container.textContent).toBe("Current");
      expect(unload).not.toHaveBeenCalled();
      await act(async () => {
        finish();
        await jest.mocked(renderMarkdown).mock.results[0].value;
      });
      expect(view.container.textContent).toBe("Current");
      expect(unload).toHaveBeenCalledTimes(1);
      view.unmount();
      expect(unload).toHaveBeenCalledTimes(2);
    });
    it(`retains the entire source if the native Markdown render fails (${ISSUE})`, async () => {
      jest.mocked(renderMarkdown).mockRejectedValueOnce(new Error("unavailable"));
      const source = '```copilot-ui\n<card title="all words';
      const view = render(tree(source));
      await act(async () => {
        await Promise.allSettled(
          jest.mocked(renderMarkdown).mock.results.map((r) => r.value as Promise<void>)
        );
      });
      expect(view.container.textContent).toBe(source);
    });
  });
});
