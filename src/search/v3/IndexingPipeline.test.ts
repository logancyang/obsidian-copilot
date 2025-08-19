// Mock modules before importing
jest.mock("obsidian", () => {
  class MockTFile {
    path: string;
    basename: string;
    stat: { mtime: number; ctime: number };

    constructor(path: string) {
      this.path = path;
      this.basename = path.replace(".md", "");
      this.stat = { mtime: Date.now(), ctime: Date.now() };
    }
  }

  return {
    TFile: MockTFile,
  };
});

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

jest.mock("@/settings/model", () => ({
  getSettings: jest.fn(() => ({
    embeddingRequestsPerMin: 60,
    embeddingBatchSize: 16,
  })),
}));

jest.mock("@/LLMProviders/embeddingManager", () => ({
  getInstance: jest.fn(() => ({
    getEmbeddingsAPI: jest.fn(() => ({
      embedDocuments: jest.fn(
        (texts: string[]) => Promise.resolve(texts.map(() => Array(1536).fill(0.1))) // Mock 1536-dim embeddings
      ),
    })),
  })),
}));

jest.mock("@/LLMProviders/chatModelManager", () => ({
  getInstance: jest.fn(() => ({
    countTokens: jest.fn(() => Promise.resolve(100)),
  })),
}));

jest.mock("@/rateLimiter", () => ({
  RateLimiter: jest.fn().mockImplementation(() => ({
    wait: jest.fn(() => Promise.resolve()),
    setRequestsPerMin: jest.fn(),
  })),
}));

import { IndexingPipeline } from "./IndexingPipeline";
import { IndexingNotificationManager } from "./IndexingNotificationManager";

describe("IndexingPipeline", () => {
  let pipeline: IndexingPipeline;
  let mockApp: any;
  let mockNotificationManager: IndexingNotificationManager;

  beforeEach(() => {
    // Mock app with vault and metadata cache
    mockApp = {
      vault: {
        cachedRead: jest.fn((file) => {
          const contentMap: Record<string, string> = {
            "short.md": "This is a short note.",
            "long.md":
              "# Chapter 1\n\n" +
              "Content ".repeat(1000) +
              "\n\n## Section\n\n" +
              "More content ".repeat(500),
            "empty.md": "",
            "multi-chunk.md": Array(5)
              .fill(0)
              .map((_, i) => `# Section ${i}\n\n${"Paragraph ".repeat(200)}`)
              .join("\n\n"),
          };
          return Promise.resolve(contentMap[file.path] || "Default content");
        }),
      },
      metadataCache: {
        getFileCache: jest.fn(() => ({
          headings: [],
          frontmatter: null,
        })),
      },
    };

    // Mock notification manager
    mockNotificationManager = {
      shouldCancel: false,
      waitIfPaused: jest.fn(() => Promise.resolve()),
      update: jest.fn(),
    } as any;

    pipeline = new IndexingPipeline(mockApp, mockNotificationManager);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("chunk ID format consistency", () => {
    it("should generate non-padded chunk IDs consistently with ChunkManager", async () => {
      const mockFile = {
        path: "test.md",
        basename: "test",
        stat: { mtime: 1000, ctime: 1000 },
      } as any;

      // Mock long content that will create multiple chunks
      mockApp.vault.cachedRead.mockResolvedValueOnce(
        Array(10).fill("Long paragraph content. ".repeat(100)).join("\n\n")
      );

      const chunks = await (pipeline as any).processFileIntoChunks(mockFile);

      expect(chunks.length).toBeGreaterThan(1);

      // Verify all chunk indices use non-padded format
      chunks.forEach((chunk: any, index: number) => {
        expect(chunk.chunkIndex).toBe(index); // 0-based indexing
        expect(typeof chunk.chunkIndex).toBe("number");
      });

      // Test actual ID generation by processing into records
      const mockProgressTracker = {
        initializeFile: jest.fn(),
        recordChunkProcessed: jest.fn(),
        completedCount: 0,
        total: chunks.length,
      } as any;

      const fileChunkMap = new Map();
      fileChunkMap.set(mockFile.path, chunks);

      const records = await pipeline.processChunksBatched(
        chunks,
        fileChunkMap,
        mockProgressTracker
      );

      // Verify records have non-padded IDs
      expect(records.length).toBeGreaterThan(1);
      records.forEach((record, index) => {
        const expectedId = `test.md#${index}`;
        expect(record.id).toBe(expectedId);

        // Ensure no old padded format
        expect(record.id).not.toBe(`test.md#${index.toString().padStart(3, "0")}`);
      });
    });

    it("should generate correct IDs for various chunk indices", async () => {
      const testCases = [
        { index: 0, expected: "note.md#0" },
        { index: 1, expected: "note.md#1" },
        { index: 9, expected: "note.md#9" },
        { index: 10, expected: "note.md#10" },
        { index: 99, expected: "note.md#99" },
        { index: 100, expected: "note.md#100" },
        { index: 999, expected: "note.md#999" },
        { index: 1000, expected: "note.md#1000" },
      ];

      for (const testCase of testCases) {
        const mockChunk = {
          text: "test content",
          path: "note.md",
          title: "note",
          mtime: 1000,
          ctime: 1000,
          chunkIndex: testCase.index,
        };

        const records = await pipeline.processSingleFileChunks([mockChunk]);
        expect(records).toHaveLength(1);
        expect(records[0].id).toBe(testCase.expected);
      }
    });

    it("should maintain consistency between processChunksBatched and processSingleFileChunks", async () => {
      const mockChunks = Array(5)
        .fill(0)
        .map((_, i) => ({
          text: `Chunk ${i} content`,
          path: "consistency.md",
          title: "consistency",
          mtime: 1000,
          ctime: 1000,
          chunkIndex: i,
        }));

      // Test batched processing
      const mockProgressTracker = {
        initializeFile: jest.fn(),
        recordChunkProcessed: jest.fn(),
        completedCount: 0,
        total: mockChunks.length,
      } as any;

      const fileChunkMap = new Map();
      fileChunkMap.set("consistency.md", mockChunks);

      const batchedRecords = await pipeline.processChunksBatched(
        mockChunks,
        fileChunkMap,
        mockProgressTracker
      );

      // Test single file processing
      const singleRecords = await pipeline.processSingleFileChunks(mockChunks);

      // Both should produce identical IDs
      expect(batchedRecords).toHaveLength(5);
      expect(singleRecords).toHaveLength(5);

      batchedRecords.forEach((record, index) => {
        const expectedId = `consistency.md#${index}`;
        expect(record.id).toBe(expectedId);
        expect(singleRecords[index].id).toBe(expectedId);
      });
    });
  });

  describe("chunk processing", () => {
    it("should handle empty files gracefully", async () => {
      const mockFile = {
        path: "empty.md",
        basename: "empty",
        stat: { mtime: 1000, ctime: 1000 },
      } as any;

      mockApp.vault.cachedRead.mockResolvedValueOnce("");

      const chunks = await (pipeline as any).processFileIntoChunks(mockFile);
      expect(chunks).toEqual([]);
    });

    it("should handle single chunk files", async () => {
      const mockFile = {
        path: "short.md",
        basename: "short",
        stat: { mtime: 1000, ctime: 1000 },
      } as any;

      const chunks = await (pipeline as any).processFileIntoChunks(mockFile);
      expect(chunks).toHaveLength(1);
      expect(chunks[0].chunkIndex).toBe(0);
      expect(chunks[0].path).toBe("short.md");
      expect(chunks[0].title).toBe("short");
    });

    it("should split large files into multiple chunks", async () => {
      const mockFile = {
        path: "long.md",
        basename: "long",
        stat: { mtime: 1000, ctime: 1000 },
      } as any;

      const chunks = await (pipeline as any).processFileIntoChunks(mockFile);
      expect(chunks.length).toBeGreaterThan(1);

      // Verify sequential chunk indices
      chunks.forEach((chunk: any, index: number) => {
        expect(chunk.chunkIndex).toBe(index);
        expect(chunk.path).toBe("long.md");
        expect(chunk.title).toBe("long");
        expect(chunk.text).toBeTruthy();
      });
    });
  });

  describe("record generation", () => {
    it("should generate valid JSONL records with embeddings", async () => {
      const mockChunks = [
        {
          text: "First chunk content",
          path: "record-test.md",
          title: "record-test",
          mtime: 1000,
          ctime: 1000,
          chunkIndex: 0,
        },
        {
          text: "Second chunk content",
          path: "record-test.md",
          title: "record-test",
          mtime: 1000,
          ctime: 1000,
          chunkIndex: 1,
        },
      ];

      const records = await pipeline.processSingleFileChunks(mockChunks);

      expect(records).toHaveLength(2);

      records.forEach((record, index) => {
        expect(record.id).toBe(`record-test.md#${index}`);
        expect(record.path).toBe("record-test.md");
        expect(record.title).toBe("record-test");
        expect(record.mtime).toBe(1000);
        expect(record.ctime).toBe(1000);
        expect(record.embedding).toBeDefined();
        expect(Array.isArray(record.embedding)).toBe(true);
        expect(record.embedding).toHaveLength(1536); // Mock embedding dimension
      });
    });

    it("should handle batched processing correctly", async () => {
      const mockFile = {
        path: "batch-test.md",
        basename: "batch-test",
        stat: { mtime: 2000, ctime: 2000 },
      } as any;

      // Create content that will generate multiple chunks
      mockApp.vault.cachedRead.mockResolvedValueOnce(
        Array(3).fill("Content section. ".repeat(200)).join("\n\n")
      );

      const { chunks, fileChunkMap } = await pipeline.prepareFileChunks([mockFile]);

      const mockProgressTracker = {
        initializeFile: jest.fn(),
        recordChunkProcessed: jest.fn(),
        completedCount: 0,
        total: chunks.length,
      } as any;

      const records = await pipeline.processChunksBatched(
        chunks,
        fileChunkMap,
        mockProgressTracker
      );

      expect(records.length).toBeGreaterThan(0);
      expect(mockProgressTracker.initializeFile).toHaveBeenCalledWith(
        "batch-test.md",
        chunks.length
      );
      expect(mockProgressTracker.recordChunkProcessed).toHaveBeenCalledTimes(chunks.length);

      // Verify all records have correct format
      records.forEach((record, index) => {
        expect(record.id).toBe(`batch-test.md#${index}`);
        expect(record.embedding).toBeDefined();
      });
    });
  });

  describe("error handling", () => {
    it("should handle file read errors", async () => {
      const mockFile = {
        path: "error.md",
        basename: "error",
        stat: { mtime: 1000, ctime: 1000 },
      } as any;

      mockApp.vault.cachedRead.mockRejectedValueOnce(new Error("File read failed"));

      // Should propagate the error
      await expect((pipeline as any).processFileIntoChunks(mockFile)).rejects.toThrow(
        "File read failed"
      );
    });

    it("should handle empty chunk arrays gracefully", async () => {
      const result = await pipeline.processSingleFileChunks([]);
      expect(result).toEqual([]);
    });
  });

  describe("integration with rate limiting", () => {
    it("should respect rate limiting during processing", async () => {
      const mockChunks = Array(20)
        .fill(0)
        .map((_, i) => ({
          text: `Chunk ${i} content`,
          path: "rate-limit-test.md",
          title: "rate-limit-test",
          mtime: 1000,
          ctime: 1000,
          chunkIndex: i,
        }));

      const mockRateLimiter = {
        wait: jest.fn(() => Promise.resolve()),
        setRequestsPerMin: jest.fn(),
      };

      // Replace the rate limiter instance
      (pipeline as any).rateLimiter = mockRateLimiter;

      await pipeline.processSingleFileChunks(mockChunks);

      // With batch size 16, should make 2 API calls (20 chunks / 16 per batch = 2 batches)
      expect(mockRateLimiter.wait).toHaveBeenCalledTimes(2);
    });
  });
});
