import {
  accumulateToolCallChunk,
  buildToolCallsFromChunks,
  createToolResultMessage,
  generateToolCallId,
  ToolCallChunk,
} from "./nativeToolCalling";

jest.mock("@/logger");

describe("nativeToolCalling", () => {
  describe("accumulateToolCallChunk()", () => {
    it("joins streamed name and args fragments of one index into a single tool call", () => {
      const chunks = new Map<number, ToolCallChunk>();

      accumulateToolCallChunk(chunks, {
        index: 0,
        id: "call_123",
        name: "localSearch",
        args: '{"qu',
      });
      accumulateToolCallChunk(chunks, { index: 0, args: 'ery":' });
      accumulateToolCallChunk(chunks, { index: 0, args: '"test"}' });

      expect(chunks.get(0)).toEqual({
        id: "call_123",
        name: "localSearch",
        args: '{"query":"test"}',
      });
    });

    it("keeps concurrent tool calls apart by index", () => {
      const chunks = new Map<number, ToolCallChunk>();

      accumulateToolCallChunk(chunks, { index: 0, name: "localSearch", args: '{"q":"a"}' });
      accumulateToolCallChunk(chunks, { index: 1, name: "readNote", args: '{"path":"b"}' });

      expect(chunks.get(0)).toMatchObject({ name: "localSearch", args: '{"q":"a"}' });
      expect(chunks.get(1)).toMatchObject({ name: "readNote", args: '{"path":"b"}' });
    });

    it("reads the tool name from functionCall.name when a Gemini chunk has no top-level name", () => {
      const chunks = new Map<number, ToolCallChunk>();

      accumulateToolCallChunk(chunks, {
        index: 0,
        id: "call_456",
        functionCall: { name: "localSearch" },
        args: '{"query":"test"}',
      });

      expect(chunks.get(0)).toEqual({
        id: "call_456",
        name: "localSearch",
        args: '{"query":"test"}',
      });
    });

    it("prefers the top-level name over functionCall.name", () => {
      const chunks = new Map<number, ToolCallChunk>();

      accumulateToolCallChunk(chunks, {
        index: 0,
        name: "topLevel",
        functionCall: { name: "nested" },
        args: "{}",
      });

      expect(chunks.get(0)!.name).toBe("topLevel");
    });

    it("files a chunk without an index under index 0", () => {
      const chunks = new Map<number, ToolCallChunk>();

      accumulateToolCallChunk(chunks, { name: "localSearch", args: "{}" });

      expect(chunks.get(0)).toMatchObject({ name: "localSearch" });
    });

    it("leaves the name empty when no chunk of the call carries one", () => {
      const chunks = new Map<number, ToolCallChunk>();

      accumulateToolCallChunk(chunks, { index: 0, args: '{"query":"test"}' });

      expect(chunks.get(0)).toEqual({ name: "", args: '{"query":"test"}' });
    });
  });

  describe("buildToolCallsFromChunks()", () => {
    it("parses accumulated args into tool calls in index order", () => {
      const chunks = new Map<number, ToolCallChunk>();
      chunks.set(0, { id: "call_1", name: "localSearch", args: '{"query":"test"}' });
      chunks.set(1, { id: "call_2", name: "readNote", args: '{"path":"notes/a.md"}' });

      expect(buildToolCallsFromChunks(chunks)).toEqual([
        { id: "call_1", name: "localSearch", args: { query: "test" } },
        { id: "call_2", name: "readNote", args: { path: "notes/a.md" } },
      ]);
    });

    it("builds sequential Gemini-style streamed calls whose names arrive under functionCall", () => {
      const chunks = new Map<number, ToolCallChunk>();
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

      expect(buildToolCallsFromChunks(chunks)).toEqual([
        { id: "call_g1", name: "localSearch", args: { query: "search term" } },
        { id: "call_g2", name: "readNote", args: { path: "some/note.md" } },
      ]);
    });

    it("generates a call_ id when the chunk has none", () => {
      const chunks = new Map<number, ToolCallChunk>();
      chunks.set(0, { name: "localSearch", args: '{"query":"test"}' });

      const [call] = buildToolCallsFromChunks(chunks);

      expect(call.id).toMatch(/^call_/);
    });

    it("skips chunks that never received a tool name", () => {
      const chunks = new Map<number, ToolCallChunk>();
      chunks.set(0, { name: "", args: '{"query":"test"}' });

      expect(buildToolCallsFromChunks(chunks)).toEqual([]);
    });

    it("uses empty args when the accumulated args are empty", () => {
      const chunks = new Map<number, ToolCallChunk>();
      chunks.set(0, { id: "call_1", name: "localSearch", args: "" });

      expect(buildToolCallsFromChunks(chunks)).toEqual([
        { id: "call_1", name: "localSearch", args: {} },
      ]);
    });

    it("keeps the tool call with empty args when the accumulated args are not valid JSON", () => {
      const chunks = new Map<number, ToolCallChunk>();
      chunks.set(0, { id: "call_1", name: "localSearch", args: "not valid json" });

      expect(buildToolCallsFromChunks(chunks)).toEqual([
        { id: "call_1", name: "localSearch", args: {} },
      ]);
    });
  });

  describe("createToolResultMessage()", () => {
    it("wraps a tool result in a ToolMessage paired to the originating call id", () => {
      const message = createToolResultMessage("call_1", "localSearch", "3 results");

      expect(message.content).toBe("3 results");
      expect(message.tool_call_id).toBe("call_1");
      expect(message.name).toBe("localSearch");
    });
  });

  describe("generateToolCallId()", () => {
    it("returns a call_-prefixed id that differs between calls", () => {
      const first = generateToolCallId();
      const second = generateToolCallId();

      expect(first).toMatch(/^call_/);
      expect(second).not.toBe(first);
    });
  });
});
