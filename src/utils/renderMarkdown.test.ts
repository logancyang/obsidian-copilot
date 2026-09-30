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
  MarkdownRenderer: { render: jest.fn().mockResolvedValue(undefined) },
}));

const VAULT = "/Users/me/vault";

interface TestApp {
  workspace: { openLinkText: jest.Mock; getActiveFile: () => null };
  vault: { adapter: unknown; getAbstractFileByPath: jest.Mock };
}

function buildApp(): TestApp {
  const adapter = new (FileSystemAdapter as unknown as new (b: string) => unknown)(VAULT);
  return {
    workspace: { openLinkText: jest.fn(), getActiveFile: () => null },
    vault: { adapter, getAbstractFileByPath: jest.fn(() => null) },
  };
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

    it("opens a clicked internal link with its absolute in-vault path converted to vault-relative", async () => {
      const app = buildApp();
      await clickInternalLink(app, "/Users/me/vault/00_Inbox/Foo.md");
      expect(app.workspace.openLinkText).toHaveBeenCalledWith(
        "00_Inbox/Foo.md",
        "source.md",
        false
      );
      expect(openWithSystemDefault).not.toHaveBeenCalled();
    });

    it("decodes a percent-encoded link target before opening it", async () => {
      const app = buildApp();
      await clickInternalLink(app, "/Users/me/vault/00_Inbox/Foo%20Bar.md");
      expect(app.workspace.openLinkText).toHaveBeenCalledWith(
        "00_Inbox/Foo Bar.md",
        "source.md",
        false
      );
    });

    it("opens the link in a new leaf on ctrl-click", async () => {
      const app = buildApp();
      await clickInternalLink(app, "/Users/me/vault/00_Inbox/Foo.md", { button: 0, ctrlKey: true });
      expect(app.workspace.openLinkText).toHaveBeenCalledWith("00_Inbox/Foo.md", "source.md", true);
    });
  });
});
