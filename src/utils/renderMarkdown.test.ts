import { openWithSystemDefault } from "@/utils/openWithSystemDefault";
import { renderMarkdown, withoutDataview } from "@/utils/renderMarkdown";
import { __resetVaultBaseCache } from "@/utils/vaultPath";
import { App, FileSystemAdapter, MarkdownRenderer } from "obsidian";

jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
jest.mock("@/utils/openWithSystemDefault", () => ({ openWithSystemDefault: jest.fn() }));
jest.mock("obsidian", () => ({
  Keymap: jest.requireActual<typeof import("obsidian")>("obsidian").Keymap,
  FileSystemAdapter: class FileSystemAdapter {
    private readonly base: string;
    constructor(base = "/vault") {
      this.base = base;
    }
    getBasePath(): string {
      return this.base;
    }
  },
  Notice: jest.fn(),
  MarkdownRenderer: { render: jest.fn().mockResolvedValue(undefined) },
}));

const VAULT = "/Users/me/vault";

interface TestApp {
  workspace: { openLinkText: jest.Mock; getActiveFile: () => null };
  vault: { adapter: unknown; getAbstractFileByPath: jest.Mock };
  metadataCache: { getFirstLinkpathDest: jest.Mock };
  plugins: { getPlugin: jest.Mock };
}

function buildApp(dataviewExecute?: jest.Mock): TestApp {
  const adapter = new (FileSystemAdapter as unknown as new (b: string) => unknown)(VAULT);
  return {
    workspace: { openLinkText: jest.fn(), getActiveFile: () => null },
    vault: { adapter, getAbstractFileByPath: jest.fn(() => null) },
    metadataCache: { getFirstLinkpathDest: jest.fn(() => null) },
    plugins: {
      getPlugin: jest.fn((id: string) =>
        id === "dataview" && dataviewExecute ? { api: { execute: dataviewExecute } } : null
      ),
    },
  };
}

const DATAVIEW_ISSUE_URL = "https://github.com/logancyang/obsidian-copilot/issues/3988";

function codeBlock(wrapperTag: string, wrapperClass: string, codeClass: string, source: string) {
  const wrapper = document.createElement(wrapperTag);
  wrapper.className = wrapperClass;
  const code = wrapper.appendChild(document.createElement("code"));
  code.className = codeClass;
  code.textContent = source;
  return wrapper;
}

function renderObsidianBlocks(...blocks: HTMLElement[]): void {
  (MarkdownRenderer as unknown as { render: jest.Mock }).render.mockImplementationOnce(
    async (_app: unknown, _markdown: string, el: HTMLElement) => el.replaceChildren(...blocks)
  );
}

function renderDataviewFallbackBlocks(): void {
  renderObsidianBlocks(
    codeBlock("div", "block-language-dataview", "dataview", 'LIST FROM ""'),
    codeBlock("div", "block-language-dataviewjs", "dataview", 'dv.paragraph("hi")')
  );
}

async function clickInternalLink(
  app: TestApp,
  dataHref: string,
  init: MouseEventInit = { button: 0 }
): Promise<void> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const component = { register: jest.fn() } as unknown as Parameters<typeof renderMarkdown>[4];
  await renderMarkdown(app as unknown as App, "irrelevant", el, "source.md", component);
  const a = document.createElement("a");
  a.className = "internal-link";
  a.setAttribute("data-href", dataHref);
  el.appendChild(a);
  a.dispatchEvent(new MouseEvent("click", { bubbles: true, ...init }));
}

describe("renderMarkdown", () => {
  describe("renderMarkdown()", () => {
    beforeEach(() => {
      __resetVaultBaseCache();
      jest.clearAllMocks();
      document.body.innerHTML = "";
    });

    it("renders through Obsidian with Dataview opted out so a fenced block starting with `=` stays literal (https://github.com/logancyang/obsidian-copilot/issues/3988)", async () => {
      const app = buildApp();
      const el = document.createElement("div");
      const component = { register: jest.fn() } as unknown as Parameters<typeof renderMarkdown>[4];
      const markdown = "```markdown\n==Twinkle==\n```";
      await renderMarkdown(app as unknown as App, markdown, el, "notes/source.md", component);
      expect((MarkdownRenderer as unknown as { render: jest.Mock }).render).toHaveBeenCalledWith(
        app,
        markdown,
        el,
        "notes/source.md?no-dataview",
        component
      );
    });

    it(`runs a dataview block through Dataview with the note's own path when live queries are on, leaving dataviewjs as source, for ${DATAVIEW_ISSUE_URL}`, async () => {
      const execute = jest.fn().mockResolvedValue(undefined);
      const app = buildApp(execute);
      const el = document.createElement("div");
      const component = { register: jest.fn() } as unknown as Parameters<typeof renderMarkdown>[4];
      renderDataviewFallbackBlocks();

      await renderMarkdown(app as unknown as App, "md", el, "notes/source.md", component, true);

      const dataviewBlock = el.querySelector(".block-language-dataview");
      expect(execute).toHaveBeenCalledTimes(1);
      expect(execute).toHaveBeenCalledWith(
        'LIST FROM ""',
        dataviewBlock,
        component,
        "notes/source.md"
      );
      expect(dataviewBlock?.textContent).toBe("");
      expect(el.querySelector(".block-language-dataviewjs")?.textContent).toBe(
        'dv.paragraph("hi")'
      );
    });

    it("leaves a dataview block as source when live queries are not requested", async () => {
      const execute = jest.fn();
      const app = buildApp(execute);
      const el = document.createElement("div");
      const component = { register: jest.fn() } as unknown as Parameters<typeof renderMarkdown>[4];
      renderDataviewFallbackBlocks();

      await renderMarkdown(app as unknown as App, "md", el, "notes/source.md", component);

      expect(execute).not.toHaveBeenCalled();
      expect(el.querySelector(".block-language-dataview")?.textContent).toBe('LIST FROM ""');
    });

    it(`leaves a dataview block as source when Dataview is not enabled, for ${DATAVIEW_ISSUE_URL}`, async () => {
      const app = buildApp();
      const el = document.createElement("div");
      const component = { register: jest.fn() } as unknown as Parameters<typeof renderMarkdown>[4];
      renderObsidianBlocks(codeBlock("pre", "", "language-dataview", 'LIST FROM ""'));

      await renderMarkdown(app as unknown as App, "md", el, "notes/source.md", component, true);

      expect(el.querySelector("pre code.language-dataview")?.textContent).toBe('LIST FROM ""');
    });

    it.each([
      ["click", { button: 0 }],
      ["click", { button: 0, ctrlKey: true }],
      ["click", { button: 0, metaKey: true }],
      ["auxclick", { button: 1 }],
    ] as const)(
      "opens a nested Markdown link once from its nearest source for %s %j (https://github.com/Brevilabs/obsidian-copilot-private/issues/882)",
      async (eventType, init) => {
        const app = buildApp();
        const outer = document.body.appendChild(document.createElement("div"));
        const inner = outer.appendChild(document.createElement("div"));
        const component = { register: jest.fn() } as unknown as Parameters<
          typeof renderMarkdown
        >[4];
        await renderMarkdown(app as unknown as App, "layout", outer, "chat.md", component);
        await renderMarkdown(
          app as unknown as App,
          "[[Related]]",
          inner,
          "notes/nested.md",
          component
        );
        const link = inner.appendChild(document.createElement("a"));
        link.className = "internal-link";
        link.setAttribute("data-href", "Related");

        link.dispatchEvent(new MouseEvent(eventType, { bubbles: true, cancelable: true, ...init }));

        expect(app.workspace.openLinkText).toHaveBeenCalledTimes(1);
        expect(app.workspace.openLinkText).toHaveBeenCalledWith(
          "Related",
          "notes/nested.md",
          "tab"
        );
      }
    );

    it("opens a clicked internal link with its absolute in-vault path converted to vault-relative", async () => {
      const app = buildApp();
      await clickInternalLink(app, "/Users/me/vault/00_Inbox/Foo.md");
      expect(app.workspace.openLinkText).toHaveBeenCalledWith(
        "00_Inbox/Foo.md",
        "source.md",
        "tab"
      );
      expect(openWithSystemDefault).not.toHaveBeenCalled();
    });

    it("decodes a percent-encoded link target before opening it", async () => {
      const app = buildApp();
      await clickInternalLink(app, "/Users/me/vault/00_Inbox/Foo%20Bar.md");
      expect(app.workspace.openLinkText).toHaveBeenCalledWith(
        "00_Inbox/Foo Bar.md",
        "source.md",
        "tab"
      );
    });

    it("opens the link in a new tab on ctrl-click", async () => {
      const app = buildApp();
      await clickInternalLink(app, "/Users/me/vault/00_Inbox/Foo.md", { button: 0, ctrlKey: true });
      expect(app.workspace.openLinkText).toHaveBeenCalledWith(
        "00_Inbox/Foo.md",
        "source.md",
        "tab"
      );
    });
  });

  describe("withoutDataview()", () => {
    it("appends Dataview's no-dataview opt-out marker to a note path", () => {
      expect(withoutDataview("notes/source.md")).toBe("notes/source.md?no-dataview");
    });

    it("returns only the marker when there is no source note", () => {
      expect(withoutDataview("")).toBe("?no-dataview");
    });
  });
});
