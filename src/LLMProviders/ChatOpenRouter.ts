import { BaseChatModelParams } from "@langchain/core/language_models/chat_models";
import { AIMessage, AIMessageChunk, BaseMessage } from "@langchain/core/messages";
import type { UsageMetadata } from "@langchain/core/messages";
import { ChatGenerationChunk } from "@langchain/core/outputs";
import { ChatOpenAI } from "@langchain/openai";
import OpenAI from "openai";
import { logInfo } from "@/logger";

type OpenRouterChatChunk = OpenAI.ChatCompletionChunk;
type OpenRouterUsage = NonNullable<OpenRouterChatChunk["usage"]>;
type OpenRouterMessageParam = OpenAI.ChatCompletionMessageParam;

export interface ChatOpenRouterInput extends BaseChatModelParams {
  enableReasoning?: boolean;

  reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh";

  enablePromptCaching?: boolean;

  modelName?: string;
  apiKey?: string;
  configuration?: {
    baseURL?: string;
    defaultHeaders?: Record<string, string>;
    fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
    [key: string]: unknown;
  };
  maxTokens?: number;
  streaming?: boolean;
  maxRetries?: number;
  maxConcurrency?: number;
  [key: string]: unknown;
}

export class ChatOpenRouter extends ChatOpenAI {
  private enableReasoning: boolean;
  private reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh";
  private enablePromptCaching: boolean;
  private openaiClient: OpenAI;
  private isOpenRouter: boolean;

  constructor(fields: ChatOpenRouterInput) {
    const {
      enableReasoning = false,
      reasoningEffort,
      enablePromptCaching = true,
      ...rest
    } = fields;

    super(rest);

    this.enableReasoning = enableReasoning;
    this.reasoningEffort = reasoningEffort;
    this.enablePromptCaching = enablePromptCaching;

    const baseURL = fields.configuration?.baseURL || "https://openrouter.ai/api/v1";
    this.isOpenRouter = baseURL.includes("openrouter.ai");

    this.openaiClient = new OpenAI({
      apiKey: fields.apiKey,
      baseURL,
      defaultHeaders: fields.configuration?.defaultHeaders,
      fetch: fields.configuration?.fetch,
      dangerouslyAllowBrowser: true,
    });
  }

  override invocationParams(options?: this["ParsedCallOptions"]): Record<string, unknown> {
    const baseParams = super.invocationParams(options);

    const withCaching =
      this.isOpenRouter && this.enablePromptCaching
        ? { ...baseParams, cache_control: { type: "ephemeral" } }
        : baseParams;

    if (this.enableReasoning) {
      if (this.reasoningEffort) {
        const effort = this.reasoningEffort === "minimal" ? "low" : this.reasoningEffort;
        logInfo(`OpenRouter reasoning enabled with effort: ${effort}`);
        return {
          ...withCaching,
          reasoning: {
            effort,
          },
        };
      } else {
        logInfo(`OpenRouter reasoning enabled with max_tokens: 1024`);
        return {
          ...withCaching,
          // No top-level `max_tokens` next to `reasoning`: the gateway accepts a reasoning budget alone, and adding one caps every reasoning model.
          // https://github.com/logancyang/obsidian-copilot-preview/issues/312
          reasoning: {
            max_tokens: 1024,
          },
        };
      }
    }

    return withCaching;
  }

  override async *_streamResponseChunks(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    _runManager?: { handleLLMNewToken: (token: string) => Promise<void> }
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
    } as Parameters<
      typeof this.openaiClient.chat.completions.create
    >[0])) as unknown as AsyncIterable<OpenRouterChatChunk>;

    let usageSummary: OpenRouterUsage | undefined;

    for await (const rawChunk of stream) {
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
        delta: delta as unknown as Record<string, unknown>,
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

  private toOpenRouterMessages(messages: BaseMessage[]): OpenRouterMessageParam[] {
    return messages.map((msg) => {
      const msgRecord = msg as unknown as Record<string, unknown>;
      const role = BaseMessage.isInstance(msg) ? msg.type : ((msgRecord.role as string) ?? "user");
      const mappedRole =
        role === "human"
          ? "user"
          : role === "ai"
            ? "assistant"
            : (role as OpenAI.ChatCompletionRole);

      if (msgRecord.tool_call_id) {
        return {
          role: "tool",
          content: msg.content,
          tool_call_id: msgRecord.tool_call_id as string,
        } as OpenRouterMessageParam;
      }

      // AIMessage.tool_calls must be serialized to the OpenAI wire format, or the following "tool" messages violate the protocol.
      // https://github.com/logancyang/obsidian-copilot-preview/issues/300
      if (AIMessage.isInstance(msg) && msg.tool_calls && msg.tool_calls.length > 0) {
        return {
          role: "assistant",
          content: msg.content,
          tool_calls: msg.tool_calls.map((toolCall) => ({
            id: toolCall.id ?? "",
            type: "function" as const,
            function: {
              name: toolCall.name,
              arguments: JSON.stringify(toolCall.args ?? {}),
            },
          })),
        } as OpenRouterMessageParam;
      }

      return {
        role: mappedRole,
        content: msg.content,
      } as OpenRouterMessageParam;
    });
  }

  private buildMessageChunk(config: {
    rawChunk: OpenRouterChatChunk;
    delta: Record<string, unknown>;
    content: string;
    finishReason: string | null | undefined;
    reasoningText?: string;
    reasoningDetails?: unknown[];
  }): AIMessageChunk {
    const { rawChunk, delta, content, finishReason, reasoningText, reasoningDetails } = config;
    const toolCallChunks = this.extractToolCallChunks(delta.tool_calls);

    const additionalKwargs: Record<string, unknown> = {};

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

  private extractReasoningDetails(
    choice: OpenAI.ChatCompletionChunk.Choice
  ): unknown[] | undefined {
    const choiceRecord = choice as unknown as Record<string, Record<string, unknown>>;
    const candidate =
      choiceRecord?.delta?.reasoning_details ??
      choiceRecord?.message?.reasoning_details ??
      (choice as unknown as Record<string, unknown>)?.reasoning_details;

    if (!Array.isArray(candidate)) {
      return undefined;
    }

    return (candidate as unknown[]).filter((detail) => detail !== undefined && detail !== null);
  }

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
          if (
            part &&
            typeof part === "object" &&
            typeof (part as { text?: unknown }).text === "string"
          ) {
            return (part as { text: string }).text;
          }
          return "";
        })
        .join("");
    }

    return "";
  }

  private extractToolCallChunks(
    toolCalls: unknown
  ):
    | Array<{ name?: string; args?: string; id?: string; index?: number; type: "tool_call_chunk" }>
    | undefined {
    if (!Array.isArray(toolCalls)) {
      return undefined;
    }

    return toolCalls.map((rawCall) => {
      const call = rawCall as
        | { function?: { name?: string; arguments?: string }; id?: string; index?: number }
        | null
        | undefined;
      return {
        name: call?.function?.name,
        args: call?.function?.arguments,
        id: call?.id,
        index: call?.index,
        type: "tool_call_chunk" as const,
      };
    });
  }

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
