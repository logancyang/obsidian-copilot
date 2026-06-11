import { openVaultPath } from "@/utils/openVaultPath";
import { openWithSystemDefault } from "@/utils/openWithSystemDefault";
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
}));

const VAULT = "/Users/me/vault";

interface TestApp {
  workspace: { openLinkText: jest.Mock };
  vault: { adapter: unknown; getAbstractFileByPath: jest.Mock };
}

function buildApp(base = VAULT, indexedFiles: string[] = []): TestApp {
  const adapter = new (FileSystemAdapter as unknown as new (b: string) => unknown)(base);
  return {
    workspace: { openLinkText: jest.fn() },
    vault: {
      adapter,
      getAbstractFileByPath: jest.fn((path: string) =>
        indexedFiles.includes(path) ? { path } : null
      ),
    },
  };
}

function open(app: TestApp, path: string, newLeaf = false): void {
  openVaultPath(app as unknown as App, path, { newLeaf });
}

describe("openVaultPath", () => {
  beforeEach(() => {
    __resetVaultBaseCache();
    jest.clearAllMocks();
  });

  it("converts an absolute in-vault path to vault-relative before openLinkText", () => {
    const app = buildApp();
    open(app, "/Users/me/vault/00_Inbox/Foo.md");
    expect(app.workspace.openLinkText).toHaveBeenCalledWith("00_Inbox/Foo.md", "", false);
    expect(openWithSystemDefault).not.toHaveBeenCalled();
  });

  it("hands an absolute path outside the vault to the OS — never openLinkText", () => {
    const app = buildApp();
    open(app, "/tmp/chap1.txt");
    expect(app.workspace.openLinkText).not.toHaveBeenCalled();
    expect(openWithSystemDefault).toHaveBeenCalledWith("/tmp/chap1.txt");
  });

  it("passes a plain relative path through unchanged", () => {
    const app = buildApp();
    open(app, "00_Inbox/Foo.md");
    expect(app.workspace.openLinkText).toHaveBeenCalledWith("00_Inbox/Foo.md", "", false);
    expect(openWithSystemDefault).not.toHaveBeenCalled();
  });

  it("opens a root-relative link to an existing vault file through openLinkText", () => {
    const app = buildApp(VAULT, ["Folder/Foo.md"]);
    open(app, "/Folder/Foo.md");
    expect(app.workspace.openLinkText).toHaveBeenCalledWith("Folder/Foo.md", "", false);
    expect(openWithSystemDefault).not.toHaveBeenCalled();
  });

  it("preserves the heading anchor on a root-relative vault link", () => {
    const app = buildApp(VAULT, ["Folder/Foo.md"]);
    open(app, "/Folder/Foo.md#Heading");
    expect(app.workspace.openLinkText).toHaveBeenCalledWith("Folder/Foo.md#Heading", "", false);
  });

  it("propagates newLeaf to openLinkText", () => {
    const app = buildApp();
    open(app, "/Users/me/vault/00_Inbox/Foo.md", true);
    expect(app.workspace.openLinkText).toHaveBeenCalledWith("00_Inbox/Foo.md", "", true);
  });

  it("forwards an explicit sourcePath to openLinkText", () => {
    const app = buildApp();
    openVaultPath(app as unknown as App, "Some Note", { sourcePath: "source.md" });
    expect(app.workspace.openLinkText).toHaveBeenCalledWith("Some Note", "source.md", false);
  });
});
