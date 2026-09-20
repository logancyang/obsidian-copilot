import {
  buildFileTypeOptions,
  canObsidianRenderFile,
  openVaultSearchResult,
  VaultSearchModalContent,
  type VaultSearchModalContentProps,
} from "@/vaultSearch/VaultSearchModal";
import { openWithSystemDefault } from "@/utils/openWithSystemDefault";
import type { SearchCandidate, SearchFile } from "@/vaultSearch/types";
import { fireEvent, render, screen } from "@testing-library/react";
import { FileSystemAdapter, Notice, Platform, TFile, type App } from "obsidian";
import React from "react";

jest.mock("@/utils/openWithSystemDefault", () => ({ openWithSystemDefault: jest.fn() }));

const issue = "https://github.com/Brevilabs/obsidian-copilot-private/issues/515";

const results: SearchCandidate[] = [
  {
    path: "Books/Stoicism.epub",
    title: "Stoicism",
    folder: "Books",
    extension: "epub",
    snippet: "A practical guide to Stoic philosophy",
    mtime: Date.UTC(2026, 8, 18),
    score: 0.91,
    source: "miyo",
  },
  {
    path: "Papers/Attention.pdf",
    title: "Attention",
    folder: "Papers",
    extension: "pdf",
    snippet: "Filename match",
    mtime: Date.UTC(2026, 8, 17),
    score: null,
    source: "filename",
  },
];

function props(
  overrides: Partial<VaultSearchModalContentProps> = {}
): VaultSearchModalContentProps {
  return {
    query: "stoicism",
    onQueryChange: jest.fn(),
    fileTypes: [
      { extension: "epub", count: 1, checked: true },
      { extension: "pdf", count: 1, checked: true },
    ],
    onTypeChange: jest.fn(),
    results,
    searching: false,
    miyoUnavailable: false,
    onOpen: jest.fn(),
    onClose: jest.fn(),
    isMobile: false,
    canOpenInObsidian: (extension) => extension === "pdf",
    ...overrides,
  };
}

describe("VaultSearchModal", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Platform.isMobile = false;
  });

  describe("buildFileTypeOptions()", () => {
    it(`derives counted file types and remembers unchecked selections (${issue})`, () => {
      const files: SearchFile[] = [
        { path: "a.md", name: "a.md", basename: "a", extension: "md", mtime: 0 },
        { path: "b.md", name: "b.md", basename: "b", extension: "md", mtime: 0 },
        { path: "c.pdf", name: "c.pdf", basename: "c", extension: "pdf", mtime: 0 },
      ];

      expect(buildFileTypeOptions(files, ["pdf"])).toEqual([
        { extension: "md", count: 2, checked: true },
        { extension: "pdf", count: 1, checked: false },
      ]);
    });
  });

  describe("VaultSearchModalContent()", () => {
    it(`renders result metadata and the Miyo-off fallback guidance (${issue})`, () => {
      render(<VaultSearchModalContent {...props({ miyoUnavailable: true })} />);

      expect(screen.getByText("Stoicism")).toBeTruthy();
      expect(screen.getByText("Books")).toBeTruthy();
      expect(screen.getAllByText("epub")).toHaveLength(2);
      expect(screen.getByText("A practical guide to Stoic philosophy")).toBeTruthy();
      expect(screen.getByText("0.91")).toBeTruthy();
      expect(screen.getByText("Enable Miyo for content search")).toBeTruthy();
    });

    it(`moves with arrows, opens with Enter, opens a new tab with Cmd/Ctrl+Enter, and closes with Escape (${issue})`, () => {
      const onOpen = jest.fn();
      const onClose = jest.fn();
      render(<VaultSearchModalContent {...props({ onOpen, onClose })} />);
      const input = screen.getByRole("searchbox");

      fireEvent.keyDown(input, { key: "ArrowDown" });
      fireEvent.keyDown(input, { key: "Enter" });
      fireEvent.keyDown(input, { key: "Enter", metaKey: true });
      fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
      fireEvent.keyDown(input, { key: "Escape" });

      expect(onOpen).toHaveBeenNthCalledWith(1, results[1], false);
      expect(onOpen).toHaveBeenNthCalledWith(2, results[1], true);
      expect(onOpen).toHaveBeenNthCalledWith(3, results[1], true);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it(`explains that an unrenderable result cannot open on mobile (${issue})`, () => {
      render(<VaultSearchModalContent {...props({ isMobile: true })} />);

      expect(screen.getByText("Unavailable on mobile")).toBeTruthy();
    });
  });

  describe("openVaultSearchResult()", () => {
    function appFor(path: string, extensionType: string | null): App {
      const File = TFile as unknown as new (path: string) => TFile;
      const file = new File(path);
      const Adapter = FileSystemAdapter as unknown as new (basePath: string) => FileSystemAdapter;
      return {
        vault: {
          adapter: new Adapter("/vault"),
          getAbstractFileByPath: jest.fn(() => file),
        },
        workspace: { openLinkText: jest.fn().mockResolvedValue(undefined) },
        viewRegistry: { getTypeByExtension: jest.fn(() => extensionType) },
      } as unknown as App;
    }

    it(`opens renderable files in Obsidian and honors the new-tab modifier (${issue})`, async () => {
      const app = appFor("Papers/Attention.pdf", "pdf");

      await expect(openVaultSearchResult(app, results[1], true)).resolves.toBe(true);

      expect(app.workspace.openLinkText).toHaveBeenCalledWith("Papers/Attention.pdf", "", true);
      expect(openWithSystemDefault).not.toHaveBeenCalled();
    });

    it(`opens files without an Obsidian view in the desktop default app (${issue})`, async () => {
      Platform.isMobile = false;
      const app = appFor("Books/Stoicism.epub", null);

      await expect(openVaultSearchResult(app, results[0], false)).resolves.toBe(true);

      expect(openWithSystemDefault).toHaveBeenCalledWith("/vault/Books/Stoicism.epub");
      expect(app.workspace.openLinkText).not.toHaveBeenCalled();
      expect(canObsidianRenderFile(app, "epub")).toBe(false);
    });

    it(`keeps search open with a Notice for stale, mobile-unavailable, and rejected results (${issue})`, async () => {
      const staleApp = appFor("Books/Missing.epub", null);
      staleApp.vault.getAbstractFileByPath = jest.fn(() => null);
      const mobileApp = appFor("Books/Stoicism.epub", null);
      const desktopApp = appFor("Books/Stoicism.epub", null);

      await expect(openVaultSearchResult(staleApp, results[0], false)).resolves.toBe(false);
      Platform.isMobile = true;
      await expect(openVaultSearchResult(mobileApp, results[0], false)).resolves.toBe(false);
      Platform.isMobile = false;
      jest.mocked(openWithSystemDefault).mockRejectedValueOnce(new Error("shell unavailable"));
      await expect(openVaultSearchResult(desktopApp, results[0], false)).resolves.toBe(false);

      expect(Notice).toHaveBeenCalledTimes(3);
      expect(Notice).toHaveBeenLastCalledWith("Could not open this file.");
    });
  });
});
