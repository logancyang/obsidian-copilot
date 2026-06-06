/* eslint-disable obsidianmd/prefer-active-doc -- jsdom unit test runs in a single realm; activeDocument is unavailable */
import { openWithSystemDefault } from "@/utils/openWithSystemDefault";
import { renderMarkdown } from "@/utils/renderMarkdown";
import { __resetVaultBaseCache } from "@/utils/vaultPath";
import { App, FileSystemAdapter } from "obsidian";

jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
jest.mock("@/utils/openWithSystemDefault", () => ({ openWithSystemDefault: jest.fn() }));
jest.mock("obsidian", () => ({
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
  // Mirror the modern MarkdownRenderer.render(app, md, el, sourcePath, component)
  // signature; a no-op is enough since the tests inject their own anchors.
  MarkdownRenderer: { render: jest.fn().mockResolvedValue(undefined) },
}));

const VAULT = "/Users/me/vault";

interface TestApp {
  workspace: { openLinkText: jest.Mock; getActiveFile: () => null };
  vault: { adapter: unknown; getAbstractFileByPath: jest.Mock };
}

function buildApp(base = VAULT, indexedFiles: string[] = []): TestApp {
  const adapter = new (FileSystemAdapter as unknown as new (b: string) => unknown)(base);
  return {
    workspace: { openLinkText: jest.fn(), getActiveFile: () => null },
    vault: {
      adapter,
      getAbstractFileByPath: jest.fn((path: string) =>
        indexedFiles.includes(path) ? { path } : null
      ),
    },
  };
}

/** Render into a div, inject an `a.internal-link`, and dispatch a click on it. */
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

describe("renderMarkdown internal-link handling", () => {
  beforeEach(() => {
    __resetVaultBaseCache();
    jest.clearAllMocks();
    document.body.innerHTML = "";
  });

  it("converts an absolute in-vault path to vault-relative before openLinkText", async () => {
    const app = buildApp();
    await clickInternalLink(app, "/Users/me/vault/00_Inbox/Foo.md");
    expect(app.workspace.openLinkText).toHaveBeenCalledWith("00_Inbox/Foo.md", "source.md", false);
    expect(openWithSystemDefault).not.toHaveBeenCalled();
  });

  it("decodes percent-encoded absolute paths before converting", async () => {
    const app = buildApp();
    await clickInternalLink(app, "/Users/me/vault/00_Inbox/Foo%20Bar.md");
    expect(app.workspace.openLinkText).toHaveBeenCalledWith(
      "00_Inbox/Foo Bar.md",
      "source.md",
      false
    );
  });

  it("does not open (or create) an absolute path outside the vault — hands off to the OS", async () => {
    const app = buildApp();
    await clickInternalLink(app, "/etc/passwd");
    expect(app.workspace.openLinkText).not.toHaveBeenCalled();
    expect(openWithSystemDefault).toHaveBeenCalledWith("/etc/passwd");
  });

  it("opens root-relative vault links through openLinkText", async () => {
    const app = buildApp(VAULT, ["Folder/Foo.md"]);
    await clickInternalLink(app, "/Folder/Foo.md");
    expect(app.workspace.openLinkText).toHaveBeenCalledWith("Folder/Foo.md", "source.md", false);
    expect(openWithSystemDefault).not.toHaveBeenCalled();
  });

  it("opens root-relative vault links with headings through openLinkText", async () => {
    const app = buildApp(VAULT, ["Folder/Foo.md"]);
    await clickInternalLink(app, "/Folder/Foo.md#Heading");
    expect(app.workspace.openLinkText).toHaveBeenCalledWith(
      "Folder/Foo.md#Heading",
      "source.md",
      false
    );
    expect(openWithSystemDefault).not.toHaveBeenCalled();
  });

  it("passes plain relative wikilinks through unchanged", async () => {
    const app = buildApp();
    await clickInternalLink(app, "Some Note");
    expect(app.workspace.openLinkText).toHaveBeenCalledWith("Some Note", "source.md", false);
    expect(openWithSystemDefault).not.toHaveBeenCalled();
  });

  it("opens in a new leaf on cmd/ctrl-click", async () => {
    const app = buildApp();
    await clickInternalLink(app, "/Users/me/vault/00_Inbox/Foo.md", { button: 0, ctrlKey: true });
    expect(app.workspace.openLinkText).toHaveBeenCalledWith("00_Inbox/Foo.md", "source.md", true);
  });
});
