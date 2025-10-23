import { BaseChatModelParams } from "@langchain/core/language_models/chat_models";
import { AIMessageChunk } from "@langchain/core/messages";
import type { UsageMetadata } from "@langchain/core/messages";
import { ChatGenerationChunk } from "@langchain/core/outputs";
import { ChatOpenAI } from "@langchain/openai";
import OpenAI from "openai";
import { logInfo } from "@/logger";

type OpenRouterChatChunk = OpenAI.ChatCompletionChunk;
type OpenRouterUsage = NonNullable<OpenRouterChatChunk["usage"]>;
type OpenRouterMessageParam = OpenAI.ChatCompletionMessageParam;

/**
 * ChatOpenRouter extends ChatOpenAI to support OpenRouter-specific features,
 * particularly reasoning/thinking tokens.
 *
 * OpenRouter exposes thinking tokens via the `reasoning` request parameter
 * and responds with `reasoning_details` in both streaming and non-streaming modes.
 *
 * @see https://openrouter.ai/docs/use-cases/reasoning-tokens
 */
export interface ChatOpenRouterInput extends BaseChatModelParams {
  /**
   * Enable reasoning/thinking tokens from OpenRouter
   * When true, requests will include reasoning parameters
   */
  enableReasoning?: boolean;

  /**
   * Reasoning effort level: "minimal", "low", "medium", or "high"
   * Controls the amount of reasoning the model uses
   * Note: "minimal" will be treated as "low" for OpenRouter
   */
  reasoningEffort?: "minimal" | "low" | "medium" | "high";

  // All other ChatOpenAI parameters
  modelName?: string;
  apiKey?: string;
  configuration?: any;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  streaming?: boolean;
  maxRetries?: number;
  maxConcurrency?: number;
  [key: string]: any;
}

export class ChatOpenRouter extends ChatOpenAI {
  private enableReasoning: boolean;
  private reasoningEffort?: "minimal" | "low" | "medium" | "high";
  private openaiClient: OpenAI;

  constructor(fields: ChatOpenRouterInput) {
    const { enableReasoning = false, reasoningEffort, ...rest } = fields;

    // Pass all other parameters to ChatOpenAI
    super(rest);

    this.enableReasoning = enableReasoning;
    this.reasoningEffort = reasoningEffort;

    // Create our own OpenAI client for raw access
    this.openaiClient = new OpenAI({
      apiKey: fields.apiKey,
      baseURL: fields.configuration?.baseURL || "https://openrouter.ai/api/v1",
      defaultHeaders: fields.configuration?.defaultHeaders,
      fetch: fields.configuration?.fetch,
      dangerouslyAllowBrowser: true,
    });
  }

  /**
   * Override the invocation parameters to include reasoning when enabled
   */
  override invocationParams(options?: this["ParsedCallOptions"]): any {
    const baseParams = super.invocationParams(options);

    // Add reasoning parameter if enabled
    if (this.enableReasoning) {
      // Per OpenRouter docs:
      // - For Anthropic models: MUST use reasoning.max_tokens or reasoning.effort
      // - For other models: Can use reasoning.enabled
      // - max_tokens must be strictly higher than reasoning budget

      // Prefer effort if provided, otherwise fall back to max_tokens
      if (this.reasoningEffort) {
        // Map "minimal" to "low" since OpenRouter doesn't support "minimal"
        const effort = this.reasoningEffort === "minimal" ? "low" : this.reasoningEffort;
        logInfo(`OpenRouter reasoning enabled with effort: ${effort}`);
        return {
          ...baseParams,
          reasoning: {
            effort,
          },
        };
      } else {
        logInfo(`OpenRouter reasoning enabled with max_tokens: 1024`);
        return {
          ...baseParams,
          reasoning: {
            max_tokens: 1024,
          },
        };
      }
    }

    return baseParams;
  }

  /**
   * Override to use raw OpenAI SDK to access reasoning_details
   * LangChain filters out reasoning_details, so we bypass it completely
   */
  override async *_streamResponseChunks(
    messages: any[],
    options: this["ParsedCallOptions"],
    _runManager?: any
  ): AsyncGenerator<ChatGenerationChunk> {
    const params = this.invocationParams(options);
    const openaiMessages = this.toOpenRouterMessages(messages);

    const stream = (await this.openaiClient.chat.completions.create({
      ...params,
      messages: openaiMessages,
      stream: true,
      stream_options: {
        ...(params.stream_options ?? {}),
        include_usage: true,
      },
    })) as unknown as AsyncIterable<OpenRouterChatChunk>;

    let usageSummary: OpenRouterUsage | undefined;

    for await (const rawChunk of stream as AsyncIterable<OpenRouterChatChunk>) {
      if (rawChunk.usage) {
        usageSummary = rawChunk.usage;
      }

      const choice = rawChunk.choices?.[0];
      const delta = choice?.delta;
      if (!choice || !delta) {
        continue;
      }

      const reasoningText = this.normalizeReasoningChunk(
        (delta as Record<string, unknown>)?.reasoning
      );
      const reasoningDetails = this.extractReasoningDetails(choice);
      const content = this.extractDeltaContent(delta.content);

      const messageChunk = this.buildMessageChunk({
        rawChunk,
        delta,
        content,
        finishReason: choice.finish_reason,
        reasoningDetails,
        reasoningText,
      });

      const generationChunk = new ChatGenerationChunk({
        message: messageChunk,
        text: typeof messageChunk.content === "string" ? messageChunk.content : "",
        generationInfo: {
          finish_reason: choice.finish_reason,
          system_fingerprint: rawChunk.system_fingerprint,
          model: rawChunk.model,
        },
      });

      yield generationChunk;
      if (generationChunk.text) {
        await _runManager?.handleLLMNewToken(generationChunk.text);
      }
    }

    if (usageSummary) {
      yield this.buildUsageGenerationChunk(usageSummary);
    }

    if (options.signal?.aborted) {
      throw new Error("AbortError");
    }
  }

  /**
   * Convert LangChain messages to OpenRouter-ready messages.
   *
   * @param messages LangChain messages passed into the model
   * @returns Messages formatted for the OpenRouter API
   */
  private toOpenRouterMessages(messages: any[]): OpenRouterMessageParam[] {
    return messages.map((msg) => {
      const role = typeof msg._getType === "function" ? msg._getType() : (msg.role ?? "user");
      const mappedRole =
        role === "human"
          ? "user"
          : role === "ai"
            ? "assistant"
            : (role as OpenAI.ChatCompletionRole);

      if (msg.tool_call_id) {
        return {
          role: "tool",
          content: msg.content,
          tool_call_id: msg.tool_call_id,
        } as OpenRouterMessageParam;
      }

      if (msg.additional_kwargs?.function_call) {
        return {
          role: mappedRole,
          content: msg.content,
          function_call: msg.additional_kwargs.function_call,
        } as OpenRouterMessageParam;
      }

      return {
        role: mappedRole,
        content: msg.content,
      } as OpenRouterMessageParam;
    });
  }

  /**
   * Build an `AIMessageChunk` enriched with reasoning metadata.
   *
   * @param config Chunk configuration values extracted from the stream
   * @returns AI message chunk ready for downstream streaming utilities
   */
  private buildMessageChunk(config: {
    rawChunk: OpenRouterChatChunk;
    delta: Record<string, any>;
    content: string;
    finishReason: string | null | undefined;
    reasoningText?: string;
    reasoningDetails?: unknown[];
  }): AIMessageChunk {
    const { rawChunk, delta, content, finishReason, reasoningText, reasoningDetails } = config;
    const toolCallChunks = this.extractToolCallChunks(delta.tool_calls);

    const additionalKwargs: Record<string, unknown> = {};

    if (delta.function_call) {
      additionalKwargs.function_call = delta.function_call;
    }

    if (Array.isArray(delta.tool_calls)) {
      additionalKwargs.tool_calls = delta.tool_calls;
    }

    const deltaPayload: Record<string, unknown> = {};
    if (reasoningText) {
      deltaPayload.reasoning = reasoningText;
    }
    if (reasoningDetails && reasoningDetails.length > 0) {
      deltaPayload.reasoning_details = reasoningDetails;
    }

    if (Object.keys(deltaPayload).length > 0) {
      additionalKwargs.delta = {
        ...(additionalKwargs.delta as Record<string, unknown>),
        ...deltaPayload,
      };
    }

    if (reasoningDetails && reasoningDetails.length > 0) {
      additionalKwargs.reasoning_details = reasoningDetails;
    }

    const responseMetadata = this.buildResponseMetadata(rawChunk, finishReason);

    return new AIMessageChunk({
      content,
      additional_kwargs: additionalKwargs,
      tool_call_chunks: toolCallChunks,
      response_metadata: responseMetadata,
      id: rawChunk.id,
    });
  }

  /**
   * Normalize streamed reasoning payloads into plain text for the UI.
   *
   * @param reasoning Arbitrary reasoning payload returned by OpenRouter
   * @returns Normalized reasoning text or undefined
   */
  private normalizeReasoningChunk(reasoning: unknown): string | undefined {
    if (!reasoning) {
      return undefined;
    }

    if (typeof reasoning === "string") {
      return reasoning;
    }

    if (Array.isArray(reasoning)) {
      return reasoning
        .map((item) => this.normalizeReasoningChunk(item))
        .filter((item): item is string => Boolean(item))
        .join("");
    }

    if (typeof reasoning === "object") {
      const record = reasoning as Record<string, unknown>;
      const candidates = [
        record.output_text,
        record.text,
        record.reasoning,
        record.thinking,
        record.content,
      ];

      const normalized = candidates.find((value) => typeof value === "string");
      if (typeof normalized === "string") {
        return normalized;
      }
    }

    return undefined;
  }

  /**
   * Extract reasoning details arrays from the streamed choice payload.
   *
   * @param choice Chunk choice object from the OpenRouter stream
   * @returns Array of reasoning detail entries, if present
   */
  private extractReasoningDetails(choice: any): unknown[] | undefined {
    const candidate =
      choice?.delta?.reasoning_details ??
      choice?.message?.reasoning_details ??
      choice?.reasoning_details;

    if (!Array.isArray(candidate)) {
      return undefined;
    }

    return candidate.filter((detail) => detail !== undefined && detail !== null);
  }

  /**
   * Flatten OpenRouter delta content into a single text string.
   *
   * @param content Delta content payload
   * @returns Text representation for downstream streaming
   */
  private extractDeltaContent(content: unknown): string {
    if (typeof content === "string") {
      return content;
    }

    if (Array.isArray(content)) {
      return content
        .map((part) => {
          if (typeof part === "string") {
            return part;
          }
          if (part && typeof part === "object" && typeof part.text === "string") {
            return part.text;
          }
          return "";
        })
        .join("");
    }

    return "";
  }

  /**
   * Map raw OpenRouter tool call deltas into LangChain tool call chunks.
   *
   * @param toolCalls Tool call deltas returned by OpenRouter
   * @returns Tool call chunk array compatible with LangChain
   */
  private extractToolCallChunks(
    toolCalls: any
  ):
    | Array<{ name?: string; args?: string; id?: string; index?: number; type: "tool_call_chunk" }>
    | undefined {
    if (!Array.isArray(toolCalls)) {
      return undefined;
    }

    return toolCalls.map((call) => ({
      name: call?.function?.name,
      args: call?.function?.arguments,
      id: call?.id,
      index: call?.index,
      type: "tool_call_chunk" as const,
    }));
  }

  /**
   * Build response metadata payload with finish reason and usage info.
   *
   * @param rawChunk Raw streaming chunk from OpenRouter
   * @param finishReason Stop reason reported by the model
   * @returns Metadata object attached to each AI message chunk
   */
  private buildResponseMetadata(
    rawChunk: OpenRouterChatChunk,
    finishReason: string | null | undefined
  ): Record<string, unknown> {
    const metadata: Record<string, unknown> = {
      model_provider: "openrouter",
    };

    if (finishReason) {
      metadata.finish_reason = finishReason;
    }

    if (rawChunk.model) {
      metadata.model = rawChunk.model;
    }

    if (rawChunk.system_fingerprint) {
      metadata.system_fingerprint = rawChunk.system_fingerprint;
    }

    if (rawChunk.usage) {
      metadata.usage = { ...rawChunk.usage };
      metadata.tokenUsage = {
        promptTokens: rawChunk.usage.prompt_tokens,
        completionTokens: rawChunk.usage.completion_tokens,
        totalTokens: rawChunk.usage.total_tokens,
      };
    }

    return metadata;
  }

  /**
   * Create a terminal usage chunk so downstream consumers can capture token usage.
   *
   * @param usage Usage payload returned by the streaming API
   * @returns Chat generation chunk containing usage metadata
   */
  private buildUsageGenerationChunk(usage: OpenRouterUsage): ChatGenerationChunk {
    const inputTokenDetails: Record<string, number> = {};
    const outputTokenDetails: Record<string, number> = {};

    const promptDetails = usage.prompt_tokens_details ?? {};
    if (typeof promptDetails.audio_tokens === "number") {
      inputTokenDetails.audio = promptDetails.audio_tokens;
    }
    if (typeof promptDetails.cached_tokens === "number") {
      inputTokenDetails.cache_read = promptDetails.cached_tokens;
    }

    const completionDetails = usage.completion_tokens_details ?? {};
    if (typeof completionDetails.audio_tokens === "number") {
      outputTokenDetails.audio = completionDetails.audio_tokens;
    }
    if (typeof completionDetails.reasoning_tokens === "number") {
      outputTokenDetails.reasoning = completionDetails.reasoning_tokens;
    }

    const usageMetadata: UsageMetadata = {
      input_tokens: usage.prompt_tokens ?? 0,
      output_tokens: usage.completion_tokens ?? 0,
      total_tokens: usage.total_tokens ?? 0,
    };

    if (Object.keys(inputTokenDetails).length > 0) {
      usageMetadata.input_token_details = inputTokenDetails;
    }

    if (Object.keys(outputTokenDetails).length > 0) {
      usageMetadata.output_token_details = outputTokenDetails;
    }

    const messageChunk = new AIMessageChunk({
      content: "",
      response_metadata: { usage: { ...usage } },
      usage_metadata: usageMetadata,
    });

    return new ChatGenerationChunk({
      message: messageChunk,
      text: "",
    });
  }
}
