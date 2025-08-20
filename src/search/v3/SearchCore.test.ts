import { SearchCore } from "./SearchCore";
import { MemoryIndexManager } from "./MemoryIndexManager";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";

// Mock MemoryIndexManager
jest.mock("./MemoryIndexManager", () => ({
  MemoryIndexManager: {
    getInstance: jest.fn().mockReturnValue({
      search: jest.fn(),
      ensureLoaded: jest.fn(),
      isAvailable: jest.fn().mockReturnValue(true),
    }),
  },
}));

// Mock logger
jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logError: jest.fn(),
  logWarn: jest.fn(),
}));

// Minimal mock app for SearchCore
const createMockApp = () => ({
  vault: {
    getAbstractFileByPath: jest.fn((path: string) => ({ path, stat: { mtime: Date.now() } })),
    cachedRead: jest.fn(async () => "content"),
    getMarkdownFiles: jest.fn(() => []),
  },
  metadataCache: {
    resolvedLinks: {},
    getBacklinksForFile: jest.fn(() => ({ data: {} })),
    getFileCache: jest.fn(() => ({ headings: [], frontmatter: {} })),
  },
  workspace: {
    getActiveFile: jest.fn(() => null),
  },
});

describe("SearchCore - HyDE Integration", () => {
  let app: any;
  let mockChatModel: jest.Mocked<BaseChatModel>;
  let getChatModel: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    app = createMockApp();

    // Mock chat model
    mockChatModel = {
      invoke: jest.fn(),
    } as unknown as jest.Mocked<BaseChatModel>;

    getChatModel = jest.fn().mockResolvedValue(mockChatModel);
  });

  it("should generate HyDE document when semantic search is enabled", async () => {
    // Mock chat model response
    mockChatModel.invoke.mockResolvedValue({
      content: "OAuth authentication involves configuring identity providers and JWT tokens.",
      lc_kwargs: {},
    } as any);

    // Mock MemoryIndexManager
    const mockIndex = MemoryIndexManager.getInstance(app);
    (mockIndex.search as jest.Mock).mockResolvedValue([{ id: "auth/oauth.md", score: 0.95 }]);

    // Create SearchCore with chat model
    const core = new SearchCore(app, getChatModel);

    // Mock internal methods to avoid full pipeline
    const generateHyDESpy = jest.spyOn(core as any, "generateHyDE");

    // Execute retrieve with semantic enabled
    await core.retrieve("How do I implement authentication?", {
      maxResults: 10,
      enableSemantic: true,
    });

    // Verify HyDE was called
    expect(generateHyDESpy).toHaveBeenCalledWith("How do I implement authentication?");
    expect(mockChatModel.invoke).toHaveBeenCalledWith(
      expect.stringContaining("Write a brief, informative passage"),
      expect.objectContaining({ signal: expect.any(Object) })
    );
  });

  it("should handle HyDE timeout gracefully", async () => {
    // Mock timeout error after 4 seconds
    mockChatModel.invoke.mockRejectedValue(
      Object.assign(new Error("Aborted"), { name: "AbortError" })
    );

    const mockIndex = MemoryIndexManager.getInstance(app);
    (mockIndex.search as jest.Mock).mockResolvedValue([]);

    const core = new SearchCore(app, getChatModel);

    // Should not throw
    await expect(
      core.retrieve("test query", {
        maxResults: 10,
        enableSemantic: true,
      })
    ).resolves.toBeDefined();
  });

  it("should not generate HyDE when semantic is disabled", async () => {
    const core = new SearchCore(app, getChatModel);

    await core.retrieve("test query", {
      maxResults: 10,
      enableSemantic: false,
    });

    // getChatModel will be called for query expansion, but not for HyDE
    // Check that invoke was called only once (for query expansion, not HyDE)
    const invocations = mockChatModel.invoke.mock.calls;
    if (invocations.length > 0) {
      // Should only have query expansion call, not HyDE call
      expect(invocations[0][0]).not.toContain("Write a brief, informative passage");
    }
  });

  it("should skip boosts when enableLexicalBoosts is false", async () => {
    const core = new SearchCore(app, getChatModel);

    // Mock boost calculators to verify they're not called
    const mockFolderBoost = (core as any).folderBoostCalculator;
    const mockGraphBoost = (core as any).graphBoostCalculator;
    const applyBoostsSpy = jest.spyOn(mockFolderBoost, "applyBoosts");
    const applyBoostSpy = jest.spyOn(mockGraphBoost, "applyBoost");

    await core.retrieve("test query", {
      maxResults: 10,
      enableSemantic: false,
      enableLexicalBoosts: false,
    });

    // Verify boost calculators were NOT called
    expect(applyBoostsSpy).not.toHaveBeenCalled();
    expect(applyBoostSpy).not.toHaveBeenCalled();
  });

  it("should apply boosts when enableLexicalBoosts is true", async () => {
    const core = new SearchCore(app, getChatModel);

    // Mock boost calculators to verify they're called
    const mockFolderBoost = (core as any).folderBoostCalculator;
    const mockGraphBoost = (core as any).graphBoostCalculator;
    const applyBoostsSpy = jest.spyOn(mockFolderBoost, "applyBoosts").mockImplementation((r) => r);
    const applyBoostSpy = jest.spyOn(mockGraphBoost, "applyBoost").mockImplementation((r) => r);

    await core.retrieve("test query", {
      maxResults: 10,
      enableSemantic: false,
      enableLexicalBoosts: true,
    });

    // Verify boost calculators were called
    expect(applyBoostsSpy).toHaveBeenCalled();
    expect(applyBoostSpy).toHaveBeenCalled();
  });

  it("should skip lexical search when semantic weight is 100%", async () => {
    const core = new SearchCore(app, getChatModel);

    // Spy on the lexical search method
    const executeLexicalSpy = jest.spyOn(core as any, "executeLexicalSearch");
    const executeSemanticSpy = jest
      .spyOn(core as any, "executeSemanticSearch")
      .mockResolvedValue([]);

    await core.retrieve("test query", {
      maxResults: 10,
      enableSemantic: true,
      semanticWeight: 1.0, // 100% semantic
    });

    // Verify lexical search was skipped but semantic was called
    expect(executeLexicalSpy).not.toHaveBeenCalled();
    expect(executeSemanticSpy).toHaveBeenCalled();
  });

  it("should skip semantic search when semantic weight is 0%", async () => {
    const core = new SearchCore(app, getChatModel);

    // Spy on the search methods
    const executeLexicalSpy = jest.spyOn(core as any, "executeLexicalSearch").mockResolvedValue([]);
    const executeSemanticSpy = jest.spyOn(core as any, "executeSemanticSearch");

    await core.retrieve("test query", {
      maxResults: 10,
      enableSemantic: true,
      semanticWeight: 0.0, // 0% semantic
    });

    // Verify semantic search was skipped but lexical was called
    expect(executeLexicalSpy).toHaveBeenCalled();
    expect(executeSemanticSpy).not.toHaveBeenCalled();
  });

  it("should run both searches when semantic weight is between 0% and 100%", async () => {
    const core = new SearchCore(app, getChatModel);

    // Spy on the search methods
    const executeLexicalSpy = jest.spyOn(core as any, "executeLexicalSearch").mockResolvedValue([]);
    const executeSemanticSpy = jest
      .spyOn(core as any, "executeSemanticSearch")
      .mockResolvedValue([]);

    await core.retrieve("test query", {
      maxResults: 10,
      enableSemantic: true,
      semanticWeight: 0.6, // 60% semantic
    });

    // Verify both searches were called
    expect(executeLexicalSpy).toHaveBeenCalled();
    expect(executeSemanticSpy).toHaveBeenCalled();
  });

  it("should work without chat model", async () => {
    const core = new SearchCore(app, undefined);

    const mockIndex = MemoryIndexManager.getInstance(app);
    (mockIndex.search as jest.Mock).mockResolvedValue([{ id: "test.md", score: 0.8 }]);

    // Should not throw even without chat model
    const results = await core.retrieve("test query", {
      maxResults: 10,
      enableSemantic: true,
    });

    expect(results).toBeDefined();
  });

  it("should return both lexical and semantic chunk results with proper explanations", async () => {
    const core = new SearchCore(app, getChatModel);

    // Mock lexical results with chunk IDs and lexical explanations
    const mockLexicalResults = [
      {
        id: "Piano Lessons/Lesson 4.md#0",
        score: 1.5,
        engine: "fulltext" as const,
        explanation: {
          lexicalMatches: [{ field: "path", query: "piano", weight: 3 }],
          baseScore: 1.5,
          finalScore: 1.5,
        },
      },
    ];

    // Mock semantic results with chunk IDs and semantic explanations (now consistent with lexical)
    const mockSemanticResults = [
      {
        id: "Piano Lessons/Lesson 4.md#1", // Different chunk from same note
        score: 0.856,
        engine: "semantic" as const,
        explanation: {
          semanticScore: 0.856,
          baseScore: 0.856,
          finalScore: 0.856,
        },
      },
    ];

    // Mock the search methods
    jest.spyOn(core as any, "executeLexicalSearch").mockResolvedValue(mockLexicalResults);
    jest.spyOn(core as any, "executeSemanticSearch").mockResolvedValue(mockSemanticResults);

    const results = await core.retrieve("piano notes", {
      maxResults: 10,
      enableSemantic: true,
      semanticWeight: 0.5, // 50% semantic to trigger RRF fusion
    });

    expect(results).toBeDefined();
    expect(results.length).toBeGreaterThan(0);

    // Find the results for Lesson 4 - we should have both chunks with their respective explanations
    const lesson4Results = results.filter((r) => r.id.includes("Lesson 4"));
    expect(lesson4Results.length).toBeGreaterThan(0);

    // Find the lexical chunk result
    const lexicalChunk = lesson4Results.find((r) => r.id.includes("#0"));
    expect(lexicalChunk).toBeDefined();
    if (lexicalChunk) {
      expect(lexicalChunk.explanation?.lexicalMatches).toBeDefined();
      expect(lexicalChunk.explanation?.lexicalMatches?.length).toBeGreaterThan(0);
    }

    // Find the semantic chunk result
    const semanticChunk = lesson4Results.find((r) => r.id.includes("#1"));
    expect(semanticChunk).toBeDefined();
    if (semanticChunk) {
      expect(semanticChunk.explanation?.semanticScore).toBeDefined();
      expect(semanticChunk.explanation?.semanticScore).toBe(0.856);
    }
  });
});
