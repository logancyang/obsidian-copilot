/**
 * Tests for MiyoClient
 */

import { MiyoClient, MiyoApiError } from "./MiyoClient";
import {
  HealthResponse,
  SearchResponse,
  IngestResponse,
  FilesResponse,
  DeleteResponse,
} from "./types";

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe("MiyoClient", () => {
  let client: MiyoClient;

  beforeEach(() => {
    jest.clearAllMocks();
    client = new MiyoClient({
      baseUrl: "http://localhost:8000",
      apiKey: "test-api-key",
      sourceId: "test-vault",
    });
  });

  describe("constructor", () => {
    it("should remove trailing slash from base URL", () => {
      const clientWithSlash = new MiyoClient({
        baseUrl: "http://localhost:8000/",
      });
      expect(clientWithSlash.getBaseUrl()).toBe("http://localhost:8000");
    });

    it("should store source ID", () => {
      expect(client.getSourceId()).toBe("test-vault");
    });
  });

  describe("health", () => {
    it("should return health status on success", async () => {
      const mockResponse: HealthResponse = {
        status: "ok",
        service: "miyo",
        qdrant: "connected",
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await client.health();

      expect(result).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:8000/v0/health",
        expect.objectContaining({
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer test-api-key",
          },
        })
      );
    });

    it("should throw MiyoApiError on failure", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        json: async () => ({ error: "Server error" }),
      });

      await expect(client.health()).rejects.toThrow(MiyoApiError);
    });
  });

  describe("isAvailable", () => {
    it("should return true when service is healthy", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: "ok",
          service: "miyo",
          qdrant: "connected",
        }),
      });

      const result = await client.isAvailable();
      expect(result).toBe(true);
    });

    it("should return false when qdrant is not connected", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: "ok",
          service: "miyo",
          qdrant: "disconnected",
        }),
      });

      const result = await client.isAvailable();
      expect(result).toBe(false);
    });

    it("should return false on network error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const result = await client.isAvailable();
      expect(result).toBe(false);
    });
  });

  describe("search", () => {
    it("should search with query", async () => {
      const mockResponse: SearchResponse = {
        results: [
          {
            file_path: "notes/test.md",
            snippet: "Test content",
            score: 0.95,
            title: "Test Note",
          },
        ],
        query: "test query",
        count: 1,
        execution_time_ms: 50,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await client.search({ query: "test query", limit: 10 });

      expect(result).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:8000/v0/search",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ query: "test query", limit: 10 }),
        })
      );
    });

    it("should search with filters", async () => {
      const mockResponse: SearchResponse = {
        results: [],
        query: "test",
        count: 0,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      await client.search({
        query: "test",
        filters: [{ field: "mtime", gte: 1000, lte: 2000 }],
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:8000/v0/search",
        expect.objectContaining({
          body: JSON.stringify({
            query: "test",
            filters: [{ field: "mtime", gte: 1000, lte: 2000 }],
          }),
        })
      );
    });
  });

  describe("ingest", () => {
    it("should ingest a file", async () => {
      const mockResponse: IngestResponse = {
        status: "completed",
        action: "indexed",
        file_path: "notes/test.md",
        chunks_created: 3,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await client.ingest({ file: "notes/test.md" });

      expect(result).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:8000/v0/ingest",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ file: "notes/test.md", source_id: "test-vault" }),
        })
      );
    });

    it("should ingest with force option", async () => {
      const mockResponse: IngestResponse = {
        status: "completed",
        action: "updated",
        file_path: "notes/test.md",
        chunks_created: 3,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      await client.ingest({ file: "notes/test.md", force: true });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:8000/v0/ingest",
        expect.objectContaining({
          body: JSON.stringify({
            file: "notes/test.md",
            force: true,
            source_id: "test-vault",
          }),
        })
      );
    });
  });

  describe("ingestBatch", () => {
    it("should ingest multiple files", async () => {
      const mockResponse: IngestResponse = {
        status: "completed",
        action: "indexed",
        file_path: "notes/test.md",
        chunks_created: 1,
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      const progressCallback = jest.fn();
      const results = await client.ingestBatch(["file1.md", "file2.md", "file3.md"], {
        onProgress: progressCallback,
      });

      expect(results).toHaveLength(3);
      expect(progressCallback).toHaveBeenCalledTimes(3);
      expect(progressCallback).toHaveBeenLastCalledWith(3, 3);
    });

    it("should handle errors in batch", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            status: "completed",
            action: "indexed",
            file_path: "file1.md",
          }),
        })
        .mockRejectedValueOnce(new Error("Network error"))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            status: "completed",
            action: "indexed",
            file_path: "file3.md",
          }),
        });

      const results = await client.ingestBatch(["file1.md", "file2.md", "file3.md"]);

      expect(results).toHaveLength(3);
      expect(results[1].status).toBe("error");
      expect(results[1].action).toBe("failed");
    });
  });

  describe("listFiles", () => {
    it("should list files with pagination", async () => {
      const mockResponse: FilesResponse = {
        files: [{ file_path: "notes/test.md", status: "indexed" }],
        total: 1,
        offset: 0,
        limit: 50,
        has_more: false,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await client.listFiles({ offset: 0, limit: 50 });

      expect(result).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("source_id=test-vault"),
        expect.any(Object)
      );
    });

    it("should apply search filter", async () => {
      const mockResponse: FilesResponse = {
        files: [],
        total: 0,
        offset: 0,
        limit: 50,
        has_more: false,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      await client.listFiles({ search: "notes/" });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("search=notes%2F"),
        expect.any(Object)
      );
    });
  });

  describe("getAllIndexedFiles", () => {
    it("should handle pagination", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            files: [{ file_path: "file1.md" }, { file_path: "file2.md" }],
            total: 4,
            offset: 0,
            limit: 2,
            has_more: true,
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            files: [{ file_path: "file3.md" }, { file_path: "file4.md" }],
            total: 4,
            offset: 2,
            limit: 2,
            has_more: false,
          }),
        });

      // Create client with custom limit for testing
      const testClient = new MiyoClient({ baseUrl: "http://localhost:8000" });
      const files = await testClient.getAllIndexedFiles();

      expect(files).toEqual(["file1.md", "file2.md", "file3.md", "file4.md"]);
    });
  });

  describe("delete", () => {
    it("should delete by file path", async () => {
      const mockResponse: DeleteResponse = {
        status: "ok",
        deleted_chunks: 5,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await client.deleteFile("notes/test.md");

      expect(result).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:8000/v0/delete",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ file_path: "notes/test.md" }),
        })
      );
    });

    it("should delete multiple files", async () => {
      const mockResponse: DeleteResponse = {
        status: "ok",
        deleted_chunks: 10,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await client.deleteFiles(["file1.md", "file2.md"]);

      expect(result).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:8000/v0/delete",
        expect.objectContaining({
          body: JSON.stringify({ file_paths: ["file1.md", "file2.md"] }),
        })
      );
    });
  });

  describe("error handling", () => {
    it("should handle timeout", async () => {
      // Create a client with very short timeout
      const shortTimeoutClient = new MiyoClient({
        baseUrl: "http://localhost:8000",
        timeout: 1, // 1ms timeout
      });

      // Mock AbortController
      const originalAbortController = global.AbortController;
      const mockAbort = jest.fn();
      global.AbortController = jest.fn().mockImplementation(() => ({
        signal: {},
        abort: mockAbort,
      })) as any;

      // Mock fetch to never resolve
      mockFetch.mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            const error = new Error("Aborted");
            (error as any).name = "AbortError";
            setTimeout(() => reject(error), 0);
          })
      );

      await expect(shortTimeoutClient.health()).rejects.toThrow("Request timeout");

      global.AbortController = originalAbortController;
    });

    it("should handle network errors", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      await expect(client.health()).rejects.toThrow("Network error");
    });

    it("should include status code in API errors", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 422,
        statusText: "Unprocessable Entity",
        json: async () => ({
          detail: [{ loc: ["body", "query"], msg: "field required" }],
        }),
      });

      try {
        await client.search({ query: "" });
        fail("Expected error to be thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(MiyoApiError);
        expect((error as MiyoApiError).statusCode).toBe(422);
      }
    });
  });
});
