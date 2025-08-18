import { App } from "obsidian";
import { SearchCore } from "./SearchCore";

// Mock dependencies
jest.mock("@/logger");

describe("SearchCore - Candidate Limits", () => {
  let app: App;
  let searchCore: SearchCore;

  beforeEach(() => {
    // Create mock app
    app = {
      vault: {
        getAbstractFileByPath: jest.fn(),
      },
      metadataCache: {
        getCache: jest.fn().mockReturnValue(null),
        getFirstLinkpathDest: jest.fn().mockReturnValue(null),
      },
    } as any;

    searchCore = new SearchCore(app);
  });

  it("should pass the same candidates to both full-text and semantic search", async () => {
    const grepScanner = (searchCore as any).grepScanner;
    const fullTextEngine = (searchCore as any).fullTextEngine;
    const queryExpander = (searchCore as any).queryExpander;

    // Mock a large set of grep results
    const grepResults = Array.from({ length: 300 }, (_, i) => `note${i}.md`);
    grepScanner.batchCachedReadGrep = jest.fn().mockResolvedValue(grepResults);

    // Mock query expansion
    queryExpander.expand = jest.fn().mockResolvedValue({
      queries: ["test query"],
      salientTerms: ["test"],
      originalQuery: "test query",
      expandedQueries: [],
      expandedTerms: [],
    });

    // Track what candidates are passed to full-text
    let fullTextCandidates: string[] = [];
    fullTextEngine.buildFromCandidates = jest.fn(async (candidates: string[]) => {
      fullTextCandidates = [...candidates];
      return candidates.length;
    });
    fullTextEngine.search = jest.fn().mockReturnValue([]);
    fullTextEngine.clear = jest.fn();
    fullTextEngine.getStats = jest.fn().mockReturnValue({
      documentsIndexed: 0,
      memoryUsed: 0,
      memoryPercent: 0,
    });

    // Mock semantic search with a spy to capture candidates
    let semanticCandidates: string[] | undefined;
    const memoryIndex = await import("./MemoryIndexManager");
    const mockSearch = jest.fn(async (queries: string[], topK: number, candidates?: string[]) => {
      semanticCandidates = candidates;
      return [];
    });

    jest.spyOn(memoryIndex.MemoryIndexManager, "getInstance").mockReturnValue({
      search: mockSearch,
    } as any);

    // Perform search with semantic enabled and specific candidate limit
    const candidateLimit = 100;
    await searchCore.retrieve("test query", {
      enableSemantic: true,
      candidateLimit,
      maxResults: 10,
    });

    // Verify both engines got the same candidates
    expect(fullTextCandidates).toHaveLength(candidateLimit);
    expect(semanticCandidates).toEqual(fullTextCandidates);
    expect(semanticCandidates).toEqual(grepResults.slice(0, candidateLimit));
  });

  it("should not exceed candidateLimit even with fewer grep results", async () => {
    const grepScanner = (searchCore as any).grepScanner;
    const fullTextEngine = (searchCore as any).fullTextEngine;
    const queryExpander = (searchCore as any).queryExpander;

    // Mock fewer grep results than candidate limit
    const grepResults = ["note1.md", "note2.md", "note3.md"];
    grepScanner.batchCachedReadGrep = jest.fn().mockResolvedValue(grepResults);

    // Mock query expansion
    queryExpander.expand = jest.fn().mockResolvedValue({
      queries: ["test"],
      salientTerms: [],
      originalQuery: "test",
      expandedQueries: [],
      expandedTerms: [],
    });

    // Track candidates
    let fullTextCandidates: string[] = [];
    fullTextEngine.buildFromCandidates = jest.fn(async (candidates: string[]) => {
      fullTextCandidates = [...candidates];
      return candidates.length;
    });
    fullTextEngine.search = jest.fn().mockReturnValue([]);
    fullTextEngine.clear = jest.fn();
    fullTextEngine.getStats = jest.fn().mockReturnValue({
      documentsIndexed: 3,
      memoryUsed: 100,
      memoryPercent: 0.01,
    });

    // Mock semantic search
    let semanticCandidates: string[] | undefined;
    const memoryIndex = await import("./MemoryIndexManager");
    const mockSearch = jest.fn(async (queries: string[], topK: number, candidates?: string[]) => {
      semanticCandidates = candidates;
      return [];
    });

    jest.spyOn(memoryIndex.MemoryIndexManager, "getInstance").mockReturnValue({
      search: mockSearch,
    } as any);

    // Perform search with high candidate limit
    await searchCore.retrieve("test", {
      enableSemantic: true,
      candidateLimit: 500,
      maxResults: 10,
    });

    // Should only use the available candidates
    expect(fullTextCandidates).toEqual(grepResults);
    expect(semanticCandidates).toEqual(grepResults);
  });
});
