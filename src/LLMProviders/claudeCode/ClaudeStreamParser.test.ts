/**
 * ClaudeStreamParser Tests
 *
 * Comprehensive test suite covering all parsing scenarios, edge cases,
 * error handling, and performance considerations.
 */

import { ClaudeStreamParser, StreamChunk } from "./ClaudeStreamParser";
import { ChatGenerationChunk } from "@langchain/core/outputs";
import { AIMessageChunk } from "@langchain/core/messages";

describe("ClaudeStreamParser", () => {
  let parser: ClaudeStreamParser;

  beforeEach(() => {
    parser = new ClaudeStreamParser();
  });

  describe("parseChunk", () => {
    it("should parse valid single-line JSON content chunks", () => {
      const input = '{"type": "content", "content": "Hello world"}\n';
      const chunks = parser.parseChunk(input);

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toBeInstanceOf(ChatGenerationChunk);
      expect(chunks[0].text).toBe("Hello world");
      expect(chunks[0].message).toBeInstanceOf(AIMessageChunk);
      expect(chunks[0].generationInfo?.type).toBe("content");
    });

    it("should parse multiple JSON lines in single chunk", () => {
      const input =
        '{"type": "content", "content": "Hello"}\n{"type": "content", "content": " world"}\n';
      const chunks = parser.parseChunk(input);

      expect(chunks).toHaveLength(2);
      expect(chunks[0].text).toBe("Hello");
      expect(chunks[1].text).toBe(" world");
    });

    it("should handle done chunks correctly", () => {
      const input = '{"type": "done"}\n';
      const chunks = parser.parseChunk(input);

      expect(chunks).toHaveLength(1);
      expect(chunks[0].text).toBe("");
      expect(chunks[0].generationInfo?.type).toBe("done");
      expect(chunks[0].generationInfo?.finished).toBe(true);
    });

    it("should handle error chunks correctly", () => {
      const input = '{"type": "error", "error": "Something went wrong"}\n';
      const chunks = parser.parseChunk(input);

      expect(chunks).toHaveLength(1);
      expect(chunks[0].text).toBe("Error: Something went wrong");
      expect(chunks[0].generationInfo?.type).toBe("error");
      expect(chunks[0].generationInfo?.error).toBe(true);
    });

    it("should buffer incomplete JSON lines", () => {
      const input1 = '{"type": "content", "con';
      const input2 = 'tent": "Hello"}\n';

      const chunks1 = parser.parseChunk(input1);
      expect(chunks1).toHaveLength(0); // Incomplete line, should be buffered

      const chunks2 = parser.parseChunk(input2);
      expect(chunks2).toHaveLength(1);
      expect(chunks2[0].text).toBe("Hello");
    });

    it("should handle empty lines gracefully", () => {
      const input = '\n\n{"type": "content", "content": "Hello"}\n\n';
      const chunks = parser.parseChunk(input);

      expect(chunks).toHaveLength(1);
      expect(chunks[0].text).toBe("Hello");
    });

    it("should handle malformed JSON gracefully", () => {
      const input = '{"type": "content", malformed\n{"type": "content", "content": "Valid"}\n';
      const chunks = parser.parseChunk(input);

      expect(chunks).toHaveLength(2);
      expect(chunks[0].text).toContain("Error: Malformed JSON");
      expect(chunks[1].text).toBe("Valid");
    });

    it("should handle Buffer input correctly", () => {
      const buffer = Buffer.from('{"type": "content", "content": "Buffer test"}\n');
      const chunks = parser.parseChunk(buffer);

      expect(chunks).toHaveLength(1);
      expect(chunks[0].text).toBe("Buffer test");
    });

    it("should handle unknown chunk types gracefully", () => {
      const input = '{"type": "unknown", "data": "test"}\n';
      const chunks = parser.parseChunk(input);

      expect(chunks).toHaveLength(0); // Unknown types return null, filtered out
    });

    it("should handle content chunks without content field", () => {
      const input = '{"type": "content"}\n';
      const chunks = parser.parseChunk(input);

      expect(chunks).toHaveLength(0); // No content field should return null
    });
  });

  describe("handleError", () => {
    it("should create error chunk from Error object", () => {
      const error = new Error("Test error message");
      const chunk = parser.handleError(error);

      expect(chunk).toBeInstanceOf(ChatGenerationChunk);
      expect(chunk.text).toBe("Error: Test error message");
      expect(chunk.generationInfo?.type).toBe("error");
      expect(chunk.generationInfo?.error).toBe(true);
    });

    it("should handle errors with complex messages", () => {
      const error = new Error("Complex error: connection failed at line 123");
      const chunk = parser.handleError(error);

      expect(chunk.text).toBe("Error: Complex error: connection failed at line 123");
    });
  });

  describe("finalize", () => {
    it("should process remaining buffer content", () => {
      parser.parseChunk('{"type": "content", "content": "Partial"}'); // No newline
      const chunk = parser.finalize();

      expect(chunk).toBeInstanceOf(ChatGenerationChunk);
      expect(chunk!.text).toBe("Partial");
    });

    it("should return null for empty buffer", () => {
      const chunk = parser.finalize();
      expect(chunk).toBeNull();
    });

    it("should handle malformed JSON in buffer", () => {
      parser.parseChunk('{"type": "content", malformed'); // No newline, malformed
      const chunk = parser.finalize();

      expect(chunk).toBeInstanceOf(ChatGenerationChunk);
      expect(chunk!.text).toContain("Error: Final buffer contained malformed JSON");
    });

    it("should reset buffer after finalization", () => {
      parser.parseChunk('{"type": "content", "content": "Test"}'); // No newline
      parser.finalize();

      const chunk = parser.finalize(); // Should return null for empty buffer
      expect(chunk).toBeNull();
    });
  });

  describe("reset", () => {
    it("should clear internal buffer", () => {
      parser.parseChunk('{"type": "content"'); // Partial data
      parser.reset();

      const chunk = parser.finalize();
      expect(chunk).toBeNull(); // Buffer should be empty
    });
  });

  describe("memory management", () => {
    it("should handle large buffer sizes without memory issues", () => {
      // Create a large string that exceeds buffer limit
      const largeContent = "x".repeat(2 * 1024 * 1024); // 2MB
      const input = `{"type": "content", "content": "${largeContent}"}\n`;

      // Should not throw and should handle gracefully
      expect(() => {
        const chunks = parser.parseChunk(input);
        expect(chunks).toHaveLength(1);
      }).not.toThrow();
    });

    it("should reset buffer when it exceeds maximum size", () => {
      const largeString = "x".repeat(1024 * 1024 + 1000); // Just over 1MB

      // This should trigger buffer reset due to size
      const chunks = parser.parseChunk(largeString);

      // Should not cause memory issues and should continue processing
      expect(() => {
        parser.parseChunk('{"type": "content", "content": "After reset"}\n');
      }).not.toThrow();
    });
  });

  describe("real-world streaming scenarios", () => {
    it("should handle typical Claude CLI stream sequence", () => {
      const streamSequence = [
        '{"type": "content", "content": "I can help"}\n',
        '{"type": "content", "content": " with that."}\n{"type": "content", "content": " Let me"}\n',
        '{"type": "content", "content": " think about this."}\n',
        '{"type": "done"}\n',
      ];

      const allChunks: ChatGenerationChunk[] = [];

      for (const data of streamSequence) {
        const chunks = parser.parseChunk(data);
        allChunks.push(...chunks);
      }

      const finalChunk = parser.finalize();
      if (finalChunk) allChunks.push(finalChunk);

      expect(allChunks).toHaveLength(5);
      expect(allChunks[0].text).toBe("I can help");
      expect(allChunks[1].text).toBe(" with that.");
      expect(allChunks[2].text).toBe(" Let me");
      expect(allChunks[3].text).toBe(" think about this.");
      expect(allChunks[4].generationInfo?.type).toBe("done");
    });

    it("should handle mixed content and error chunks", () => {
      const input = `{"type": "content", "content": "Starting response"}
{"type": "error", "error": "Minor issue occurred"}
{"type": "content", "content": "Continuing despite error"}
{"type": "done"}
`;

      const chunks = parser.parseChunk(input);
      expect(chunks).toHaveLength(4);
      expect(chunks[0].text).toBe("Starting response");
      expect(chunks[1].text).toBe("Error: Minor issue occurred");
      expect(chunks[2].text).toBe("Continuing despite error");
      expect(chunks[3].generationInfo?.type).toBe("done");
    });
  });

  describe("performance characteristics", () => {
    it("should process large number of small chunks efficiently", () => {
      const start = performance.now();

      for (let i = 0; i < 1000; i++) {
        const chunks = parser.parseChunk(`{"type": "content", "content": "Chunk ${i}"}\n`);
        expect(chunks).toHaveLength(1);
      }

      const end = performance.now();
      expect(end - start).toBeLessThan(1000); // Should complete in under 1 second
    });

    it("should not leak memory during extended parsing sessions", () => {
      const initialMemory = process.memoryUsage().heapUsed;

      // Process many chunks and force garbage collection
      for (let i = 0; i < 10000; i++) {
        parser.parseChunk(`{"type": "content", "content": "Test ${i}"}\n`);
        if (i % 1000 === 0) parser.reset(); // Reset periodically
      }

      // Force garbage collection if available
      if (global.gc) global.gc();

      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = finalMemory - initialMemory;

      // Memory increase should be reasonable (less than 10MB for this test)
      expect(memoryIncrease).toBeLessThan(10 * 1024 * 1024);
    });
  });
});
