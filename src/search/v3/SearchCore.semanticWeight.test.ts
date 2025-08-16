import { App } from "obsidian";
import { SearchCore } from "./SearchCore";

// Mock dependencies
jest.mock("@/logger");

describe("SearchCore - Semantic Weight Configuration", () => {
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

  it("should properly use semantic weight from options", async () => {
    const grepScanner = (searchCore as any).grepScanner;
    const fullTextEngine = (searchCore as any).fullTextEngine;
    const queryExpander = (searchCore as any).queryExpander;

    // Mock grep results
    grepScanner.batchCachedReadGrep = jest.fn().mockResolvedValue(["note1.md", "note2.md"]);

    // Mock query expansion
    queryExpander.expand = jest.fn().mockResolvedValue({
      queries: ["test"],
      salientTerms: [],
    });

    // Mock full-text engine
    fullTextEngine.buildFromCandidates = jest.fn().mockResolvedValue(2);
    fullTextEngine.search = jest
      .fn()
      .mockReturnValue([{ id: "note1.md", score: 0.8, engine: "fulltext" }]);
    fullTextEngine.clear = jest.fn();
    fullTextEngine.getStats = jest.fn().mockReturnValue({
      documentsIndexed: 2,
      memoryUsed: 100,
      memoryPercent: 0.01,
    });

    // Mock semantic search
    const memoryIndex = await import("./MemoryIndexManager");
    const mockSearch = jest.fn().mockResolvedValue([{ id: "note2.md", score: 0.9 }]);
    jest.spyOn(memoryIndex.MemoryIndexManager, "getInstance").mockReturnValue({
      search: mockSearch,
    } as any);

    // Mock RRF module to capture weights
    const capturedWeights: any[] = [];
    const RRFModule = await import("./utils/RRF");
    jest.spyOn(RRFModule, "weightedRRF").mockImplementation((args: any) => {
      capturedWeights.push(args.weights);
      return [
        { id: "note1.md", score: 0.85, engine: "fused" },
        { id: "note2.md", score: 0.75, engine: "fused" },
      ];
    });

    // Test with 30% semantic weight (70% lexical)
    await searchCore.retrieve("test", {
      enableSemantic: true,
      semanticWeight: 0.3,
      maxResults: 10,
    });

    // Verify RRF received normalized weights
    expect(capturedWeights[0].lexical).toBeCloseTo(0.7, 5);
    expect(capturedWeights[0].semantic).toBeCloseTo(0.3, 5);

    // Test with 80% semantic weight (20% lexical)
    await searchCore.retrieve("test", {
      enableSemantic: true,
      semanticWeight: 0.8,
      maxResults: 10,
    });

    expect(capturedWeights[1].lexical).toBeCloseTo(0.2, 5);
    expect(capturedWeights[1].semantic).toBeCloseTo(0.8, 5);

    // Test with edge case: 0% semantic (100% lexical)
    await searchCore.retrieve("test", {
      enableSemantic: true,
      semanticWeight: 0,
      maxResults: 10,
    });

    expect(capturedWeights[2].lexical).toBeCloseTo(1.0, 5);
    expect(capturedWeights[2].semantic).toBeCloseTo(0, 5);

    // Test with edge case: 100% semantic (0% lexical)
    await searchCore.retrieve("test", {
      enableSemantic: true,
      semanticWeight: 1.0,
      maxResults: 10,
    });

    expect(capturedWeights[3].lexical).toBeCloseTo(0, 5);
    expect(capturedWeights[3].semantic).toBeCloseTo(1.0, 5);
  });

  it("should default to 60% semantic weight when not specified", async () => {
    const grepScanner = (searchCore as any).grepScanner;
    const fullTextEngine = (searchCore as any).fullTextEngine;
    const queryExpander = (searchCore as any).queryExpander;

    // Mock basic setup
    grepScanner.batchCachedReadGrep = jest.fn().mockResolvedValue(["note1.md"]);
    queryExpander.expand = jest.fn().mockResolvedValue({
      queries: ["test"],
      salientTerms: [],
    });
    fullTextEngine.buildFromCandidates = jest.fn().mockResolvedValue(1);
    fullTextEngine.search = jest.fn().mockReturnValue([]);
    fullTextEngine.clear = jest.fn();
    fullTextEngine.getStats = jest.fn().mockReturnValue({
      documentsIndexed: 1,
      memoryUsed: 50,
      memoryPercent: 0.005,
    });

    const memoryIndex = await import("./MemoryIndexManager");
    jest.spyOn(memoryIndex.MemoryIndexManager, "getInstance").mockReturnValue({
      search: jest.fn().mockResolvedValue([]),
    } as any);

    // Mock RRF module to capture weights
    let capturedWeights: any = null;
    const RRFModule = await import("./utils/RRF");
    jest.spyOn(RRFModule, "weightedRRF").mockImplementation((args: any) => {
      capturedWeights = args.weights;
      return [];
    });

    // Call without specifying semanticWeight
    await searchCore.retrieve("test", {
      enableSemantic: true,
      maxResults: 10,
    });

    // Should default to 60% semantic, 40% lexical
    expect(capturedWeights.lexical).toBeCloseTo(0.4, 5);
    expect(capturedWeights.semantic).toBeCloseTo(0.6, 5);
  });
});
