import { BedrockChatModel } from "./BedrockChatModel";

/**
 * Builds a minimal Amazon EventStream message containing the provided UTF-8 payload.
 * This helper keeps CRC fields at zero because the decoder ignores them.
 */
const buildEventStreamChunk = (payload: string): string => {
  const encoder = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;
  const payloadBytes = encoder ? encoder.encode(payload) : Buffer.from(payload, "utf-8");
  const headersLength = 0;
  const totalLength = 12 + headersLength + payloadBytes.length + 4;

  const buffer = new Uint8Array(totalLength);
  const view = new DataView(buffer.buffer);

  view.setUint32(0, totalLength, false);
  view.setUint32(4, headersLength, false);
  view.setUint32(8, 0, false); // Prelude CRC (ignored by decoder)

  buffer.set(payloadBytes, 12);
  view.setUint32(totalLength - 4, 0, false); // Message CRC (ignored by decoder)

  return Buffer.from(buffer).toString("base64");
};

const createModel = (): BedrockChatModel =>
  new BedrockChatModel({
    modelId: "anthropic.claude-3-haiku-20240307-v1:0",
    apiKey: "test-key",
    endpoint: "https://example.com/model/anthropic.claude-3-haiku-20240307-v1%3A0/invoke",
    streamEndpoint:
      "https://example.com/model/anthropic.claude-3-haiku-20240307-v1%3A0/invoke-with-response-stream",
    fetchImplementation: jest.fn(),
  });

describe("BedrockChatModel streaming decode", () => {
  it("decodes simple base64 JSON payloads", () => {
    const payload = JSON.stringify({
      type: "content_block_delta",
      content_block_delta: {
        index: 0,
        delta: { text: "Hello there" },
      },
    });

    const base64 = Buffer.from(payload, "utf-8").toString("base64");

    const model = createModel();
    const decoded = (model as any).decodeChunkBytes(base64);

    expect(decoded).toEqual([payload]);
  });

  it("extracts payloads from Amazon EventStream encoded chunks", () => {
    const payload = JSON.stringify({
      type: "content_block_delta",
      content_block_delta: {
        index: 0,
        delta: { type: "text_delta", text: "Streaming works!" },
      },
    });

    const base64 = buildEventStreamChunk(payload);
    const model = createModel();
    const decoded = (model as any).decodeChunkBytes(base64);

    expect(decoded).toEqual([payload]);
  });

  it("produces ChatGenerationChunk entries for decoded deltas", async () => {
    const payload = JSON.stringify({
      type: "content_block_delta",
      content_block_delta: {
        index: 0,
        delta: { type: "text_delta", text: "Chunk text" },
      },
    });

    const base64 = buildEventStreamChunk(payload);
    const event = {
      type: "chunk",
      chunk: { bytes: base64 },
    };

    const model = createModel();
    const processed = await (model as any).processStreamEvent(
      event,
      undefined,
      undefined,
      undefined
    );

    expect(processed.hasText).toBe(true);
    expect(processed.deltaChunks).toHaveLength(1);
    expect(processed.deltaChunks[0]?.text).toBe("Chunk text");
  });

  describe("thinking content support", () => {
    it("buildContentItemsFromDelta recognizes thinking delta type", () => {
      const event = {
        type: "content_block_delta",
        content_block_delta: {
          index: 0,
          delta: {
            type: "thinking",
            thinking: "Let me analyze this problem...",
          },
        },
      };

      const model = createModel();
      const contentItems = (model as any).buildContentItemsFromDelta(event);

      expect(contentItems).toHaveLength(1);
      expect(contentItems[0]).toEqual({
        type: "thinking",
        thinking: "Let me analyze this problem...",
      });
    });

    it("buildContentItemsFromDelta recognizes text_delta type", () => {
      const event = {
        type: "content_block_delta",
        content_block_delta: {
          index: 0,
          delta: {
            type: "text_delta",
            text: "Based on my analysis, the answer is...",
          },
        },
      };

      const model = createModel();
      const contentItems = (model as any).buildContentItemsFromDelta(event);

      expect(contentItems).toHaveLength(1);
      expect(contentItems[0]).toEqual({
        type: "text",
        text: "Based on my analysis, the answer is...",
      });
    });

    it("processStreamEvent returns chunks with thinking content array", async () => {
      const payload = JSON.stringify({
        type: "content_block_delta",
        content_block_delta: {
          index: 0,
          delta: {
            type: "thinking",
            thinking: "Reasoning through this...",
          },
        },
      });

      const base64 = buildEventStreamChunk(payload);
      const event = {
        type: "chunk",
        chunk: { bytes: base64 },
      };

      const model = createModel();
      const processed = await (model as any).processStreamEvent(
        event,
        undefined,
        undefined,
        undefined
      );

      expect(processed.hasText).toBe(true);
      expect(processed.deltaChunks).toHaveLength(1);
      const chunk = processed.deltaChunks[0];
      expect(chunk?.text).toBe("Reasoning through this...");

      // Check that content is an array with thinking type
      expect(Array.isArray(chunk?.message.content)).toBe(true);
      const content = chunk?.message.content as any[];
      expect(content).toHaveLength(1);
      expect(content[0]).toEqual({
        type: "thinking",
        thinking: "Reasoning through this...",
      });

      // Check for OpenRouter compatibility
      expect(chunk?.message.additional_kwargs).toBeDefined();
      expect(chunk?.message.additional_kwargs?.delta).toEqual({
        reasoning: "Reasoning through this...",
      });
    });

    it("processStreamEvent returns chunks with text content array", async () => {
      const payload = JSON.stringify({
        type: "content_block_delta",
        content_block_delta: {
          index: 0,
          delta: {
            type: "text_delta",
            text: "Here is my final answer.",
          },
        },
      });

      const base64 = buildEventStreamChunk(payload);
      const event = {
        type: "chunk",
        chunk: { bytes: base64 },
      };

      const model = createModel();
      const processed = await (model as any).processStreamEvent(
        event,
        undefined,
        undefined,
        undefined
      );

      expect(processed.hasText).toBe(true);
      expect(processed.deltaChunks).toHaveLength(1);
      const chunk = processed.deltaChunks[0];
      expect(chunk?.text).toBe("Here is my final answer.");

      // Check that content is an array with text type
      expect(Array.isArray(chunk?.message.content)).toBe(true);
      const content = chunk?.message.content as any[];
      expect(content).toHaveLength(1);
      expect(content[0]).toEqual({
        type: "text",
        text: "Here is my final answer.",
      });

      // No additional_kwargs.delta for regular text
      expect(chunk?.message.additional_kwargs?.delta).toBeUndefined();
    });

    it("handles mixed thinking and text deltas correctly", async () => {
      const model = createModel();

      // First chunk: thinking
      const thinkingPayload = JSON.stringify({
        type: "content_block_delta",
        content_block_delta: {
          index: 0,
          delta: {
            type: "thinking",
            thinking: "First, I'll consider...",
          },
        },
      });

      const thinkingBase64 = buildEventStreamChunk(thinkingPayload);
      const thinkingEvent = {
        type: "chunk",
        chunk: { bytes: thinkingBase64 },
      };

      const thinkingResult = await (model as any).processStreamEvent(
        thinkingEvent,
        undefined,
        undefined,
        undefined
      );

      expect(thinkingResult.deltaChunks).toHaveLength(1);
      const thinkingChunk = thinkingResult.deltaChunks[0];
      expect((thinkingChunk?.message.content as any[])[0]?.type).toBe("thinking");

      // Second chunk: text
      const textPayload = JSON.stringify({
        type: "content_block_delta",
        content_block_delta: {
          index: 0,
          delta: {
            type: "text_delta",
            text: "Therefore, the answer is X.",
          },
        },
      });

      const textBase64 = buildEventStreamChunk(textPayload);
      const textEvent = {
        type: "chunk",
        chunk: { bytes: textBase64 },
      };

      const textResult = await (model as any).processStreamEvent(
        textEvent,
        undefined,
        undefined,
        undefined
      );

      expect(textResult.deltaChunks).toHaveLength(1);
      const textChunk = textResult.deltaChunks[0];
      expect((textChunk?.message.content as any[])[0]?.type).toBe("text");
    });

    it("extractStreamText can fallback to extract thinking content", () => {
      const event = {
        type: "content_block_delta",
        content_block_delta: {
          delta: {
            type: "thinking",
            thinking: "Fallback thinking extraction",
          },
        },
      };

      const model = createModel();
      const extracted = (model as any).extractStreamText(event);

      expect(extracted).toBe("Fallback thinking extraction");
    });

    it("handles empty thinking content gracefully", () => {
      const event = {
        type: "content_block_delta",
        content_block_delta: {
          delta: {
            type: "thinking",
            thinking: "",
          },
        },
      };

      const model = createModel();
      const contentItems = (model as any).buildContentItemsFromDelta(event);

      expect(contentItems).toHaveLength(1);
      expect(contentItems[0]).toEqual({
        type: "thinking",
        thinking: "",
      });
    });
  });
});
