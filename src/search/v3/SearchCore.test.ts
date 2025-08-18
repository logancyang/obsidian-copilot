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
      expect.objectContaining({ signal: expect.any(AbortSignal) })
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
});
