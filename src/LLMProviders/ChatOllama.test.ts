/**
 * Unit tests for ChatOllama
 *
 * Tests the custom streaming implementation that preserves message.thinking
 * from Ollama's raw API responses.
 */

import { ChatOllama } from "./ChatOllama";
import { HumanMessage } from "@langchain/core/messages";

// Mock fetch globally
global.fetch = jest.fn();

describe("ChatOllama", () => {
  let mockFetch: jest.MockedFunction<typeof fetch>;

  beforeEach(() => {
    mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;
    mockFetch.mockClear();
  });

  describe("_streamResponseChunks", () => {
    it("should preserve thinking field from Ollama streaming response", async () => {
      // Mock streaming response with thinking content
      const mockResponse = {
        ok: true,
        body: {
          getReader: () => ({
            read: jest
              .fn()
              .mockResolvedValueOnce({
                done: false,
                value: new TextEncoder().encode(
                  JSON.stringify({
                    model: "qwen3:14b",
                    message: {
                      role: "assistant",
                      content: "",
                      thinking: "Let me think about this...",
                    },
                    done: false,
                  }) + "\n"
                ),
              })
              .mockResolvedValueOnce({
                done: false,
                value: new TextEncoder().encode(
                  JSON.stringify({
                    model: "qwen3:14b",
                    message: {
                      role: "assistant",
                      content: "The answer is 42.",
                      thinking: "",
                    },
                    done: false,
                  }) + "\n"
                ),
              })
              .mockResolvedValueOnce({
                done: true,
                value: undefined,
              }),
          }),
        },
      };

      mockFetch.mockResolvedValue(mockResponse as any);

      const chatOllama = new ChatOllama({
        model: "qwen3:14b",
        baseUrl: "http://localhost:11434",
      });

      const messages = [new HumanMessage("Test question")];
      const chunks = [];

      for await (const chunk of chatOllama._streamResponseChunks(messages, {
        signal: new AbortController().signal,
      } as any)) {
        chunks.push(chunk);
      }

      // Should have 2 chunks (excluding done chunk without message)
      expect(chunks.length).toBe(2);

      // First chunk should have thinking data
      const firstChunk = chunks[0];
      expect(firstChunk.message).toBeDefined();
      expect((firstChunk.message as any).message).toBeDefined();
      expect((firstChunk.message as any).message.thinking).toBe("Let me think about this...");
      expect(firstChunk.message.content).toBe("");

      // Second chunk should have content
      const secondChunk = chunks[1];
      expect(secondChunk.message.content).toBe("The answer is 42.");
    });

    it("should handle chunks without thinking field", async () => {
      const mockResponse = {
        ok: true,
        body: {
          getReader: () => ({
            read: jest
              .fn()
              .mockResolvedValueOnce({
                done: false,
                value: new TextEncoder().encode(
                  JSON.stringify({
                    model: "llama3",
                    message: {
                      role: "assistant",
                      content: "Regular response without thinking",
                    },
                    done: false,
                  }) + "\n"
                ),
              })
              .mockResolvedValueOnce({
                done: true,
                value: undefined,
              }),
          }),
        },
      };

      mockFetch.mockResolvedValue(mockResponse as any);

      const chatOllama = new ChatOllama({
        model: "llama3",
        baseUrl: "http://localhost:11434",
      });

      const messages = [new HumanMessage("Test question")];
      const chunks = [];

      for await (const chunk of chatOllama._streamResponseChunks(messages, {
        signal: new AbortController().signal,
      } as any)) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBe(1);
      expect(chunks[0].message.content).toBe("Regular response without thinking");
      expect((chunks[0].message as any).message).toBeUndefined();
    });

    it("should handle malformed JSON gracefully", async () => {
      const mockResponse = {
        ok: true,
        body: {
          getReader: () => ({
            read: jest
              .fn()
              .mockResolvedValueOnce({
                done: false,
                value: new TextEncoder().encode("invalid json\n"),
              })
              .mockResolvedValueOnce({
                done: false,
                value: new TextEncoder().encode(
                  JSON.stringify({
                    model: "qwen3:14b",
                    message: {
                      role: "assistant",
                      content: "Valid chunk",
                    },
                    done: false,
                  }) + "\n"
                ),
              })
              .mockResolvedValueOnce({
                done: true,
                value: undefined,
              }),
          }),
        },
      };

      mockFetch.mockResolvedValue(mockResponse as any);

      const chatOllama = new ChatOllama({
        model: "qwen3:14b",
        baseUrl: "http://localhost:11434",
      });

      const messages = [new HumanMessage("Test question")];
      const chunks = [];

      // Should not throw, should skip malformed chunk
      for await (const chunk of chatOllama._streamResponseChunks(messages, {
        signal: new AbortController().signal,
      } as any)) {
        chunks.push(chunk);
      }

      // Should only have the valid chunk
      expect(chunks.length).toBe(1);
      expect(chunks[0].message.content).toBe("Valid chunk");
    });

    it("should handle HTTP errors", async () => {
      const mockResponse = {
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        text: async () => "Server error details",
      };

      mockFetch.mockResolvedValue(mockResponse as any);

      const chatOllama = new ChatOllama({
        model: "qwen3:14b",
        baseUrl: "http://localhost:11434",
      });

      const messages = [new HumanMessage("Test question")];

      await expect(async () => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _chunk of chatOllama._streamResponseChunks(messages, {
          signal: new AbortController().signal,
        } as any)) {
          // Should not reach here
        }
      }).rejects.toThrow(/Ollama API error/);
    });

    it("should respect abort signal", async () => {
      const abortController = new AbortController();

      const mockResponse = {
        ok: true,
        body: {
          getReader: () => ({
            read: jest.fn().mockImplementation(() => {
              // Abort after first read
              abortController.abort();
              return Promise.resolve({
                done: false,
                value: new TextEncoder().encode(
                  JSON.stringify({
                    model: "qwen3:14b",
                    message: {
                      role: "assistant",
                      content: "First chunk",
                    },
                    done: false,
                  }) + "\n"
                ),
              });
            }),
          }),
        },
      };

      mockFetch.mockResolvedValue(mockResponse as any);

      const chatOllama = new ChatOllama({
        model: "qwen3:14b",
        baseUrl: "http://localhost:11434",
      });

      const messages = [new HumanMessage("Test question")];
      const chunks = [];

      for await (const chunk of chatOllama._streamResponseChunks(messages, {
        signal: abortController.signal,
      } as any)) {
        chunks.push(chunk);
        // Break after first chunk due to abort
        break;
      }

      // Should have processed at least one chunk before abort
      expect(chunks.length).toBeGreaterThanOrEqual(1);
    });

    it("should strip /v1 suffix from baseUrl", async () => {
      const mockResponse = {
        ok: true,
        body: {
          getReader: () => ({
            read: jest
              .fn()
              .mockResolvedValueOnce({
                done: false,
                value: new TextEncoder().encode(
                  JSON.stringify({
                    model: "qwen3:14b",
                    message: { role: "assistant", content: "test" },
                    done: false,
                  }) + "\n"
                ),
              })
              .mockResolvedValueOnce({ done: true, value: undefined }),
          }),
        },
      };

      mockFetch.mockResolvedValue(mockResponse as any);

      const chatOllama = new ChatOllama({
        model: "qwen3:14b",
        baseUrl: "http://localhost:11434/v1/", // With /v1 suffix
      });

      const messages = [new HumanMessage("Test")];
      const chunks = [];

      for await (const chunk of chatOllama._streamResponseChunks(messages, {
        signal: new AbortController().signal,
      } as any)) {
        chunks.push(chunk);
      }

      // Verify fetch was called with /api/chat (not /v1/api/chat)
      expect(mockFetch).toHaveBeenCalledWith("http://localhost:11434/api/chat", expect.any(Object));
    });
  });
});
