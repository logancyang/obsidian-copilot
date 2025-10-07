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

jest.mock("./chunks", () => ({
  ChunkManager: jest.fn().mockImplementation(() => ({
    getChunks: jest.fn().mockResolvedValue([]),
  })),
}));

import { SearchCore } from "./SearchCore";

describe("SearchCore tag recall", () => {
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
      expandedTerms: [],
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

  it("should surface hierarchy-aware recall terms for hash tags", async () => {
    const searchCore = new SearchCore(mockApp as any);

    const results = await searchCore.retrieve("#ProjectAlpha/Phase1 update");

    expect(results).toHaveLength(1);
    const recallQueries = searchMock.mock.calls[0][0] as string[];

    expect(recallQueries).toEqual(
      expect.arrayContaining([
        "#projectalpha/phase1",
        "projectalpha/phase1",
        "projectalpha",
        "phase1",
      ])
    );

    const grepQueries = batchCachedReadGrepMock.mock.calls[0][0] as string[];
    expect(grepQueries).toEqual(
      expect.arrayContaining(["projectalpha/phase1", "projectalpha", "phase1"])
    );
  });

  it("should normalize recall queries for uppercase tag input", async () => {
    const searchCore = new SearchCore(mockApp as any);

    expandMock.mockResolvedValueOnce({
      queries: ["#BP progress"],
      salientTerms: ["#bp", "progress"],
      originalQuery: "#BP progress",
      expandedQueries: [],
      expandedTerms: [],
    });

    batchCachedReadGrepMock.mockResolvedValueOnce(["bp-note.md"]);

    await searchCore.retrieve("#BP progress");

    const recallQueries = searchMock.mock.calls[0][0];
    expect(recallQueries).toEqual(
      expect.arrayContaining(["#bp progress", "#bp", "progress", "bp"])
    );
    expect(recallQueries.every((term: string) => term === term.toLowerCase())).toBe(true);

    const grepQueries = batchCachedReadGrepMock.mock.calls[0][0];
    expect(grepQueries.every((term: string) => term === term.toLowerCase())).toBe(true);
  });

  it("should bypass ceilings when returnAll is enabled", async () => {
    const searchCore = new SearchCore(mockApp as any);

    buildFromCandidatesMock.mockResolvedValueOnce(5);
    batchCachedReadGrepMock.mockResolvedValueOnce(["note1.md", "note2.md"]);
    searchMock.mockReturnValueOnce([
      { id: "note1.md#0", score: 0.9, engine: "fulltext" },
      { id: "note2.md#0", score: 0.8, engine: "fulltext" },
    ]);

    const results = await searchCore.retrieve("#project", {
      salientTerms: ["#project"],
      returnAll: true,
    });

    expect(batchCachedReadGrepMock).toHaveBeenCalledWith(expect.any(Array), 200);
    expect(searchMock.mock.calls[0][1]).toBe(400);
    expect(results.length).toBe(2);
  });
});
