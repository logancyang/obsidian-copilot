import { App } from "obsidian";
import { SearchCore } from "./SearchCore";

// Mock dependencies
jest.mock("@/logger");

describe("SearchCore - Semantic Independence", () => {
  let app: App;
  let searchCore: SearchCore;

  beforeEach(() => {
    // Create comprehensive mock app
    app = {
      vault: {
        getAbstractFileByPath: jest.fn().mockReturnValue({ name: "test.md" }),
        getMarkdownFiles: jest.fn().mockReturnValue([]),
        cachedRead: jest.fn().mockResolvedValue(""),
      },
      metadataCache: {
        getCache: jest.fn().mockReturnValue(null),
        getFirstLinkpathDest: jest.fn().mockReturnValue(null),
        getFileCache: jest.fn().mockReturnValue(null),
      },
    } as any;

    searchCore = new SearchCore(app);

    // Mock all the core components to prevent errors
    const folderBoostCalculator = (searchCore as any).folderBoostCalculator;
    const graphBoostCalculator = (searchCore as any).graphBoostCalculator;
    const scoreNormalizer = (searchCore as any).scoreNormalizer;

    folderBoostCalculator.applyBoosts = jest.fn((results) => results);
    graphBoostCalculator.applyBoost = jest.fn((results) => results);
    scoreNormalizer.normalize = jest.fn((results) => results);
  });

  it("should return semantic results even when they are outside grep candidates", async () => {
    const grepScanner = (searchCore as any).grepScanner;
    const fullTextEngine = (searchCore as any).fullTextEngine;
    const queryExpander = (searchCore as any).queryExpander;

    // Mock grep to return only a few files (small candidate set)
    const grepResults = ["note1.md", "note2.md"];
    grepScanner.batchCachedReadGrep = jest.fn().mockResolvedValue(grepResults);

    // Mock query expansion
    queryExpander.expand = jest.fn().mockResolvedValue({
      queries: ["test query"],
      salientTerms: ["test"],
      originalQuery: "test query",
      expandedQueries: [],
      expandedTerms: [],
    });

    // Mock full-text engine
    fullTextEngine.buildFromCandidates = jest.fn().mockResolvedValue(2);
    fullTextEngine.search = jest.fn().mockReturnValue([
      { id: "note1.md#0", score: 0.9, engine: "lexical" },
      { id: "note2.md#0", score: 0.8, engine: "lexical" },
    ]);
    fullTextEngine.clear = jest.fn();
    fullTextEngine.getStats = jest.fn().mockReturnValue({
      documentsIndexed: 2,
      memoryUsed: 100,
      memoryPercent: 0.01,
    });

    // Mock semantic search to return results OUTSIDE the grep candidates
    const memoryIndex = await import("./MemoryIndexManager");
    const mockSearch = jest.fn().mockResolvedValue([
      { id: "semantic1.md#0", score: 0.95 }, // Not in grep results!
      { id: "semantic2.md#0", score: 0.85 }, // Not in grep results!
      { id: "note1.md#0", score: 0.75 }, // Also in grep results
    ]);

    jest.spyOn(memoryIndex.MemoryIndexManager, "getInstance").mockReturnValue({
      search: mockSearch,
    } as any);

    // Perform search with semantic enabled
    const results = await searchCore.retrieve("test query", {
      enableSemantic: true,
      semanticWeight: 0.5, // 50% semantic, 50% lexical
      maxResults: 10,
    });

    // Verify semantic search was called WITHOUT candidates (independent search)
    expect(mockSearch).toHaveBeenCalledWith(["test query"], expect.any(Number));
    expect(mockSearch).toHaveBeenCalledTimes(1);
    const callArgs = mockSearch.mock.calls[0];
    expect(callArgs[2]).toBeUndefined(); // No candidates passed

    // Verify results include semantic matches outside grep candidates
    const resultIds = results.map((r) => r.id);
    expect(resultIds).toContain("semantic1.md#0"); // Should include semantic result not in grep
    expect(resultIds).toContain("semantic2.md#0"); // Should include semantic result not in grep

    // Results should be a fusion of lexical and semantic
    expect(results.length).toBeGreaterThan(2); // More than just the 2 grep results
  });

  it("should work with 100% semantic weight and return results outside grep candidates", async () => {
    const grepScanner = (searchCore as any).grepScanner;
    const queryExpander = (searchCore as any).queryExpander;

    // Mock very limited grep results
    const grepResults = ["note1.md"];
    grepScanner.batchCachedReadGrep = jest.fn().mockResolvedValue(grepResults);

    // Mock query expansion
    queryExpander.expand = jest.fn().mockResolvedValue({
      queries: ["semantic query"],
      salientTerms: ["semantic"],
      originalQuery: "semantic query",
      expandedQueries: [],
      expandedTerms: [],
    });

    // Mock semantic search to return results completely outside grep candidates
    const memoryIndex = await import("./MemoryIndexManager");
    const mockSearch = jest.fn().mockResolvedValue([
      { id: "semantic_only1.md#0", score: 0.95 }, // Not in grep results!
      { id: "semantic_only2.md#0", score: 0.85 }, // Not in grep results!
      { id: "semantic_only3.md#0", score: 0.75 }, // Not in grep results!
    ]);

    jest.spyOn(memoryIndex.MemoryIndexManager, "getInstance").mockReturnValue({
      search: mockSearch,
    } as any);

    // Perform search with 100% semantic weight (should skip lexical entirely)
    const results = await searchCore.retrieve("semantic query", {
      enableSemantic: true,
      semanticWeight: 1.0, // 100% semantic
      maxResults: 10,
    });

    // Verify semantic search was called without candidates
    expect(mockSearch).toHaveBeenCalledWith(["semantic query"], expect.any(Number));
    const callArgs = mockSearch.mock.calls[0];
    expect(callArgs[2]).toBeUndefined(); // No candidates passed

    // All results should be semantic results, none from the limited grep set
    expect(results).toHaveLength(3);
    expect(results[0].id).toBe("semantic_only1.md#0");
    expect(results[1].id).toBe("semantic_only2.md#0");
    expect(results[2].id).toBe("semantic_only3.md#0");

    // All results should have semantic engine
    expect(results.every((r) => r.engine === "semantic")).toBe(true);
  });
});
