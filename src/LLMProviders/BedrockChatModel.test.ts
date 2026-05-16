import { BedrockChatModel } from "./BedrockChatModel";

type ProcessStreamResult = {
  deltaChunks: Array<{
    text?: string;
    message: {
      content: unknown;
      additional_kwargs?: { delta?: { reasoning?: string } };
    };
  }>;
  usage?: Record<string, unknown>;
  stopReason?: string;
  hasText: boolean;
  debugSummaries: string[];
};

type ContentItem = { type: string; text?: string; thinking?: string };

type ImageContent = {
  type: "image";
  source: { type: "base64"; media_type: string; data: string };
} | null;

type RequestBody = {
  thinking?: { type: string; budget_tokens: number };
  temperature?: number;
  anthropic_version?: string;
  messages: Array<{
    role: string;
    content: Array<{
      type: string;
      text?: string;
      source?: { type: string; media_type: string; data: string };
    }>;
  }>;
};

type BedrockInternal = {
  decodeChunkBytes: (encoded: string) => string[];
  processStreamEvent: (
    event: unknown,
    runManager: unknown,
    currentUsage: unknown,
    currentStopReason: unknown
  ) => Promise<ProcessStreamResult>;
  buildContentItemsFromDelta: (event: unknown) => ContentItem[] | null;
  extractStreamText: (event: unknown) => string | null;
  buildRequestBody: (messages: unknown[], options?: unknown) => RequestBody;
  convertImageContent: (imageUrl: string) => ImageContent;
  normaliseMessageContent: (
    message: unknown
  ) => string | Array<{ type: string; [key: string]: unknown }>;
};

const asInternal = (m: BedrockChatModel): BedrockInternal => m as unknown as BedrockInternal;

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

const createModel = (enableThinking = false): BedrockChatModel =>
  new BedrockChatModel({
    modelId: "anthropic.claude-3-haiku-20240307-v1:0",
    apiKey: "test-key",
    endpoint: "https://example.com/model/anthropic.claude-3-haiku-20240307-v1%3A0/invoke",
    streamEndpoint:
      "https://example.com/model/anthropic.claude-3-haiku-20240307-v1%3A0/invoke-with-response-stream",
    anthropicVersion: "bedrock-2023-05-31",
    enableThinking,
    fetchImplementation: jest.fn(),
  });

const createModelWithFetch = (
  fetchMock: jest.Mock,
  opts?: { modelId?: string; noStream?: boolean }
): BedrockChatModel =>
  new BedrockChatModel({
    modelId: opts?.modelId ?? "anthropic.claude-sonnet-4-5-20250929-v1:0",
    apiKey: "test-key",
    endpoint: "https://example.com/model/anthropic.claude-sonnet-4-5-20250929-v1%3A0/invoke",
    ...(opts?.noStream
      ? {}
      : {
          streamEndpoint:
            "https://example.com/model/anthropic.claude-sonnet-4-5-20250929-v1%3A0/invoke-with-response-stream",
        }),
    anthropicVersion: "bedrock-2023-05-31",
    fetchImplementation: fetchMock,
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
    const decoded = asInternal(model).decodeChunkBytes(base64);

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
    const decoded = asInternal(model).decodeChunkBytes(base64);

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
    const processed = await asInternal(model).processStreamEvent(
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
      const contentItems = asInternal(model).buildContentItemsFromDelta(event);

      expect(contentItems).toHaveLength(1);
      expect(contentItems![0]).toEqual({
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
      const contentItems = asInternal(model).buildContentItemsFromDelta(event);

      expect(contentItems).toHaveLength(1);
      expect(contentItems![0]).toEqual({
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
      const processed = await asInternal(model).processStreamEvent(
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
      const content = chunk?.message.content as unknown[];
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
      const processed = await asInternal(model).processStreamEvent(
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
      const content = chunk?.message.content as unknown[];
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

      const thinkingResult = await asInternal(model).processStreamEvent(
        thinkingEvent,
        undefined,
        undefined,
        undefined
      );

      expect(thinkingResult.deltaChunks).toHaveLength(1);
      const thinkingChunk = thinkingResult.deltaChunks[0];
      expect((thinkingChunk?.message.content as Array<{ type: string }>)[0]?.type).toBe("thinking");

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

      const textResult = await asInternal(model).processStreamEvent(
        textEvent,
        undefined,
        undefined,
        undefined
      );

      expect(textResult.deltaChunks).toHaveLength(1);
      const textChunk = textResult.deltaChunks[0];
      expect((textChunk?.message.content as Array<{ type: string }>)[0]?.type).toBe("text");
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
      const extracted = asInternal(model).extractStreamText(event);

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
      const contentItems = asInternal(model).buildContentItemsFromDelta(event);

      expect(contentItems).toHaveLength(1);
      expect(contentItems![0]).toEqual({
        type: "thinking",
        thinking: "",
      });
    });
  });

  describe("thinking mode enablement", () => {
    it("includes thinking parameter when enableThinking is true", () => {
      const model = createModel(true);
      const requestBody = asInternal(model).buildRequestBody([
        { role: "user", content: "test", getType: () => "human" },
      ]);

      expect(requestBody.thinking).toEqual({
        type: "enabled",
        budget_tokens: 2048,
      });
      expect(requestBody.temperature).toBe(1);
      expect(requestBody.anthropic_version).toBe("bedrock-2023-05-31");
    });

    it("does not include thinking parameter when enableThinking is false", () => {
      const model = createModel(false);
      const requestBody = asInternal(model).buildRequestBody(
        [{ role: "user", content: "test", getType: () => "human" }],
        { temperature: 0.7 }
      );

      expect(requestBody.thinking).toBeUndefined();
      expect(requestBody.temperature).toBe(0.7);
      // anthropic_version should always be present when provided (required for all Bedrock requests)
      expect(requestBody.anthropic_version).toBe("bedrock-2023-05-31");
    });

    it("respects user temperature when thinking is disabled", () => {
      const model = createModel(false);
      const requestBody = asInternal(model).buildRequestBody(
        [{ role: "user", content: "test", getType: () => "human" }],
        { temperature: 0.5 }
      );

      expect(requestBody.temperature).toBe(0.5);
      expect(requestBody.thinking).toBeUndefined();
    });

    it("forces temperature to 1 when thinking is enabled", () => {
      const model = createModel(true);
      const requestBody = asInternal(model).buildRequestBody(
        [{ role: "user", content: "test", getType: () => "human" }],
        { temperature: 0.5 } // User tries to set 0.5, should be overridden to 1
      );

      expect(requestBody.temperature).toBe(1);
      expect(requestBody.thinking).toBeDefined();
    });
  });

  describe("vision support", () => {
    describe("convertImageContent", () => {
      it("converts valid data URL to Claude image format", () => {
        const model = createModel();
        const dataUrl = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
        const result = asInternal(model).convertImageContent(dataUrl);

        expect(result).toEqual({
          type: "image",
          source: {
            type: "base64",
            media_type: "image/jpeg",
            data: "/9j/4AAQSkZJRg==",
          },
        });
      });

      it("handles PNG images", () => {
        const model = createModel();
        const dataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";
        const result = asInternal(model).convertImageContent(dataUrl);

        expect(result).toEqual({
          type: "image",
          source: {
            type: "base64",
            media_type: "image/png",
            data: "iVBORw0KGgoAAAANSUhEUg==",
          },
        });
      });

      it("returns null for invalid data URL format", () => {
        const model = createModel();
        const invalidUrl = "not-a-data-url";
        const result = asInternal(model).convertImageContent(invalidUrl);

        expect(result).toBeNull();
      });

      it("returns null for non-image media type", () => {
        const model = createModel();
        const dataUrl = "data:text/plain;base64,SGVsbG8gV29ybGQ=";
        const result = asInternal(model).convertImageContent(dataUrl);

        expect(result).toBeNull();
      });
    });

    describe("normaliseMessageContent", () => {
      it("preserves array content with images", () => {
        const model = createModel();
        const message = {
          content: [
            { type: "text", text: "What's in this image?" },
            {
              type: "image_url",
              image_url: { url: "data:image/jpeg;base64,/9j/4AAQSkZJRg==" },
            },
          ],
          getType: () => "human",
        };

        const result = asInternal(model).normaliseMessageContent(message);

        expect(Array.isArray(result)).toBe(true);
        expect(result).toHaveLength(2);
        expect(result[0]).toEqual({ type: "text", text: "What's in this image?" });
        expect(result[1]).toEqual({
          type: "image_url",
          image_url: { url: "data:image/jpeg;base64,/9j/4AAQSkZJRg==" },
        });
      });

      it("flattens array content without images to string", () => {
        const model = createModel();
        const message = {
          content: [
            { type: "text", text: "Hello " },
            { type: "text", text: "world!" },
          ],
          getType: () => "human",
        };

        const result = asInternal(model).normaliseMessageContent(message);

        expect(typeof result).toBe("string");
        expect(result).toBe("Hello world!");
      });

      it("returns string content unchanged", () => {
        const model = createModel();
        const message = {
          content: "Simple text message",
          getType: () => "human",
        };

        const result = asInternal(model).normaliseMessageContent(message);

        expect(result).toBe("Simple text message");
      });
    });

    describe("buildRequestBody with images", () => {
      it("includes images in request body for multimodal messages", () => {
        const model = createModel();
        const messages = [
          {
            content: [
              { type: "text", text: "What's in this image?" },
              {
                type: "image_url",
                image_url: { url: "data:image/jpeg;base64,/9j/4AAQSkZJRg==" },
              },
            ],
            getType: () => "human",
          },
        ];

        const requestBody = asInternal(model).buildRequestBody(messages);

        expect(requestBody.messages).toHaveLength(1);
        expect(requestBody.messages[0].content).toHaveLength(2);

        // Check text block
        expect(requestBody.messages[0].content[0]).toEqual({
          type: "text",
          text: "What's in this image?",
        });

        // Check image block (converted to Claude format)
        expect(requestBody.messages[0].content[1]).toEqual({
          type: "image",
          source: {
            type: "base64",
            media_type: "image/jpeg",
            data: "/9j/4AAQSkZJRg==",
          },
        });
      });

      it("handles multiple images in a single message", () => {
        const model = createModel();
        const messages = [
          {
            content: [
              { type: "text", text: "Compare these images:" },
              {
                type: "image_url",
                image_url: { url: "data:image/jpeg;base64,IMAGE1DATA" },
              },
              {
                type: "image_url",
                image_url: { url: "data:image/png;base64,IMAGE2DATA" },
              },
            ],
            getType: () => "human",
          },
        ];

        const requestBody = asInternal(model).buildRequestBody(messages);

        expect(requestBody.messages[0].content).toHaveLength(3);
        expect(requestBody.messages[0].content[0].type).toBe("text");
        expect(requestBody.messages[0].content[1].type).toBe("image");
        expect(requestBody.messages[0].content[1].source!.media_type).toBe("image/jpeg");
        expect(requestBody.messages[0].content[2].type).toBe("image");
        expect(requestBody.messages[0].content[2].source!.media_type).toBe("image/png");
      });

      it("handles text-only messages correctly", () => {
        const model = createModel();
        const messages = [
          {
            content: "Just text, no images",
            getType: () => "human",
          },
        ];

        const requestBody = asInternal(model).buildRequestBody(messages);

        expect(requestBody.messages).toHaveLength(1);
        expect(requestBody.messages[0].content).toHaveLength(1);
        expect(requestBody.messages[0].content[0]).toEqual({
          type: "text",
          text: "Just text, no images",
        });
      });

      it("skips invalid images and keeps valid content", () => {
        const model = createModel();
        const messages = [
          {
            content: [
              { type: "text", text: "Valid text" },
              {
                type: "image_url",
                image_url: { url: "invalid-url" }, // Invalid - should be skipped
              },
              {
                type: "image_url",
                image_url: { url: "data:image/jpeg;base64,VALIDDATA" }, // Valid
              },
            ],
            getType: () => "human",
          },
        ];

        const requestBody = asInternal(model).buildRequestBody(messages);

        // Should have text + 1 valid image (invalid one skipped)
        expect(requestBody.messages[0].content).toHaveLength(2);
        expect(requestBody.messages[0].content[0].type).toBe("text");
        expect(requestBody.messages[0].content[1].type).toBe("image");
      });
    });
  });
});

describe("BedrockChatModel inference-profile error rewriting", () => {
  const awsInferenceProfileError = JSON.stringify({
    message:
      "Invocation of model ID anthropic.claude-sonnet-4-5 with on-demand throughput isn't supported. Retry your request with the ID or ARN of an inference profile that contains this model.",
  });

  const makeErrorResponse = (status: number, body: string): Response =>
    ({
      ok: false,
      status,
      text: () => Promise.resolve(body),
    }) as unknown as Response;

  it("rewrites 400 inference-profile error in non-streaming path to actionable message", async () => {
    const fetchMock = jest.fn().mockResolvedValue(makeErrorResponse(400, awsInferenceProfileError));
    const model = createModelWithFetch(fetchMock, { noStream: true });

    const messages = [{ content: "hi", getType: () => "human", type: "human" }];
    await expect(model._generate(messages as never, {})).rejects.toThrow(
      /cross-region inference profile ID/
    );
  });

  it("rewrites 400 inference-profile error in streaming path to actionable message", async () => {
    const fetchMock = jest.fn().mockResolvedValue(makeErrorResponse(400, awsInferenceProfileError));
    const model = createModelWithFetch(fetchMock);

    const messages = [{ content: "hi", getType: () => "human", type: "human" }];
    const gen = model._streamResponseChunks(messages as never, {});
    await expect(gen.next()).rejects.toThrow(/cross-region inference profile ID/);
  });

  it("includes the bare model ID in the rewritten message", async () => {
    const fetchMock = jest.fn().mockResolvedValue(makeErrorResponse(400, awsInferenceProfileError));
    const model = createModelWithFetch(fetchMock, { noStream: true });

    const messages = [{ content: "hi", getType: () => "human", type: "human" }];
    await expect(model._generate(messages as never, {})).rejects.toThrow(
      /anthropic\.claude-sonnet-4-5/
    );
  });

  it("does not rewrite a 400 error that is unrelated to inference profiles", async () => {
    const genericBody = JSON.stringify({ message: "ValidationException: bad request" });
    const fetchMock = jest.fn().mockResolvedValue(makeErrorResponse(400, genericBody));
    const model = createModelWithFetch(fetchMock, { noStream: true });

    const messages = [{ content: "hi", getType: () => "human", type: "human" }];
    await expect(model._generate(messages as never, {})).rejects.toThrow(
      /Amazon Bedrock request failed with status 400/
    );
  });

  it("does not rewrite non-400 errors", async () => {
    const body = JSON.stringify({ message: "Internal Server Error" });
    const fetchMock = jest.fn().mockResolvedValue(makeErrorResponse(500, body));
    const model = createModelWithFetch(fetchMock, { noStream: true });

    const messages = [{ content: "hi", getType: () => "human", type: "human" }];
    await expect(model._generate(messages as never, {})).rejects.toThrow(
      /Amazon Bedrock request failed with status 500/
    );
  });

  it("rewrites the error even when AWS uses a curly apostrophe in 'isn’t supported'", async () => {
    const curlyApostropheBody = JSON.stringify({
      message:
        "Invocation of model ID anthropic.claude-sonnet-4-5 with on-demand throughput isn’t supported. Retry your request with the ID or ARN of an inference profile that contains this model.",
    });
    const fetchMock = jest.fn().mockResolvedValue(makeErrorResponse(400, curlyApostropheBody));
    const model = createModelWithFetch(fetchMock, { noStream: true });

    const messages = [{ content: "hi", getType: () => "human", type: "human" }];
    await expect(model._generate(messages as never, {})).rejects.toThrow(
      /cross-region inference profile ID/
    );
  });

  it("uses the provider segment from the bare model ID in the prefix guidance", async () => {
    const nonAnthropicBody = JSON.stringify({
      message:
        "Invocation of model ID meta.llama4-maverick-17b with on-demand throughput isn't supported. Retry your request with the ID or ARN of an inference profile that contains this model.",
    });
    const fetchMock = jest.fn().mockResolvedValue(makeErrorResponse(400, nonAnthropicBody));
    const model = createModelWithFetch(fetchMock, { noStream: true });

    const messages = [{ content: "hi", getType: () => "human", type: "human" }];
    await expect(model._generate(messages as never, {})).rejects.toThrow(/global\.meta\.<id>/);
  });
});
