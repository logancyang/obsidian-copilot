import {
  BaseChatModel,
  type BaseChatModelCallOptions,
  type BaseChatModelParams,
} from "@langchain/core/language_models/chat_models";
import { logInfo, logError } from "@/logger";
import type { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import { AIMessage, ToolMessage } from "@langchain/core/messages";
import type { BaseMessage, UsageMetadata } from "@langchain/core/messages";
import type { ChatGeneration, ChatResult } from "@langchain/core/outputs";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { isInteropZodSchema } from "@langchain/core/utils/types";
import { toJsonSchema } from "@langchain/core/utils/json_schema";
import { safeFetchNoThrow } from "@/utils";

export interface BedrockChatModelCallOptions extends BaseChatModelCallOptions {
  maxTokens?: number;
  temperature?: number;
  topP?: number;
}

export interface BedrockChatModelFields extends BaseChatModelParams {
  modelId: string;
  modelName?: string; // Passed to BaseChatModel via baseParams
  apiKey: string;
  endpoint: string;
  defaultMaxTokens?: number;
  defaultTemperature?: number;
  defaultTopP?: number;
  anthropicVersion?: string;
  enableThinking?: boolean; // Enable extended thinking mode (requires REASONING capability)
}

/**
 * Rewrites Bedrock HTTP error messages into actionable text when possible.
 * Falls back to the original "Amazon Bedrock ... failed with status N: body" form.
 *
 * The detection uses two stable substrings from the AWS ValidationException body
 * ("on-demand throughput" and "inference profile") rather than the apostrophe-bearing
 * phrase "isn't supported", because AWS has been observed serving both straight (')
 * and curly (’) apostrophe variants. False positives are harmless: the rewritten
 * message still names the bare model ID from the original body.
 */
function rewriteBedrockErrorMessage(status: number, body: string): string {
  const prefix = "Amazon Bedrock request failed with status";

  if (
    status === 400 &&
    body.includes("on-demand throughput") &&
    body.includes("inference profile")
  ) {
    const modelIdMatch = body.match(/model ID ([^\s]+) with/);
    const bareId = modelIdMatch?.[1] ?? "<model-id>";
    // Provider segment of the model ID (e.g. "anthropic" from "anthropic.claude-...").
    // Falls back to a generic placeholder when the ID isn't in <provider>.<model> form.
    const providerSegment = bareId.includes(".") ? bareId.split(".")[0] : "<provider>";
    return (
      `This Bedrock model requires a cross-region inference profile ID, not a bare regional model ID. ` +
      `Update the model name in Settings → Models to use one of the prefixed forms: ` +
      `global.${providerSegment}.<id> (recommended), us.${providerSegment}.<id>, eu.${providerSegment}.<id>, or apac.${providerSegment}.<id>. ` +
      `The current value "${bareId}" is not accepted by AWS on-demand throughput.`
    );
  }

  return `${prefix} ${status}: ${body}`;
}

/**
 * Lightweight ChatModel integration for Amazon Bedrock using a simple API key header.
 * This implementation issues JSON requests against the public Bedrock runtime endpoint.
 */
export class BedrockChatModel extends BaseChatModel<BedrockChatModelCallOptions> {
  private readonly apiKey: string;
  private readonly endpoint: string;
  private readonly defaultMaxTokens?: number;
  private readonly defaultTemperature?: number;
  private readonly defaultTopP?: number;
  private readonly anthropicVersion?: string;
  private readonly enableThinking: boolean;

  // Public modelName property for LangChain capability detection
  public readonly modelName: string;

  // Tools bound via bindTools() for native tool calling
  private boundTools?: StructuredToolInterface[];

  constructor(fields: BedrockChatModelFields) {
    const {
      modelId,
      apiKey,
      endpoint,
      defaultMaxTokens,
      defaultTemperature,
      defaultTopP,
      anthropicVersion,
      enableThinking,
      ...baseParams
    } = fields;

    if (!modelId) {
      throw new Error("Amazon Bedrock model identifier is required.");
    }
    if (!apiKey) {
      throw new Error("Amazon Bedrock API key is required.");
    }
    if (!endpoint) {
      throw new Error("Amazon Bedrock endpoint is required.");
    }

    super(baseParams);

    // Store modelId as modelName for capability detection
    // This allows CopilotPlusChainRunner.hasCapability() to find the model configuration
    this.modelName = modelId;
    this.apiKey = apiKey;
    this.endpoint = endpoint;
    this.defaultMaxTokens = defaultMaxTokens;
    this.defaultTemperature = defaultTemperature;
    this.defaultTopP = defaultTopP;
    this.anthropicVersion = anthropicVersion;
    this.enableThinking = enableThinking ?? false;
  }

  _llmType(): string {
    return "amazon-bedrock";
  }

  /**
   * Bind tools to this model for native tool calling.
   * Returns a new instance with tools bound.
   */
  bindTools(tools: StructuredToolInterface[]): BedrockChatModel {
    const bound = Object.create(this) as BedrockChatModel;
    bound.boundTools = tools;
    return bound;
  }

  /**
   * Convert LangChain tools to Claude's tool format for Bedrock.
   */
  private convertToolsToClaude(tools: StructuredToolInterface[]): Array<{
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
  }> {
    return tools.map((tool) => {
      let inputSchema: Record<string, unknown> = { type: "object", properties: {} };
      if (tool.schema) {
        inputSchema = isInteropZodSchema(tool.schema) ? toJsonSchema(tool.schema) : tool.schema;
      }
      return {
        name: tool.name,
        description: tool.description || "",
        input_schema: inputSchema,
      };
    });
  }

  /**
   * Extract tool calls from Claude's response format.
   */
  private extractToolCalls(
    data: unknown
  ):
    | Array<{ id: string; name: string; args: Record<string, unknown>; type: "tool_call" }>
    | undefined {
    const dataObj = data as Record<string, unknown> | null | undefined;
    if (!Array.isArray(dataObj?.content)) return undefined;

    const toolUseBlocks = (dataObj.content as Record<string, unknown>[]).filter(
      (block) => block.type === "tool_use"
    );

    if (toolUseBlocks.length === 0) return undefined;

    return toolUseBlocks.map((block) => ({
      id: block.id as string,
      name: block.name as string,
      args: (block.input || {}) as Record<string, unknown>,
      type: "tool_call" as const,
    }));
  }

  async _generate(
    messages: BaseMessage[],
    options?: BedrockChatModelCallOptions,
    runManager?: CallbackManagerForLLMRun
  ): Promise<ChatResult> {
    const requestBody = this.buildRequestBody(messages, options);

    const response = await safeFetchNoThrow(this.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(rewriteBedrockErrorMessage(response.status, errorText));
    }

    const data = (await response.json()) as Record<string, unknown>;
    const text = this.extractText(data);
    const toolCalls = this.extractToolCalls(data);

    if (runManager && text) {
      await runManager.handleLLMNewToken(text);
    }

    const usage = this.extractUsage(data);
    const usageMetadata = usage ? this.normaliseUsageMetadata(usage) : undefined;

    const responseMetadata = {
      stopReason: data.stop_reason ?? data.stopReason,
      usage,
      rawResponse: data,
    };

    const aiMessage = new AIMessage({
      content: text,
      response_metadata: responseMetadata,
      usage_metadata: usageMetadata,
      tool_calls: toolCalls,
    });

    const generation: ChatGeneration = {
      message: aiMessage,
      text,
      generationInfo: responseMetadata,
    };

    return {
      generations: [generation],
      llmOutput: responseMetadata,
    };
  }

  private extractUsage(event: Record<string, unknown>): Record<string, unknown> | undefined {
    if (!event || typeof event !== "object") {
      return undefined;
    }

    if (event.usage && typeof event.usage === "object") {
      return event.usage as Record<string, unknown>;
    }

    if (event.metrics && typeof event.metrics === "object") {
      return event.metrics as Record<string, unknown>;
    }

    // Bedrock-specific invocation metrics
    if (
      event["amazon-bedrock-invocationMetrics"] &&
      typeof event["amazon-bedrock-invocationMetrics"] === "object"
    ) {
      return event["amazon-bedrock-invocationMetrics"] as Record<string, unknown>;
    }

    if (event.messageStop && typeof event.messageStop === "object") {
      return this.extractUsage(event.messageStop as Record<string, unknown>);
    }

    if (event.message_stop && typeof event.message_stop === "object") {
      return this.extractUsage(event.message_stop as Record<string, unknown>);
    }

    return undefined;
  }

  private normaliseUsageMetadata(usage: Record<string, unknown>): UsageMetadata {
    const inputTokens =
      this.coerceNumber(usage.inputTokens) ??
      this.coerceNumber(usage.input_tokens) ??
      this.coerceNumber(usage.inputTokenCount) ?? // Bedrock-specific
      this.coerceNumber(usage.promptTokens) ??
      this.coerceNumber(usage.prompt_tokens) ??
      0;

    const outputTokens =
      this.coerceNumber(usage.outputTokens) ??
      this.coerceNumber(usage.output_tokens) ??
      this.coerceNumber(usage.outputTokenCount) ?? // Bedrock-specific
      this.coerceNumber(usage.completionTokens) ??
      this.coerceNumber(usage.completion_tokens) ??
      0;

    const totalTokens =
      this.coerceNumber(usage.totalTokens) ??
      this.coerceNumber(usage.total_tokens) ??
      inputTokens + outputTokens;

    const metadata: UsageMetadata = {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: totalTokens,
    };

    return metadata;
  }

  private coerceNumber(value: unknown): number | undefined {
    if (typeof value === "number") {
      return value;
    }

    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : undefined;
    }

    return undefined;
  }

  /**
   * Convert OpenAI image format to Claude's Messages API format
   * @param imageUrl The image URL (data URL with base64)
   * @returns Claude-formatted image content block or null if invalid
   */
  private convertImageContent(imageUrl: string): {
    type: "image";
    source: { type: "base64"; media_type: string; data: string };
  } | null {
    try {
      // Parse data URL format: data:image/jpeg;base64,<base64-string>
      const dataUrlMatch = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (!dataUrlMatch) {
        return null;
      }

      const [, mediaType, base64Data] = dataUrlMatch;
      if (!mediaType || !base64Data) {
        return null;
      }

      // Validate it's an image media type
      if (!mediaType.startsWith("image/")) {
        return null;
      }

      return {
        type: "image",
        source: {
          type: "base64",
          media_type: mediaType,
          data: base64Data,
        },
      };
    } catch (error) {
      logError("Error converting image content:", error);
      return null;
    }
  }

  private buildRequestBody(
    messages: BaseMessage[],
    options?: BedrockChatModelCallOptions
  ): Record<string, unknown> {
    type ContentBlock =
      | { type: "text"; text: string }
      | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
      | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
      | { type: "tool_result"; tool_use_id: string; content: string };

    const conversation: Array<{
      role: "assistant" | "user";
      content: ContentBlock[];
    }> = [];
    const systemPrompts: string[] = [];

    messages.forEach((message) => {
      const messageType = message.type;

      // Handle system messages (always text-only)
      if (messageType === "system") {
        const content = this.normaliseMessageContent(message);
        const textContent = typeof content === "string" ? content : "";
        if (textContent) {
          systemPrompts.push(textContent);
        }
        return;
      }

      // Handle ToolMessage (tool results) - becomes user message with tool_result
      if (messageType === "tool") {
        const toolMessage = message as ToolMessage;
        const toolResultContent =
          typeof toolMessage.content === "string"
            ? toolMessage.content
            : JSON.stringify(toolMessage.content);
        conversation.push({
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: toolMessage.tool_call_id,
              content: toolResultContent,
            },
          ],
        });
        return;
      }

      // Handle AIMessage with tool_calls - becomes assistant message with tool_use
      if (messageType === "ai") {
        const aiMessage = message as AIMessage;
        const toolCalls = aiMessage.tool_calls;

        if (toolCalls && toolCalls.length > 0) {
          const contentBlocks: ContentBlock[] = [];

          // Add text content if present
          const textContent = this.normaliseMessageContent(message);
          if (typeof textContent === "string" && textContent) {
            contentBlocks.push({ type: "text", text: textContent });
          }

          // Add tool_use blocks for each tool call
          for (const tc of toolCalls) {
            contentBlocks.push({
              type: "tool_use",
              id: tc.id || `tool_${Date.now()}`,
              name: tc.name,
              input: tc.args as Record<string, unknown>,
            });
          }

          if (contentBlocks.length > 0) {
            conversation.push({
              role: "assistant",
              content: contentBlocks,
            });
          }
          return;
        }
      }

      // Standard message processing
      const content = this.normaliseMessageContent(message);
      if (!content) {
        return;
      }

      // Process content blocks
      const contentBlocks: ContentBlock[] = [];

      if (typeof content === "string") {
        // Simple text message
        contentBlocks.push({
          type: "text",
          text: content,
        });
      } else if (Array.isArray(content)) {
        // Multimodal message with text and/or images
        for (const block of content) {
          if (block.type === "text" && typeof block.text === "string") {
            // Text block
            contentBlocks.push({
              type: "text",
              text: block.text,
            });
          } else if (
            block.type === "image_url" &&
            (block.image_url as Record<string, unknown> | undefined)?.url
          ) {
            // Image block in OpenAI format - convert to Claude format
            const imageUrlBlock = block.image_url as Record<string, unknown>;
            const claudeImage = this.convertImageContent(imageUrlBlock.url as string);
            if (claudeImage) {
              contentBlocks.push(claudeImage);
            }
          } else if (block.type === "image" && block.source) {
            // Already in Claude format
            contentBlocks.push(block as ContentBlock);
          }
        }
      }

      // Only add message if it has content blocks
      if (contentBlocks.length > 0) {
        conversation.push({
          role: messageType === "ai" ? "assistant" : "user",
          content: contentBlocks,
        });
      }
    });

    const resolvedMaxTokens = options?.maxTokens ?? this.defaultMaxTokens;
    const resolvedTemperature = options?.temperature ?? this.defaultTemperature;
    const resolvedTopP = options?.topP ?? this.defaultTopP;

    const payload: Record<string, unknown> = {
      messages: conversation,
    };

    // Add tools if bound
    if (this.boundTools && this.boundTools.length > 0) {
      payload.tools = this.convertToolsToClaude(this.boundTools);
    }

    if (systemPrompts.length > 0) {
      payload.system = systemPrompts.join("\n\n");
    }
    if (resolvedMaxTokens !== undefined) {
      payload.max_tokens = resolvedMaxTokens;
    }

    // Always set anthropic_version when available (required for all Claude requests on Bedrock)
    if (this.anthropicVersion) {
      payload.anthropic_version = this.anthropicVersion;
    }

    // Handle thinking mode for Claude models
    // Only enable if user has explicitly enabled REASONING capability for this model
    if (this.enableThinking) {
      // claude-opus-4-7+ rejects { type: "enabled", budget_tokens } with a 400 and requires
      // { type: "adaptive" }. Unanchored match because Bedrock IDs include provider/profile
      // prefixes (e.g. "global.anthropic.claude-opus-4-7-20260115-v1:0"). Constrain the minor
      // to 1-2 digits followed by a delimiter so dated snapshot IDs like
      // "claude-opus-4-20250514-v1:0" aren't misread as Opus 4.20250514.
      const opusMinorMatch = this.modelName.match(/claude-opus-4-(\d{1,2})(?:[-.]|$)/);
      const usesAdaptiveThinking = opusMinorMatch ? parseInt(opusMinorMatch[1], 10) >= 7 : false;
      // Opus 4.7+ defaults thinking.display to "omitted" so thinking summaries
      // never reach the UI; force "summarized" for the adaptive branch. Pre-4.7
      // models default to "summarized" server-side.
      payload.thinking = usesAdaptiveThinking
        ? { type: "adaptive", display: "summarized" }
        : { type: "enabled", budget_tokens: 2048 };
      // When thinking is enabled, temperature must be 1
      // https://docs.claude.com/en/docs/build-with-claude/extended-thinking#important-considerations-when-using-extended-thinking
      payload.temperature = 1;
      logInfo("[BedrockChatModel] Enabled thinking mode for Claude model with temperature=1");
    } else {
      // Only set temperature if thinking is NOT enabled
      if (resolvedTemperature !== undefined) {
        payload.temperature = resolvedTemperature;
      }
    }

    if (resolvedTopP !== undefined) {
      payload.top_p = resolvedTopP;
    }

    return payload;
  }

  /**
   * Normalize message content, preserving multimodal content (text + images)
   * @param message The BaseMessage to normalize
   * @returns Either a string (text-only) or an array of content blocks (multimodal)
   */
  private normaliseMessageContent(
    message: BaseMessage
  ): string | Array<{ type: string; [key: string]: unknown }> {
    const { content } = message;

    // Handle string content (simple text message)
    if (typeof content === "string") {
      return content;
    }

    // Handle array content (potentially multimodal with text and images)
    if (Array.isArray(content)) {
      // Check if this is multimodal content with images
      const hasImages = content.some(
        (part) =>
          typeof part === "object" &&
          part !== null &&
          (part.type === "image_url" || part.type === "image")
      );

      // If it has images, preserve the array structure for multimodal processing
      if (hasImages) {
        return content
          .map((part) => {
            if (typeof part === "string") {
              return { type: "text", text: part };
            }
            if (typeof part === "object" && part !== null) {
              // Already structured content (text or image)
              if (part.type === "text" || part.type === "image_url" || part.type === "image") {
                return part;
              }
              // Try to extract text from other formats
              if ("text" in part && typeof part.text === "string") {
                return { type: "text", text: part.text };
              }
              if ("content" in part && typeof part.content === "string") {
                return { type: "text", text: part.content };
              }
            }
            return null;
          })
          .filter((part): part is { type: string; [key: string]: unknown } => part !== null);
      }

      // No images, flatten to string
      return content
        .map((part) => {
          if (typeof part === "string") {
            return part;
          }
          if (typeof part === "object" && part !== null) {
            if ("text" in part && typeof part.text === "string") {
              return part.text;
            }
            if ("content" in part && typeof part.content === "string") {
              return part.content;
            }
          }
          return "";
        })
        .join("");
    }

    // Handle object content with text property
    if (typeof content === "object" && content !== null && "text" in content) {
      const textContent = (content as { text?: string }).text;
      return textContent ?? "";
    }

    return "";
  }

  private extractText(data: Record<string, unknown>): string {
    if (typeof data?.outputText === "string") {
      return data.outputText;
    }

    if (Array.isArray(data?.content)) {
      return (data.content as unknown[])
        .map((item: unknown): string => {
          if (!item) return "";
          if (typeof item === "string") return item;
          if (typeof item === "object") {
            const itemObj = item as Record<string, unknown>;
            if (typeof itemObj.text === "string") return itemObj.text;
            if (itemObj.text && typeof itemObj.text === "object" && "text" in itemObj.text) {
              return ((itemObj.text as Record<string, unknown>).text as string | undefined) ?? "";
            }
          }
          return "";
        })
        .join("");
    }

    if (typeof data?.completion === "string") {
      return data.completion;
    }

    if (typeof data?.resultText === "string") {
      return data.resultText;
    }

    return "";
  }
}
