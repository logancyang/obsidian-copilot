import * as obsidianModule from "obsidian";

import { BedrockChatModel } from "./BedrockChatModel";

/** The obsidian mock's seam for stubbing `requestUrl` per test. */
const { __setRequestUrlImpl: setRequestUrlImpl } = obsidianModule as unknown as {
  __setRequestUrlImpl: (impl: unknown) => void;
};

type ImageContent = {
  type: "image";
  source: { type: "base64"; media_type: string; data: string };
} | null;

type RequestBody = {
  thinking?:
    | { type: "enabled"; budget_tokens: number }
    | { type: "adaptive"; display?: "summarized" | "omitted" };
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
  buildRequestBody: (messages: unknown[], options?: unknown) => RequestBody;
  convertImageContent: (imageUrl: string) => ImageContent;
  normaliseMessageContent: (
    message: unknown
  ) => string | Array<{ type: string; [key: string]: unknown }>;
};

const asInternal = (m: BedrockChatModel): BedrockInternal => m as unknown as BedrockInternal;

const createModel = (
  enableThinking = false,
  modelId = "anthropic.claude-3-haiku-20240307-v1:0"
): BedrockChatModel =>
  new BedrockChatModel({
    modelId,
    apiKey: "test-key",
    endpoint: `https://example.com/model/${encodeURIComponent(modelId)}/invoke`,
    anthropicVersion: "bedrock-2023-05-31",
    enableThinking,
  });

describe("BedrockChatModel", () => {
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

    it("uses adaptive thinking with summarized display for claude-opus-4-7", () => {
      const model = createModel(true, "anthropic.claude-opus-4-7-20260115-v1:0");
      const requestBody = asInternal(model).buildRequestBody([
        { role: "user", content: "test", getType: () => "human" },
      ]);

      expect(requestBody.thinking).toEqual({ type: "adaptive", display: "summarized" });
      expect(requestBody.temperature).toBe(1);
    });

    it("uses adaptive thinking for opus-4-7 cross-region inference profiles", () => {
      const model = createModel(true, "global.anthropic.claude-opus-4-7-20260115-v1:0");
      const requestBody = asInternal(model).buildRequestBody([
        { role: "user", content: "test", getType: () => "human" },
      ]);

      expect(requestBody.thinking).toEqual({ type: "adaptive", display: "summarized" });
    });

    it("keeps legacy thinking for opus-4-6 and earlier", () => {
      const model = createModel(true, "anthropic.claude-opus-4-6-20250115-v1:0");
      const requestBody = asInternal(model).buildRequestBody([
        { role: "user", content: "test", getType: () => "human" },
      ]);

      expect(requestBody.thinking).toEqual({ type: "enabled", budget_tokens: 2048 });
    });

    it("keeps legacy thinking for sonnet-4 and 3-7-sonnet", () => {
      const sonnet45 = createModel(true, "anthropic.claude-sonnet-4-5-20250929-v1:0");
      expect(
        asInternal(sonnet45).buildRequestBody([
          { role: "user", content: "test", getType: () => "human" },
        ]).thinking
      ).toEqual({ type: "enabled", budget_tokens: 2048 });

      const sonnet37 = createModel(true, "anthropic.claude-3-7-sonnet-20250219-v1:0");
      expect(
        asInternal(sonnet37).buildRequestBody([
          { role: "user", content: "test", getType: () => "human" },
        ]).thinking
      ).toEqual({ type: "enabled", budget_tokens: 2048 });
    });

    it("keeps legacy thinking for dated Opus 4.0 snapshot IDs", () => {
      // anthropic.claude-opus-4-20250514-v1:0 is the dated snapshot of Opus 4.0, not 4.20250514.
      const opus40 = createModel(true, "anthropic.claude-opus-4-20250514-v1:0");
      expect(
        asInternal(opus40).buildRequestBody([
          { role: "user", content: "test", getType: () => "human" },
        ]).thinking
      ).toEqual({ type: "enabled", budget_tokens: 2048 });

      // anthropic.claude-opus-4-1-20250805-v1:0 is dated 4.1, not adaptive.
      const opus41 = createModel(true, "anthropic.claude-opus-4-1-20250805-v1:0");
      expect(
        asInternal(opus41).buildRequestBody([
          { role: "user", content: "test", getType: () => "human" },
        ]).thinking
      ).toEqual({ type: "enabled", budget_tokens: 2048 });
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

  describe("_generate()", () => {
    const awsInferenceProfileError = JSON.stringify({
      message:
        "Invocation of model ID anthropic.claude-sonnet-4-5 with on-demand throughput isn't supported. Retry your request with the ID or ARN of an inference profile that contains this model.",
    });

    /**
     * Stubs the buffered transport `_generate` uses so the assertions exercise the
     * error-rewriting branch without touching the network.
     */
    const stubRequestUrlError = (status: number, body: string): void => {
      setRequestUrlImpl(jest.fn().mockResolvedValue({ status, text: body, headers: {} }));
    };

    it("rewrites 400 inference-profile error to actionable message", async () => {
      stubRequestUrlError(400, awsInferenceProfileError);
      const model = createModel(false, "anthropic.claude-sonnet-4-5-20250929-v1:0");

      const messages = [{ content: "hi", getType: () => "human", type: "human" }];
      await expect(model._generate(messages as never, {})).rejects.toThrow(
        /cross-region inference profile ID/
      );
    });

    it("includes the bare model ID in the rewritten message", async () => {
      stubRequestUrlError(400, awsInferenceProfileError);
      const model = createModel(false, "anthropic.claude-sonnet-4-5-20250929-v1:0");

      const messages = [{ content: "hi", getType: () => "human", type: "human" }];
      await expect(model._generate(messages as never, {})).rejects.toThrow(
        /anthropic\.claude-sonnet-4-5/
      );
    });

    it("does not rewrite a 400 error that is unrelated to inference profiles", async () => {
      stubRequestUrlError(400, JSON.stringify({ message: "ValidationException: bad request" }));
      const model = createModel(false, "anthropic.claude-sonnet-4-5-20250929-v1:0");

      const messages = [{ content: "hi", getType: () => "human", type: "human" }];
      await expect(model._generate(messages as never, {})).rejects.toThrow(
        /Amazon Bedrock request failed with status 400/
      );
    });

    it("does not rewrite non-400 errors", async () => {
      stubRequestUrlError(500, JSON.stringify({ message: "Internal Server Error" }));
      const model = createModel(false, "anthropic.claude-sonnet-4-5-20250929-v1:0");

      const messages = [{ content: "hi", getType: () => "human", type: "human" }];
      await expect(model._generate(messages as never, {})).rejects.toThrow(
        /Amazon Bedrock request failed with status 500/
      );
    });

    it("rewrites the error even when AWS uses a curly apostrophe in 'isn’t supported'", async () => {
      stubRequestUrlError(
        400,
        JSON.stringify({
          message:
            "Invocation of model ID anthropic.claude-sonnet-4-5 with on-demand throughput isn’t supported. Retry your request with the ID or ARN of an inference profile that contains this model.",
        })
      );
      const model = createModel(false, "anthropic.claude-sonnet-4-5-20250929-v1:0");

      const messages = [{ content: "hi", getType: () => "human", type: "human" }];
      await expect(model._generate(messages as never, {})).rejects.toThrow(
        /cross-region inference profile ID/
      );
    });

    it("uses the provider segment from the bare model ID in the prefix guidance", async () => {
      stubRequestUrlError(
        400,
        JSON.stringify({
          message:
            "Invocation of model ID meta.llama4-maverick-17b with on-demand throughput isn't supported. Retry your request with the ID or ARN of an inference profile that contains this model.",
        })
      );
      const model = createModel(false, "anthropic.claude-sonnet-4-5-20250929-v1:0");

      const messages = [{ content: "hi", getType: () => "human", type: "human" }];
      await expect(model._generate(messages as never, {})).rejects.toThrow(/global\.meta\.<id>/);
    });
  });
});
