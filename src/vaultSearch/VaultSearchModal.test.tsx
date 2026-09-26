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
      { id: "epub", label: "epub", extensions: ["epub"], count: 1, checked: true },
      { id: "pdf", label: "pdf", extensions: ["pdf"], count: 1, checked: true },
    ],
    onTypeChange: jest.fn(),
    results,
    searching: false,
    miyoUnavailable: false,
    aiBoostEnabled: false,
    aiBoostLicensed: true,
    aiBoosting: false,
    aiBoostAttemptCompleted: false,
    aiBoostUnavailable: false,
    onAiBoostChange: jest.fn(),
    onAiBoostNow: jest.fn(),
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
        {
          path: "a.md",
          name: "a.md",
          basename: "a",
          extension: "md",
          ctime: 0,
          mtime: 0,
          size: 0,
          tags: [],
        },
        {
          path: "b.md",
          name: "b.md",
          basename: "b",
          extension: "md",
          ctime: 0,
          mtime: 0,
          size: 0,
          tags: [],
        },
        {
          path: "c.pdf",
          name: "c.pdf",
          basename: "c",
          extension: "pdf",
          ctime: 0,
          mtime: 0,
          size: 0,
          tags: [],
        },
      ];

      expect(buildFileTypeOptions(files, ["pdf"])).toEqual([
        { id: "md", label: "md", extensions: ["md"], count: 2, checked: true },
        { id: "pdf", label: "pdf", extensions: ["pdf"], count: 1, checked: false },
      ]);
    });

    it(`shows five common Miyo types plus one Other control for everything else (${issue})`, () => {
      const extensions = [
        ["md", 20],
        ["pdf", 15],
        ["epub", 10],
        ["docx", 8],
        ["txt", 7],
        ["cmd", 6],
        ["ps1", 5],
        ["mjs", 4],
        ["", 3],
      ] as const;
      const files = extensions.flatMap(([extension, count]) =>
        Array.from(
          { length: count },
          (_, index): SearchFile => ({
            path: `${extension || "none"}-${index}${extension ? `.${extension}` : ""}`,
            name: `${extension || "none"}-${index}${extension ? `.${extension}` : ""}`,
            basename: `${extension || "none"}-${index}`,
            extension,
            ctime: 0,
            mtime: 0,
            size: 0,
            tags: [],
          })
        )
      );

      const options = buildFileTypeOptions(files, ["ps1"]);

      expect(options).toHaveLength(6);
      expect(options.map(({ label }) => label)).toEqual([
        "md",
        "pdf",
        "epub",
        "docx",
        "txt",
        "Other",
      ]);
      expect(options[5]).toMatchObject({ count: 18, checked: false });
      expect(options[5].extensions).toEqual(["", "cmd", "mjs", "ps1"]);
    });
  });

  describe("VaultSearchModalContent()", () => {
    it(`keeps a spacious result viewport fixed while search results change (${issue})`, () => {
      const view = render(<VaultSearchModalContent {...props()} />);
      const modalBody = view.container.firstElementChild;

      expect(modalBody?.classList.contains("tw-h-[min(72vh,42rem)]")).toBe(true);
      expect(modalBody?.classList.contains("tw-max-h-[calc(100vh-6rem)]")).toBe(true);
      expect(modalBody?.classList.contains("tw-overflow-hidden")).toBe(true);
      expect(modalBody?.classList.contains("tw-px-6")).toBe(true);

      view.rerender(<VaultSearchModalContent {...props({ results: [], searching: true })} />);

      expect(view.container.firstElementChild).toBe(modalBody);
      expect(modalBody?.classList.contains("tw-h-[min(72vh,42rem)]")).toBe(true);
    });

    it(`shows clickable content and filename suggestions instead of files for an empty basic search (${issue})`, () => {
      const onQueryChange = jest.fn();
      const view = render(
        <VaultSearchModalContent {...props({ query: "", aiBoostEnabled: false, onQueryChange })} />
      );

      expect(screen.queryAllByRole("option")).toHaveLength(0);
      expect(screen.getByText("Try content or filename search")).toBeTruthy();
      expect(screen.getByRole("button", { name: "notes about project planning" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "meeting notes" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "research in epub files" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "the largest epub" })).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "meeting notes" }));
      expect(onQueryChange).toHaveBeenCalledWith("meeting notes");

      view.rerender(
        <VaultSearchModalContent
          {...props({
            query: "",
            aiBoostEnabled: false,
            onQueryChange,
            fileTypes: [
              {
                id: "other",
                label: "Other",
                extensions: ["cmd"],
                count: 1,
                checked: true,
              },
            ],
          })}
        />
      );
      expect(screen.getByRole("button", { name: "research in files" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "research in cmd files" })).toBeNull();
    });

    it(`switches empty search to type-aware comparison, decision, and cross-language AI suggestions (${"https://github.com/Brevilabs/obsidian-copilot-private/issues/516"})`, () => {
      const onQueryChange = jest.fn();
      render(
        <VaultSearchModalContent {...props({ query: "", aiBoostEnabled: true, onQueryChange })} />
      );

      expect(screen.queryAllByRole("option")).toHaveLength(0);
      expect(screen.getByText("Try AI boost")).toBeTruthy();
      expect(screen.getByRole("button", { name: "the largest epub" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "the newest pdf" })).toBeTruthy();
      expect(
        screen.getByRole("button", { name: "the note where I decided against a tool" })
      ).toBeTruthy();
      expect(screen.getByRole("button", { name: "我决定不用某个工具的那篇笔记" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "meeting notes" })).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "the largest epub" }));
      expect(onQueryChange).toHaveBeenCalledWith("the largest epub");
    });

    it(`renders result metadata and the Miyo-off fallback guidance (${issue})`, () => {
      render(<VaultSearchModalContent {...props({ miyoUnavailable: true })} />);

      expect(screen.getByText("Stoicism")).toBeTruthy();
      expect(screen.getByText("Books")).toBeTruthy();
      expect(screen.getAllByText("epub")).toHaveLength(2);
      expect(screen.getByText("A practical guide to Stoic philosophy")).toBeTruthy();
      expect(screen.getByText("91%").getAttribute("title")).toBe("Similarity");
      expect(screen.getByText("Enable Miyo for content search")).toBeTruthy();
      expect(screen.getByText("91%").closest("button")?.className).toContain("tw-border-0");
    });

    it(`leaves the folder slot blank for a file at the vault root (${issue})`, () => {
      render(
        <VaultSearchModalContent
          {...props({
            results: [
              {
                ...results[0],
                path: "Stoicism.epub",
                folder: "",
                mtime: 0,
              },
            ],
          })}
        />
      );

      expect(screen.queryByText("/", { exact: true })).toBeNull();
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

      expect(screen.getByLabelText("Unavailable on mobile")).toBeTruthy();
    });

    it(`shows a disabled license state without an upsell action (${"https://github.com/Brevilabs/obsidian-copilot-private/issues/516"})`, () => {
      render(<VaultSearchModalContent {...props({ aiBoostLicensed: false })} />);

      expect(screen.getByRole("switch", { name: "AI boost" }).getAttribute("aria-disabled")).toBe(
        "true"
      );
      expect(screen.getByText("License required")).toBeTruthy();
      expect(screen.queryByRole("link")).toBeNull();
      expect(screen.queryByRole("button", { name: /license/i })).toBeNull();
    });

    it(`shows Jev probabilities as percentages and keeps selection on the same file after re-sort (${"https://github.com/Brevilabs/obsidian-copilot-private/issues/516"})`, () => {
      const boosted = results.map((result, index) => ({
        ...result,
        boostScore: index === 0 ? 0.92 : 0.61,
      }));
      const { rerender } = render(<VaultSearchModalContent {...props({ results: boosted })} />);
      fireEvent.mouseEnter(screen.getByText("Attention").closest("button")!);

      rerender(<VaultSearchModalContent {...props({ results: [...boosted].reverse() })} />);

      expect(screen.getByText("92%")).toBeTruthy();
      expect(screen.getByText("61%")).toBeTruthy();
      expect(screen.getByText("92%").getAttribute("title")).toBe("AI boost relevance");
      expect(screen.getByText("Attention").closest("button")?.getAttribute("aria-selected")).toBe(
        "true"
      );
    });

    it(`separates low-probability rows and calls out an all-low boost result (${"https://github.com/Brevilabs/obsidian-copilot-private/issues/516"})`, () => {
      const { rerender } = render(
        <VaultSearchModalContent
          {...props({
            aiBoostEnabled: true,
            aiBoostAttemptCompleted: true,
            results: [
              { ...results[0], boostScore: 0.83 },
              { ...results[1], boostScore: 0.31 },
            ],
          })}
        />
      );

      expect(screen.getByText("Less likely")).toBeTruthy();
      expect(screen.queryByText("No strong match")).toBeNull();

      rerender(
        <VaultSearchModalContent
          {...props({
            aiBoostEnabled: true,
            aiBoostAttemptCompleted: true,
            results: results.map((result, index) => ({
              ...result,
              boostScore: index === 0 ? 0.42 : 0.18,
            })),
          })}
        />
      );

      expect(screen.getByText("No strong match")).toBeTruthy();
      expect(screen.queryByText("Less likely")).toBeNull();
    });

    it(`keeps Miyo order without confidence banners when every AI boost batch fails (${"https://github.com/Brevilabs/obsidian-copilot-private/issues/516"})`, () => {
      render(
        <VaultSearchModalContent
          {...props({
            aiBoostEnabled: true,
            aiBoostAttemptCompleted: true,
            aiBoostUnavailable: true,
            results: [
              { ...results[0], score: 0.75 },
              { ...results[1], score: 0.62 },
            ],
          })}
        />
      );

      expect(screen.getByText("AI boost unavailable")).toBeTruthy();
      expect(screen.queryByText("No strong match")).toBeNull();
      expect(screen.queryByText("Less likely")).toBeNull();
      expect(
        screen.getAllByRole("option").map((row) => row.querySelector(".tw-text-sm")?.textContent)
      ).toEqual(["Stoicism", "Attention"]);
    });

    it(`uses Enter to run a pending AI boost immediately, then opens the boosted result (${"https://github.com/Brevilabs/obsidian-copilot-private/issues/516"})`, () => {
      const onAiBoostNow = jest.fn();
      const onOpen = jest.fn();
      const { rerender } = render(
        <VaultSearchModalContent {...props({ aiBoostEnabled: true, onAiBoostNow, onOpen })} />
      );

      fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Enter" });
      expect(onAiBoostNow).toHaveBeenCalledTimes(1);
      expect(onOpen).not.toHaveBeenCalled();

      rerender(
        <VaultSearchModalContent
          {...props({
            aiBoostEnabled: true,
            onAiBoostNow,
            onOpen,
            results: [{ ...results[0], boostScore: 0.92 }, results[1]],
          })}
        />
      );
      fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Enter" });
      expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ boostScore: 0.92 }), false);
    });

    it(`opens the selected result on Enter after an AI boost attempt fails (${"https://github.com/Brevilabs/obsidian-copilot-private/issues/516"})`, () => {
      const onAiBoostNow = jest.fn();
      const onOpen = jest.fn();
      const { rerender } = render(
        <VaultSearchModalContent {...props({ aiBoostEnabled: true, onAiBoostNow, onOpen })} />
      );

      fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Enter" });
      expect(onAiBoostNow).toHaveBeenCalledTimes(1);

      const completedAttemptProps = {
        ...props({ aiBoostEnabled: true, onAiBoostNow, onOpen }),
        aiBoostAttemptCompleted: true,
      };
      rerender(<VaultSearchModalContent {...completedAttemptProps} />);
      fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Enter" });

      expect(onAiBoostNow).toHaveBeenCalledTimes(1);
      expect(onOpen).toHaveBeenCalledWith(results[0], false);
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
