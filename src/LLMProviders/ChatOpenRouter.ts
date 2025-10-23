import { BaseChatModelParams } from "@langchain/core/language_models/chat_models";
import { AIMessageChunk } from "@langchain/core/messages";
import { ChatGenerationChunk } from "@langchain/core/outputs";
import { ChatOpenAI } from "@langchain/openai";
import OpenAI from "openai";

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
   * When true, requests will include `reasoning: { enabled: true }`
   */
  enableReasoning?: boolean;

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
  private openaiClient: OpenAI;

  constructor(fields: ChatOpenRouterInput) {
    const { enableReasoning = false, ...rest } = fields;

    // Pass all other parameters to ChatOpenAI
    super(rest);

    this.enableReasoning = enableReasoning;

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
      return {
        ...baseParams,
        reasoning: {
          max_tokens: 1024,
        },
      };
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

    // Convert LangChain messages to OpenAI format
    const openaiMessages = messages.map((msg) => {
      const role = msg._getType?.() || "user";
      return {
        role: role === "human" ? "user" : role === "ai" ? "assistant" : role,
        content: msg.content,
      };
    });

    // Call OpenAI SDK directly to get raw stream with reasoning_details
    // @ts-ignore - reasoning is OpenRouter-specific, not in OpenAI types
    const stream = await this.openaiClient.chat.completions.create({
      model: params.model,
      messages: openaiMessages,
      stream: true,
      temperature: params.temperature,
      max_tokens: params.max_tokens,
      top_p: params.top_p,
      frequency_penalty: params.frequency_penalty,
      reasoning: params.reasoning,
      stream_options: { include_usage: true },
    });

    for await (const rawChunk of stream) {
      const choice = rawChunk.choices?.[0];
      const delta = choice?.delta;

      // Extract reasoning_details from delta
      const reasoningDetails = (delta as any)?.reasoning_details;

      // Extract content
      const content = delta?.content || "";

      // Create LangChain-compatible chunk with reasoning_details in additional_kwargs
      const messageChunk = new AIMessageChunk({
        content,
        additional_kwargs: reasoningDetails ? { reasoning_details: reasoningDetails } : {},
        id: rawChunk.id,
      });

      const generationChunk = new ChatGenerationChunk({
        message: messageChunk,
        text: content,
      });

      yield generationChunk;
    }
  }
}
