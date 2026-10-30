import { openFileInTab, openLinkClickProps, openVaultPath } from "@/utils/openVaultPath";
import { openWithSystemDefault } from "@/utils/openWithSystemDefault";
import { __resetVaultBaseCache } from "@/utils/vaultPath";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as fs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import { App, FileSystemAdapter, TFile } from "obsidian";
import React from "react";

jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
jest.mock("@/utils/openWithSystemDefault", () => ({ openWithSystemDefault: jest.fn() }));
jest.mock("obsidian", () => ({
  Keymap: jest.requireActual<typeof import("obsidian")>("obsidian").Keymap,
  Platform: { isDesktopApp: true, isMobile: false },
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
  TFile: class TFile {
    path = "";
  },
}));

const VAULT = "/Users/me/vault";

interface TestLeaf {
  getRoot: () => unknown;
  getViewState: () => { type: string; state: { file?: string } };
  loadIfDeferred: jest.Mock;
  openFile: jest.Mock;
}

interface TestApp {
  workspace: {
    openLinkText: jest.Mock;
    iterateAllLeaves: (callback: (leaf: TestLeaf) => void) => void;
    leftSplit: unknown;
    rightSplit: unknown;
    revealLeaf: jest.Mock;
    setActiveLeaf: jest.Mock;
    getLeaf: jest.Mock;
  };
  metadataCache: { getFirstLinkpathDest: jest.Mock };
  vault: { adapter: unknown; getAbstractFileByPath: jest.Mock };
}

function vaultFile(path: string): TFile {
  return Object.assign(new TFile(), { path });
}

const MAIN_AREA = { name: "main area" };
const POPOUT_WINDOW = { name: "popout window" };
const RIGHT_SIDEBAR = { name: "right sidebar" };

function leafShowing(file?: string, type = "markdown", root: unknown = MAIN_AREA): TestLeaf {
  return {
    getRoot: () => root,
    getViewState: () => ({ type, state: file ? { file } : {} }),
    loadIfDeferred: jest.fn().mockResolvedValue(undefined),
    openFile: jest.fn().mockResolvedValue(undefined),
  };
}

function buildApp(base = VAULT, indexedFiles: string[] = [], openLeaves: TestLeaf[] = []): TestApp {
  const adapter = new (FileSystemAdapter as unknown as new (b: string) => unknown)(base);
  const newTab = leafShowing();
  return {
    workspace: {
      openLinkText: jest.fn(),
      iterateAllLeaves: (callback) => openLeaves.forEach(callback),
      leftSplit: { name: "left sidebar" },
      rightSplit: RIGHT_SIDEBAR,
      revealLeaf: jest.fn(),
      setActiveLeaf: jest.fn(),
      getLeaf: jest.fn(() => newTab),
    },
    metadataCache: {
      getFirstLinkpathDest: jest.fn((linkpath: string) =>
        indexedFiles.includes(linkpath) ? { path: linkpath } : null
      ),
    },
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

  describe("openVaultPath()", () => {
    it("focuses the tab already showing the note instead of opening a duplicate", async () => {
      const other = leafShowing("Other.md");
      const existing = leafShowing("Drawings/Plan.excalidraw.md", "excalidraw");
      const app = buildApp(VAULT, ["Drawings/Plan.excalidraw.md"], [other, existing]);
      open(app, "Drawings/Plan.excalidraw.md", true);
      await waitFor(() =>
        expect(app.workspace.setActiveLeaf).toHaveBeenCalledWith(existing, { focus: true })
      );
      expect(app.workspace.revealLeaf).toHaveBeenCalledWith(existing);
      expect(existing.openFile).not.toHaveBeenCalled();
      expect(app.workspace.openLinkText).not.toHaveBeenCalled();
    });

    it("loads a still-unloaded tab before revealing it and scrolling to the link's heading (https://github.com/Brevilabs/obsidian-copilot-private/issues/796)", async () => {
      const existing = leafShowing("Folder/Foo.md");
      const app = buildApp(VAULT, ["Folder/Foo.md"], [existing]);
      open(app, "Folder/Foo.md#Heading", true);
      await waitFor(() =>
        expect(existing.openFile).toHaveBeenCalledWith(
          { path: "Folder/Foo.md" },
          { eState: { subpath: "#Heading" } }
        )
      );
      expect(existing.loadIfDeferred.mock.invocationCallOrder[0]).toBeLessThan(
        app.workspace.revealLeaf.mock.invocationCallOrder[0]
      );
      expect(app.workspace.openLinkText).not.toHaveBeenCalled();
    });

    it("focuses a tab in a popout window but ignores sidebar panels tracking the note (https://github.com/Brevilabs/obsidian-copilot-private/issues/796)", async () => {
      const outline = leafShowing("Folder/Foo.md", "outline", RIGHT_SIDEBAR);
      const popout = leafShowing("Folder/Foo.md", "markdown", POPOUT_WINDOW);
      const app = buildApp(VAULT, ["Folder/Foo.md"], [outline, popout]);
      open(app, "Folder/Foo.md", true);
      await waitFor(() =>
        expect(app.workspace.setActiveLeaf).toHaveBeenCalledWith(popout, { focus: true })
      );
      expect(app.workspace.setActiveLeaf).not.toHaveBeenCalledWith(outline, expect.anything());
      expect(app.workspace.openLinkText).not.toHaveBeenCalled();
    });

    it("opens another tab on cmd/ctrl-click even when a tab already shows the note (https://github.com/Brevilabs/obsidian-copilot-private/issues/796)", () => {
      const existing = leafShowing("Folder/Foo.md");
      const app = buildApp(VAULT, ["Folder/Foo.md"], [existing]);
      openVaultPath(app as unknown as App, "Folder/Foo.md", {
        newLeaf: true,
        event: new MouseEvent("click", { metaKey: true }),
      });
      expect(app.workspace.setActiveLeaf).not.toHaveBeenCalled();
      expect(app.workspace.openLinkText).toHaveBeenCalledWith("Folder/Foo.md", "", "tab");
    });

    it("opens a new tab when no tab shows the note yet", () => {
      const app = buildApp(VAULT, ["Folder/Foo.md"], [leafShowing("Other.md")]);
      open(app, "Folder/Foo.md", true);
      expect(app.workspace.revealLeaf).not.toHaveBeenCalled();
      expect(app.workspace.openLinkText).toHaveBeenCalledWith("Folder/Foo.md", "", true);
    });

    it.each(["Slides.pdf#page=13", "Slides.PDF#page=14"])(
      "opens %s at the page top instead of inheriting the previous scroll offset (https://github.com/logancyang/obsidian-copilot/issues/3894)",
      (path) => {
        const app = buildApp(VAULT, [path.split("#")[0]]);
        openVaultPath(app as unknown as App, path, { sourcePath: "source.md", newLeaf: true });
        expect(app.workspace.openLinkText).toHaveBeenCalledWith(
          `${path}&offset=0,,0`,
          "source.md",
          true
        );
      }
    );

    it.each([
      "Slides.pdf#page=13&selection=0,1,2,3",
      "Slides.pdf#page=13&annotation=abc",
      "Slides.pdf#page=13&offset=1,2,3",
      "Slides.pdf#page=13&zoom=100",
      "Slides.pdf",
      "Note.md#page=13",
    ])(
      "preserves the existing destination for %s (https://github.com/logancyang/obsidian-copilot/issues/3894)",
      (path) => {
        const app = buildApp(VAULT, [path.split("#")[0]]);
        open(app, path);
        expect(app.workspace.openLinkText).toHaveBeenCalledWith(path, "", false);
      }
    );
  });

  describe("openFileInTab()", () => {
    it("focuses the tab already showing the file", async () => {
      const existing = leafShowing("Folder/Foo.md");
      const app = buildApp(VAULT, ["Folder/Foo.md"], [existing]);
      await openFileInTab(app as unknown as App, vaultFile("Folder/Foo.md"));
      expect(app.workspace.setActiveLeaf).toHaveBeenCalledWith(existing, { focus: true });
      expect(app.workspace.getLeaf).not.toHaveBeenCalled();
    });

    it("opens another tab on middle-click even when a tab already shows the file (https://github.com/Brevilabs/obsidian-copilot-private/issues/796)", async () => {
      const app = buildApp(VAULT, ["Folder/Foo.md"], [leafShowing("Folder/Foo.md")]);
      const file = vaultFile("Folder/Foo.md");
      await openFileInTab(app as unknown as App, file, new MouseEvent("auxclick", { button: 1 }));
      expect(app.workspace.setActiveLeaf).not.toHaveBeenCalled();
      expect(app.workspace.getLeaf).toHaveBeenCalledWith("tab");
    });

    it("opens the file in a new tab when no tab shows it", async () => {
      const app = buildApp(VAULT, ["Folder/Foo.md"], [leafShowing("Other.md")]);
      const file = vaultFile("Folder/Foo.md");
      await openFileInTab(app as unknown as App, file);
      expect(app.workspace.getLeaf).toHaveBeenCalledWith("tab");
      expect(app.workspace.getLeaf.mock.results[0].value.openFile).toHaveBeenCalledWith(file);
    });
  });

  describe("openLinkClickProps()", () => {
    function renderLink(open: jest.Mock): HTMLElement {
      render(React.createElement("a", { href: "#", ...openLinkClickProps(open) }, "Note"));
      return screen.getByText("Note");
    }

    it("opens on a primary click and on a middle click, handing over the native event", () => {
      const open = jest.fn();
      const link = renderLink(open);
      fireEvent.click(link, { metaKey: true });
      fireEvent(link, new MouseEvent("auxclick", { bubbles: true, button: 1 }));
      expect(open).toHaveBeenCalledTimes(2);
      expect(open.mock.calls[0][0]).toMatchObject({ type: "click", metaKey: true });
      expect(open.mock.calls[1][0]).toMatchObject({ type: "auxclick", button: 1 });
    });

    it("ignores a right click so the context menu does not open the note", () => {
      const open = jest.fn();
      const link = renderLink(open);
      fireEvent(link, new MouseEvent("auxclick", { bubbles: true, button: 2 }));
      expect(open).not.toHaveBeenCalled();
    });

    it("keeps the click from navigating the link or reaching the card that contains it", () => {
      const containerClick = jest.fn();
      render(
        React.createElement(
          "div",
          { onClick: containerClick },
          React.createElement("a", { href: "#", ...openLinkClickProps(jest.fn()) }, "Note")
        )
      );
      const notCancelled = fireEvent.click(screen.getByText("Note"));
      expect(notCancelled).toBe(false);
      expect(containerClick).not.toHaveBeenCalled();
    });
  });

  describe("unindexed paths that exist on disk", () => {
    let vaultDir: string;

    beforeEach(() => {
      vaultDir = fs.realpathSync(fs.mkdtempSync(nodePath.join(os.tmpdir(), "ovp-vault-")));
      fs.mkdirSync(nodePath.join(vaultDir, "copilot/skills"), { recursive: true });
      fs.writeFileSync(nodePath.join(vaultDir, "copilot/skills/voice-profile.md"), "hi");
      fs.mkdirSync(nodePath.join(vaultDir, ".claude"));
      fs.symlinkSync(
        nodePath.join(vaultDir, "copilot/skills"),
        nodePath.join(vaultDir, ".claude/skills")
      );
    });

    afterEach(() => {
      fs.rmSync(vaultDir, { recursive: true, force: true });
    });

    it("opens a dot-folder symlink alias as its canonical indexed note", () => {
      const app = buildApp(vaultDir, ["copilot/skills/voice-profile.md"]);
      open(app, ".claude/skills/voice-profile.md");
      expect(app.workspace.openLinkText).toHaveBeenCalledWith(
        "copilot/skills/voice-profile.md",
        "",
        false
      );
      expect(openWithSystemDefault).not.toHaveBeenCalled();
    });

    it("opens a root-relative dot-folder symlink alias as its canonical indexed note", () => {
      const app = buildApp(vaultDir, ["copilot/skills/voice-profile.md"]);
      open(app, "/.claude/skills/voice-profile.md");
      expect(app.workspace.openLinkText).toHaveBeenCalledWith(
        "copilot/skills/voice-profile.md",
        "",
        false
      );
      expect(openWithSystemDefault).not.toHaveBeenCalled();
    });

    it("preserves the heading anchor when canonicalizing a symlink alias", () => {
      const app = buildApp(vaultDir, ["copilot/skills/voice-profile.md"]);
      open(app, ".claude/skills/voice-profile.md#Closings");
      expect(app.workspace.openLinkText).toHaveBeenCalledWith(
        "copilot/skills/voice-profile.md#Closings",
        "",
        false
      );
    });

    it("opens an existing file with no indexed canonical path via the OS", () => {
      fs.writeFileSync(nodePath.join(vaultDir, ".claude/settings.json"), "{}");
      const app = buildApp(vaultDir);
      open(app, ".claude/settings.json");
      expect(app.workspace.openLinkText).not.toHaveBeenCalled();
      expect(openWithSystemDefault).toHaveBeenCalledWith(
        nodePath.join(vaultDir, ".claude/settings.json")
      );
    });

    it("hands a symlink that resolves outside the vault to the OS", () => {
      const outsideDir = fs.realpathSync(fs.mkdtempSync(nodePath.join(os.tmpdir(), "ovp-out-")));
      try {
        fs.writeFileSync(nodePath.join(outsideDir, "secret.md"), "hi");
        fs.symlinkSync(
          nodePath.join(outsideDir, "secret.md"),
          nodePath.join(vaultDir, "escape.md")
        );
        const app = buildApp(vaultDir);
        open(app, "escape.md");
        expect(app.workspace.openLinkText).not.toHaveBeenCalled();
        expect(openWithSystemDefault).toHaveBeenCalledWith(nodePath.join(outsideDir, "secret.md"));
      } finally {
        fs.rmSync(outsideDir, { recursive: true, force: true });
      }
    });

    it("still routes a genuinely missing note through openLinkText's create flow", () => {
      const app = buildApp(vaultDir);
      open(app, "Ideas/Not Written Yet");
      expect(app.workspace.openLinkText).toHaveBeenCalledWith("Ideas/Not Written Yet", "", false);
      expect(openWithSystemDefault).not.toHaveBeenCalled();
    });
  });
});
