/* eslint-disable @eslint-react/hooks-extra/no-unnecessary-use-prefix -- Mock exports must preserve production hook names. */
import { RelevantNotes } from "@/components/chat-components/RelevantNotes";
import { useActiveFile } from "@/hooks/useActiveFile";
import { findRelevantNotes } from "@/search/findRelevantNotes";
import { fireEvent, render, screen } from "@testing-library/react";
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

jest.mock("@/aiParams", () => ({
  useIndexingProgress: () => [{ isActive: false, indexedCount: 0, totalFiles: 0 }],
}));

jest.mock("@/components/modals/SemanticSearchToggleModal", () => ({
  SemanticSearchToggleModal: jest.fn(),
}));

jest.mock("@/context", () => ({
  useApp: () => mockApp,
}));

jest.mock("@/hooks/useActiveFile", () => ({
  useActiveFile: jest.fn(),
}));

jest.mock("@/hooks/useNoteDrag", () => ({
  useNoteDrag: () => jest.fn(),
}));

jest.mock("@/miyo/miyoUtils", () => ({
  getSearchBackend: () => "keyword",
  shouldUseMiyo: () => false,
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

jest.mock("@/search/vectorStoreManager", () => ({
  __esModule: true,
  default: {
    getInstance: () => ({
      hasIndex: jest.fn().mockResolvedValue(true),
      indexVaultToVectorStore: jest.fn().mockResolvedValue(undefined),
    }),
  },
}));

jest.mock("@/settings/model", () => ({
  getSettings: () => ({ enableSemanticSearchV3: true }),
  updateSetting: jest.fn(),
  useSettingsValue: () => ({ qaInclusions: "", qaExclusions: "" }),
}));

const mockUseActiveFile = useActiveFile as jest.MockedFunction<typeof useActiveFile>;
const mockFindRelevantNotes = findRelevantNotes as jest.MockedFunction<typeof findRelevantNotes>;

function makeMarkdownFile(path: string): TFile {
  const MockTFile = TFile as unknown as new (path: string) => TFile;
  return new MockTFile(path);
}

describe("RelevantNotes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
  });
});
