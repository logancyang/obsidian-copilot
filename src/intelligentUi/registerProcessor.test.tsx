import { nativeUiSources } from "@/intelligentUi/nativeSources";
import { registerIntelligentUiProcessor } from "@/intelligentUi/registerProcessor";
import { renderMarkdown } from "@/utils/renderMarkdown";
import { act } from "@testing-library/react";
import { App, MarkdownPostProcessorContext, Plugin } from "obsidian";

jest.mock("@/utils/renderMarkdown", () => ({ renderMarkdown: jest.fn() }));
jest.mock("obsidian", () => ({
  ...jest.requireActual<typeof import("obsidian")>("obsidian"),
  MarkdownRenderChild: class {
    constructor(public containerEl: HTMLElement) {}
  },
}));
const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/882";

describe("registerProcessor", () => {
  describe("registerIntelligentUiProcessor()", () => {
    function setup() {
      const register = jest.fn<
        void,
        [
          string,
          (source: string, element: HTMLElement, context: MarkdownPostProcessorContext) => void,
        ]
      >();
      registerIntelligentUiProcessor({
        app: {} as App,
        registerMarkdownCodeBlockProcessor: register,
      } as unknown as Plugin);
      expect(register).toHaveBeenCalledTimes(1);
      expect(register.mock.calls[0][0]).toBe("copilot-ui");
      const element = document.createElement("div");
      document.body.append(element);
      const children: { onload(): void; onunload(): void }[] = [];
      const context = {
        sourcePath: "Folder/Note.md",
        addChild: (child: (typeof children)[number]) => {
          children.push(child);
          child.onload();
        },
      } as unknown as MarkdownPostProcessorContext;
      return {
        element,
        children,
        process: (source: string) => register.mock.calls[0][1](source, element, context),
      };
    }

    it("registers unconditionally and unmounts its layout when the Markdown child unloads", async () => {
      const { element, children, process } = setup();
      await act(async () => process('<card title="Hello"><text>World</text></card>'));
      expect(element.textContent).toBe("HelloWorld");
      expect(nativeUiSources.get(element)).toBe('<card title="Hello"><text>World</text></card>');
      expect(children).toHaveLength(1);
      await act(async () => children[0].onunload());
      expect(element.textContent).toBe("");
      element.remove();
    });

    it("provides the plugin app and note source path to Markdown leaves", async () => {
      const { element, children, process } = setup();
      jest.mocked(renderMarkdown).mockImplementation(async (_app, text, target) => {
        target.textContent = text;
      });
      await act(async () =>
        process("<markdown>[[Related]] and [site](https://example.com)</markdown>")
      );
      expect(renderMarkdown).toHaveBeenCalledWith(
        expect.any(Object),
        "[[Related]] and [site](https://example.com)",
        expect.any(HTMLElement),
        "Folder/Note.md",
        expect.any(Object)
      );
      expect(element.textContent).toContain("[[Related]]");
      await act(async () => children[0].onunload());
      element.remove();
    });

    it.each([
      "<unknown>Words</unknown>",
      "<card><text>Keep all words</text><",
      '<card title="Unfinished',
    ])(
      `keeps malformed or final incomplete source fully readable (${ISSUE}): %s`,
      async (source) => {
        const { element, children, process } = setup();
        await act(async () => process(source));
        expect(element.querySelector("code")?.textContent).toBe(source);
        await act(async () => children.forEach((child) => child.onunload()));
        element.remove();
      }
    );
  });
});
