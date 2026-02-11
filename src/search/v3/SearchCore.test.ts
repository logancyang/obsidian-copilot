import { NoteIdRank } from "./interfaces";

jest.mock("@/settings/model", () => ({
  getSettings: jest.fn(() => ({ debug: false, enableLexicalBoosts: true })),
}));

const buildFromCandidatesMock = jest.fn();
const searchMock = jest.fn();
const clearMock = jest.fn();
const getStatsMock = jest.fn(() => ({
  documentsIndexed: 0,
  memoryUsed: 0,
  memoryPercent: 0,
}));
const expandMock = jest.fn();
const batchCachedReadGrepMock = jest.fn();
const applyFolderBoostMock = jest.fn((results: NoteIdRank[]) => results);
const applyGraphBoostMock = jest.fn((results: NoteIdRank[]) => results);
const normalizeMock = jest.fn((results: NoteIdRank[]) => results);

jest.mock("./engines/FullTextEngine", () => ({
  FullTextEngine: jest.fn().mockImplementation(() => ({
    buildFromCandidates: buildFromCandidatesMock,
    search: searchMock,
    clear: clearMock,
    getStats: getStatsMock,
  })),
}));

jest.mock("./QueryExpander", () => ({
  QueryExpander: jest.fn().mockImplementation(() => ({
    expand: expandMock,
    clearCache: jest.fn(),
  })),
}));

jest.mock("./scanners/GrepScanner", () => ({
  GrepScanner: jest.fn().mockImplementation(() => ({
    batchCachedReadGrep: batchCachedReadGrepMock,
    grep: jest.fn(),
  })),
}));

jest.mock("./scoring/FolderBoostCalculator", () => ({
  FolderBoostCalculator: jest.fn().mockImplementation(() => ({
    applyBoosts: applyFolderBoostMock,
  })),
}));

jest.mock("./scoring/GraphBoostCalculator", () => ({
  GraphBoostCalculator: jest.fn().mockImplementation(() => ({
    applyBoost: applyGraphBoostMock,
  })),
}));

jest.mock("./utils/ScoreNormalizer", () => ({
  ScoreNormalizer: jest.fn().mockImplementation(() => ({
    normalize: normalizeMock,
  })),
}));

jest.mock("./chunks", () => {
  const mockChunkManager = {
    getChunks: jest.fn().mockResolvedValue([]),
  };
  return {
    ChunkManager: jest.fn().mockImplementation(() => mockChunkManager),
    getSharedChunkManager: jest.fn().mockReturnValue(mockChunkManager),
  };
});

import { SearchCore, selectDiverseTopK } from "./SearchCore";

describe("SearchCore retrieve", () => {
  let mockApp: any;

  beforeEach(() => {
    buildFromCandidatesMock.mockReset();
    searchMock.mockReset();
    clearMock.mockReset();
    getStatsMock.mockReset();
    expandMock.mockReset();
    batchCachedReadGrepMock.mockReset();
    applyFolderBoostMock.mockReset();
    applyGraphBoostMock.mockReset();
    normalizeMock.mockReset();

    buildFromCandidatesMock.mockResolvedValue(1);
    searchMock.mockReturnValue([{ id: "note.md#0", score: 0.9, engine: "fulltext" }]);
    getStatsMock.mockReturnValue({ documentsIndexed: 1, memoryUsed: 0, memoryPercent: 0 });
    applyFolderBoostMock.mockImplementation((results: NoteIdRank[]) => results);
    applyGraphBoostMock.mockImplementation((results: NoteIdRank[]) => results);
    normalizeMock.mockImplementation((results: NoteIdRank[]) => results);

    expandMock.mockResolvedValue({
      queries: ["#ProjectAlpha/Phase1 update"],
      salientTerms: ["#projectalpha/phase1", "update"],
      originalQuery: "#ProjectAlpha/Phase1 update",
      expandedQueries: [],
    });
    batchCachedReadGrepMock.mockResolvedValue(["note.md"]);

    mockApp = {
      vault: {
        getMarkdownFiles: jest.fn(() => []),
        getAbstractFileByPath: jest.fn(() => null),
      },
      metadataCache: {
        getFileCache: jest.fn(() => undefined),
        resolvedLinks: {},
        getBacklinksForFile: jest.fn(() => ({ data: {} })),
      },
    };
  });

  it("should pass queries and salient terms as recall queries", async () => {
    const searchCore = new SearchCore(mockApp as any);

    const retrieveResult = await searchCore.retrieve("#ProjectAlpha/Phase1 update");

    expect(retrieveResult.results).toHaveLength(1);
    const recallQueries = searchMock.mock.calls[0][0] as string[];

    // Recall queries should contain the expanded query and salient terms (lowercased)
    expect(recallQueries).toEqual(
      expect.arrayContaining(["#projectalpha/phase1 update", "#projectalpha/phase1", "update"])
    );
  });

  it("should bypass ceilings when returnAll is enabled", async () => {
    const searchCore = new SearchCore(mockApp as any);

    buildFromCandidatesMock.mockResolvedValueOnce(5);
    batchCachedReadGrepMock.mockResolvedValueOnce(["note1.md", "note2.md"]);
    searchMock.mockReturnValueOnce([
      { id: "note1.md#0", score: 0.9, engine: "fulltext" },
      { id: "note2.md#0", score: 0.8, engine: "fulltext" },
    ]);

    const retrieveResult = await searchCore.retrieve("#project", {
      salientTerms: ["#project"],
      returnAll: true,
    });

    expect(batchCachedReadGrepMock).toHaveBeenCalledWith(expect.any(Array), 100);
    expect(searchMock.mock.calls[0][1]).toBe(300);
    expect(retrieveResult.results.length).toBe(2);
  });
});

describe("selectDiverseTopK", () => {
  it("should ensure all unique notes are represented before any note gets a second slot", () => {
    // 30 chunks from 3 notes, limit=15 → all 3 notes must appear
    const results: NoteIdRank[] = [];
    for (let note = 1; note <= 3; note++) {
      for (let chunk = 0; chunk < 10; chunk++) {
        results.push({
          id: `note${note}.md#${chunk}`,
          score: 1 - (note - 1) * 0.1 - chunk * 0.01,
        });
      }
    }
    // Sort descending by score
    results.sort((a, b) => b.score - a.score);

    const selected = selectDiverseTopK(results, 15);

    expect(selected).toHaveLength(15);

    // All 3 notes must be represented
    const uniqueNotes = new Set(selected.map((r) => r.id.split("#")[0]));
    expect(uniqueNotes.size).toBe(3);

    // Results should be sorted by score descending
    for (let i = 1; i < selected.length; i++) {
      expect(selected[i].score).toBeLessThanOrEqual(selected[i - 1].score);
    }
  });

  it("should pick top notes by score when more unique notes than limit", () => {
    // 20 chunks from 20 different notes, limit=10
    const results: NoteIdRank[] = Array.from({ length: 20 }, (_, i) => ({
      id: `note${i + 1}.md#0`,
      score: 1 - i * 0.05,
    }));

    const selected = selectDiverseTopK(results, 10);

    expect(selected).toHaveLength(10);

    // Should be the top 10 by score (since each note has 1 chunk)
    for (let i = 0; i < 10; i++) {
      expect(selected[i].id).toBe(`note${i + 1}.md#0`);
    }
  });

  it("should return all results unchanged when under limit", () => {
    const results: NoteIdRank[] = [
      { id: "a.md#0", score: 0.9 },
      { id: "b.md#0", score: 0.8 },
    ];

    const selected = selectDiverseTopK(results, 10);
    expect(selected).toEqual(results);
  });

  it("should maintain score ordering in output", () => {
    // Note A dominates with high scores but note B should still appear
    const results: NoteIdRank[] = [
      { id: "a.md#0", score: 0.95 },
      { id: "a.md#1", score: 0.9 },
      { id: "a.md#2", score: 0.85 },
      { id: "b.md#0", score: 0.5 },
      { id: "b.md#1", score: 0.45 },
    ];

    const selected = selectDiverseTopK(results, 3);

    expect(selected).toHaveLength(3);

    // Both notes represented
    const noteIds = new Set(selected.map((r) => r.id.split("#")[0]));
    expect(noteIds.has("a.md")).toBe(true);
    expect(noteIds.has("b.md")).toBe(true);

    // Score order maintained
    for (let i = 1; i < selected.length; i++) {
      expect(selected[i].score).toBeLessThanOrEqual(selected[i - 1].score);
    }
  });
});
