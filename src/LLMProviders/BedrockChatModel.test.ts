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
});
