import {
  buildToolCallsFromChunks,
  accumulateToolCallChunk,
  ToolCallChunk,
} from "./utils/nativeToolCalling";

/**
 * Test suite for Gemini tool call name extraction fix (Issue #2233)
 *
 * Root cause: Gemini's @langchain/google-genai nests tool call names inside
 * `functionCall.name` instead of at the top level `name` property. Without
 * the fallback, all Gemini tool call names are empty, causing
 * buildToolCallsFromChunks to skip them → treated as "no tool calls" →
 * empty response since thinking tokens were filtered.
 */
describe("accumulateToolCallChunk", () => {
  describe("OpenAI-format chunks (top-level name)", () => {
    it("should accumulate name from top-level tc.name", () => {
      const chunks = new Map<number, ToolCallChunk>();

      accumulateToolCallChunk(chunks, {
        index: 0,
        id: "call_123",
        name: "localSearch",
        args: '{"query":',
      });
      accumulateToolCallChunk(chunks, {
        index: 0,
        args: '"test"}',
      });

      const result = chunks.get(0)!;
      expect(result.name).toBe("localSearch");
      expect(result.id).toBe("call_123");
      expect(result.args).toBe('{"query":"test"}');
    });

    it("should handle multiple concurrent tool calls", () => {
      const chunks = new Map<number, ToolCallChunk>();

      accumulateToolCallChunk(chunks, { index: 0, name: "localSearch", args: '{"q":"a"}' });
      accumulateToolCallChunk(chunks, { index: 1, name: "readNote", args: '{"path":"b"}' });

      expect(chunks.get(0)!.name).toBe("localSearch");
      expect(chunks.get(1)!.name).toBe("readNote");
    });
  });

  describe("Gemini-format chunks (name in functionCall)", () => {
    it("should extract name from functionCall.name when top-level name is missing", () => {
      const chunks = new Map<number, ToolCallChunk>();

      // Gemini sends chunks with functionCall.name instead of top-level name
      accumulateToolCallChunk(chunks, {
        index: 0,
        id: "call_456",
        functionCall: { name: "localSearch" },
        args: '{"query":"test"}',
      });

      const result = chunks.get(0)!;
      expect(result.name).toBe("localSearch");
      expect(result.id).toBe("call_456");
      expect(result.args).toBe('{"query":"test"}');
    });

    it("should handle multiple Gemini tool calls", () => {
      const chunks = new Map<number, ToolCallChunk>();

      accumulateToolCallChunk(chunks, {
        index: 0,
        functionCall: { name: "localSearch" },
        args: '{"query":"piano"}',
      });
      accumulateToolCallChunk(chunks, {
        index: 1,
        functionCall: { name: "readNote" },
        args: '{"path":"notes/music.md"}',
      });

      expect(chunks.get(0)!.name).toBe("localSearch");
      expect(chunks.get(1)!.name).toBe("readNote");
    });

    it("should prefer top-level name over functionCall.name", () => {
      const chunks = new Map<number, ToolCallChunk>();

      accumulateToolCallChunk(chunks, {
        index: 0,
        name: "topLevel",
        functionCall: { name: "nested" },
        args: "{}",
      });

      // Top-level name takes priority via nullish coalescing (??)
      expect(chunks.get(0)!.name).toBe("topLevel");
    });
  });

  describe("Edge cases", () => {
    it("should default index to 0 when not provided", () => {
      const chunks = new Map<number, ToolCallChunk>();

      accumulateToolCallChunk(chunks, { name: "localSearch", args: "{}" });

      expect(chunks.has(0)).toBe(true);
      expect(chunks.get(0)!.name).toBe("localSearch");
    });

    it("should handle chunk with no name at all", () => {
      const chunks = new Map<number, ToolCallChunk>();

      accumulateToolCallChunk(chunks, { index: 0, args: '{"query":"test"}' });

      expect(chunks.get(0)!.name).toBe("");
      expect(chunks.get(0)!.args).toBe('{"query":"test"}');
    });

    it("should accumulate args across multiple chunks", () => {
      const chunks = new Map<number, ToolCallChunk>();

      accumulateToolCallChunk(chunks, { index: 0, name: "localSearch", args: '{"qu' });
      accumulateToolCallChunk(chunks, { index: 0, args: 'ery":' });
      accumulateToolCallChunk(chunks, { index: 0, args: '"test"}' });

      expect(chunks.get(0)!.args).toBe('{"query":"test"}');
    });
  });
});

describe("buildToolCallsFromChunks", () => {
  it("should build tool calls from properly accumulated chunks", () => {
    const chunks = new Map<number, ToolCallChunk>();
    chunks.set(0, { id: "call_1", name: "localSearch", args: '{"query":"test"}' });

    const result = buildToolCallsFromChunks(chunks);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("localSearch");
    expect(result[0].args).toEqual({ query: "test" });
    expect(result[0].id).toBe("call_1");
  });

  it("should skip chunks with no name (the bug this fix addresses)", () => {
    const chunks = new Map<number, ToolCallChunk>();
    // This is what happened before the fix: Gemini chunks had no name
    // because the accumulator didn't check functionCall.name
    chunks.set(0, { name: "", args: '{"query":"test"}' });

    const result = buildToolCallsFromChunks(chunks);

    // Empty name → skipped → no tool calls → treated as final response
    expect(result).toHaveLength(0);
  });

  it("should handle multiple tool calls", () => {
    const chunks = new Map<number, ToolCallChunk>();
    chunks.set(0, { id: "call_1", name: "localSearch", args: '{"query":"piano"}' });
    chunks.set(1, { id: "call_2", name: "readNote", args: '{"path":"notes/music.md"}' });

    const result = buildToolCallsFromChunks(chunks);

    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("localSearch");
    expect(result[1].name).toBe("readNote");
  });

  it("should generate an ID when chunk has no id", () => {
    const chunks = new Map<number, ToolCallChunk>();
    chunks.set(0, { name: "localSearch", args: '{"query":"test"}' });

    const result = buildToolCallsFromChunks(chunks);

    expect(result).toHaveLength(1);
    expect(result[0].id).toMatch(/^call_/);
  });

  it("should handle malformed JSON args gracefully", () => {
    const chunks = new Map<number, ToolCallChunk>();
    chunks.set(0, { name: "localSearch", args: "not valid json" });

    const result = buildToolCallsFromChunks(chunks);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("localSearch");
    expect(result[0].args).toEqual({});
  });

  it("should handle empty args", () => {
    const chunks = new Map<number, ToolCallChunk>();
    chunks.set(0, { name: "localSearch", args: "" });

    const result = buildToolCallsFromChunks(chunks);

    expect(result).toHaveLength(1);
    expect(result[0].args).toEqual({});
  });
});

describe("End-to-end: Gemini streaming → buildToolCallsFromChunks", () => {
  it("should correctly process Gemini-format chunks through the full pipeline", () => {
    const chunks = new Map<number, ToolCallChunk>();

    // Simulate Gemini streaming: name comes via functionCall, not top-level
    accumulateToolCallChunk(chunks, {
      index: 0,
      id: "call_gemini_1",
      functionCall: { name: "localSearch" },
      args: '{"query":"piano notes"}',
    });

    const result = buildToolCallsFromChunks(chunks);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("localSearch");
    expect(result[0].args).toEqual({ query: "piano notes" });
  });

  it("should correctly process OpenAI-format chunks through the full pipeline", () => {
    const chunks = new Map<number, ToolCallChunk>();

    // Simulate OpenAI streaming: name at top level
    accumulateToolCallChunk(chunks, {
      index: 0,
      id: "call_openai_1",
      name: "localSearch",
      args: '{"query":"piano notes"}',
    });

    const result = buildToolCallsFromChunks(chunks);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("localSearch");
    expect(result[0].args).toEqual({ query: "piano notes" });
  });

  it("should handle sequential Gemini tool calls (the failing scenario)", () => {
    const chunks = new Map<number, ToolCallChunk>();

    // This is the exact scenario that was failing:
    // Gemini 3.1 Pro returns 2 sequential tool calls, but names were dropped
    accumulateToolCallChunk(chunks, {
      index: 0,
      id: "call_g1",
      functionCall: { name: "localSearch" },
      args: '{"query":"search term"}',
    });
    accumulateToolCallChunk(chunks, {
      index: 1,
      id: "call_g2",
      functionCall: { name: "readNote" },
      args: '{"path":"some/note.md"}',
    });

    const result = buildToolCallsFromChunks(chunks);

    // Both tool calls should be preserved — before the fix, both were dropped
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("localSearch");
    expect(result[1].name).toBe("readNote");
  });
});
