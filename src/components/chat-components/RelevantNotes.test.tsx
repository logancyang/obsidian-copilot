/* eslint-disable @eslint-react/hooks-extra/no-unnecessary-use-prefix -- Mock exports must preserve production hook names. */
import { RelevantNotes } from "@/components/chat-components/RelevantNotes";
import { useActiveFile } from "@/hooks/useActiveFile";
import { findRelevantNotes } from "@/search/findRelevantNotes";
import { openCopilotSettings } from "@/settings/openSettings";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TFile } from "obsidian";
import React from "react";

const mockOpenFile = jest.fn().mockResolvedValue(undefined);
const mockGetLeaf = jest.fn(() => ({ openFile: mockOpenFile }));
const mockApp = {
  vault: {
    getAbstractFileByPath: jest.fn(),
    cachedRead: jest.fn().mockResolvedValue(""),
  },
  workspace: {
    getLeaf: mockGetLeaf,
  },
};
let mockSettings = {
  enableMiyo: false,
  miyoServerUrl: "",
  qaInclusions: "",
  qaExclusions: "",
};

jest.mock("@/context", () => ({
  useApp: () => mockApp,
}));

jest.mock("@/hooks/useActiveFile", () => ({
  useActiveFile: jest.fn(),
}));

jest.mock("@/hooks/useNoteDrag", () => ({
  useNoteDrag: () => jest.fn(),
}));

jest.mock("@/search/findRelevantNotes", () => ({
  findRelevantNotes: jest.fn(),
}));

jest.mock("@/search/indexSignal", () => ({
  onIndexChanged: () => jest.fn(),
}));

jest.mock("@/search/searchUtils", () => ({
  getMatchingPatterns: () => ({ inclusions: [], exclusions: [] }),
  shouldIndexFile: () => true,
}));

jest.mock("@/settings/model", () => ({
  useSettingsValue: () => mockSettings,
}));

jest.mock("@/settings/openSettings", () => ({ openCopilotSettings: jest.fn() }));

const mockUseActiveFile = useActiveFile as jest.MockedFunction<typeof useActiveFile>;
const mockFindRelevantNotes = findRelevantNotes as jest.MockedFunction<typeof findRelevantNotes>;

function makeMarkdownFile(path: string): TFile {
  const MockTFile = TFile as unknown as new (path: string) => TFile;
  return new MockTFile(path);
}

describe("RelevantNotes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSettings = {
      enableMiyo: false,
      miyoServerUrl: "",
      qaInclusions: "",
      qaExclusions: "",
    };
    const sourceFile = makeMarkdownFile("Source.md");
    const targetFile = makeMarkdownFile("Target.md");
    mockUseActiveFile.mockReturnValue(sourceFile);
    mockApp.vault.getAbstractFileByPath.mockImplementation((path: string) =>
      path === targetFile.path ? targetFile : sourceFile
    );
    mockFindRelevantNotes.mockResolvedValue([
      {
        note: { path: targetFile.path, title: targetFile.basename },
        metadata: {
          score: 0.8,
          similarityScore: 0.8,
          hasOutgoingLinks: false,
          hasBacklinks: false,
        },
      },
    ]);
  });

  describe("RelevantNotes()", () => {
    it("opens a result in a new leaf", async () => {
      render(<RelevantNotes onAddToChat={jest.fn()} />);

      fireEvent.click(await screen.findByText("Target"));

      expect(mockGetLeaf).toHaveBeenCalledWith(true);
      expect(mockOpenFile).toHaveBeenCalledWith(expect.objectContaining({ path: "Target.md" }));
    });

    it("keeps links-only rows visible without a meter and shows Miyo download guidance (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", async () => {
      mockFindRelevantNotes.mockResolvedValue([
        {
          note: { path: "Target.md", title: "Target" },
          metadata: {
            score: 0,
            similarityScore: undefined,
            hasOutgoingLinks: false,
            hasBacklinks: true,
          },
        },
      ]);

      render(<RelevantNotes onAddToChat={jest.fn()} />);

      expect(await screen.findByText("Target")).toBeTruthy();
      expect(screen.getByText("Add semantic matches with Miyo")).toBeTruthy();
      expect(screen.queryByText(/%/)).toBeNull();
    });

    it("shows setup guidance for links-only rows when Miyo is enabled and opens the Miyo settings tab (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", async () => {
      mockSettings = { ...mockSettings, enableMiyo: true };
      mockFindRelevantNotes.mockResolvedValue([
        {
          note: { path: "Target.md", title: "Target" },
          metadata: {
            score: 0,
            similarityScore: undefined,
            hasOutgoingLinks: true,
            hasBacklinks: false,
          },
        },
      ]);

      render(<RelevantNotes onAddToChat={jest.fn()} />);

      fireEvent.click(await screen.findByRole("button", { name: "Open Miyo settings" }));
      expect(openCopilotSettings).toHaveBeenCalledWith(mockApp, window, "miyo");
    });

    it("refetches Relevant Notes when Miyo settings change (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", async () => {
      const { rerender } = render(<RelevantNotes onAddToChat={jest.fn()} />);
      await waitFor(() => expect(mockFindRelevantNotes).toHaveBeenCalledTimes(1));

      mockSettings = { ...mockSettings, enableMiyo: true };
      rerender(<RelevantNotes onAddToChat={jest.fn()} />);

      await waitFor(() => expect(mockFindRelevantNotes).toHaveBeenCalledTimes(2));
    });

    it("keeps a superseded Miyo request from overwriting newer results (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", async () => {
      let resolveFirst:
        | ((notes: Awaited<ReturnType<typeof findRelevantNotes>>) => void)
        | undefined;
      const firstResult = new Promise<Awaited<ReturnType<typeof findRelevantNotes>>>((resolve) => {
        resolveFirst = resolve;
      });
      mockFindRelevantNotes.mockReturnValueOnce(firstResult).mockResolvedValueOnce([
        {
          note: { path: "Current.md", title: "Current" },
          metadata: {
            score: 0.9,
            similarityScore: 0.9,
            hasOutgoingLinks: false,
            hasBacklinks: false,
          },
        },
      ]);

      const { rerender } = render(<RelevantNotes onAddToChat={jest.fn()} />);
      await waitFor(() => expect(mockFindRelevantNotes).toHaveBeenCalledTimes(1));

      mockSettings = { ...mockSettings, enableMiyo: true, miyoServerUrl: "https://new-miyo" };
      rerender(<RelevantNotes onAddToChat={jest.fn()} />);
      expect(await screen.findByText("Current")).toBeTruthy();

      await act(async () => {
        resolveFirst?.([
          {
            note: { path: "Stale.md", title: "Stale" },
            metadata: {
              score: 0.7,
              similarityScore: 0.7,
              hasOutgoingLinks: false,
              hasBacklinks: false,
            },
          },
        ]);
        await firstResult;
      });

      expect(screen.queryByText("Stale")).toBeNull();
      expect(screen.getByText("Current")).toBeTruthy();
    });

    it("keeps a superseded Miyo failure from clearing newer results (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", async () => {
      let rejectFirst: ((reason: Error) => void) | undefined;
      const firstResult = new Promise<Awaited<ReturnType<typeof findRelevantNotes>>>(
        (_, reject) => {
          rejectFirst = reject;
        }
      );
      mockFindRelevantNotes.mockReturnValueOnce(firstResult).mockResolvedValueOnce([
        {
          note: { path: "Current.md", title: "Current" },
          metadata: {
            score: 0.9,
            similarityScore: 0.9,
            hasOutgoingLinks: false,
            hasBacklinks: false,
          },
        },
      ]);

      const { rerender } = render(<RelevantNotes onAddToChat={jest.fn()} />);
      await waitFor(() => expect(mockFindRelevantNotes).toHaveBeenCalledTimes(1));

      mockSettings = { ...mockSettings, enableMiyo: true, miyoServerUrl: "https://new-miyo" };
      rerender(<RelevantNotes onAddToChat={jest.fn()} />);
      expect(await screen.findByText("Current")).toBeTruthy();

      await act(async () => {
        rejectFirst?.(new Error("Old endpoint failed"));
        await expect(firstResult).rejects.toThrow("Old endpoint failed");
      });

      expect(screen.getByText("Current")).toBeTruthy();
    });
  });
});
