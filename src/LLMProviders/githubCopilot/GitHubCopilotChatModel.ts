import { type BaseChatModelParams } from "@langchain/core/language_models/chat_models";
import type { BaseMessage, MessageContent } from "@langchain/core/messages";
import { AIMessageChunk } from "@langchain/core/messages";
import { ChatGenerationChunk } from "@langchain/core/outputs";
import { type CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import {
  ChatOpenAICompletions,
  convertCompletionsDeltaToBaseMessageChunk,
  convertMessagesToCompletionsMessageParams,
} from "@langchain/openai";
import { COPILOT_API_BASE, GitHubCopilotProvider } from "./GitHubCopilotProvider";
import { extractTextFromChunk } from "@/utils";
import type { FetchImplementation } from "@/utils";

// Approximate characters per token for English text
const CHARS_PER_TOKEN = 4;

/**
 * Normalize delta.content to a string.
 *
 * Reason: GitHub Copilot proxies multiple model families (Claude, GPT, etc.).
 * Claude models may return streaming delta.content as an array of content parts
 * (e.g., `[{type: "text", text: "..."}]`) instead of a plain string.
 * ChatOpenAICompletions' `_streamResponseChunks` skips chunks with non-string
 * content, causing all text to be silently dropped. This normalizer ensures
 * content is always a string before it reaches that check.
 */
function normalizeDeltaContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (content == null) return "";
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && typeof part.text === "string") {
          return part.text;
        }
        return "";
      })
      .join("");
  }
  if (typeof content === "object" && typeof (content as any).text === "string") {
    return (content as any).text;
  }
  return "";
}

export interface GitHubCopilotChatModelParams extends BaseChatModelParams {
  modelName: string;
  streaming?: boolean;
  /** Custom fetch implementation for CORS bypass (e.g., safeFetchNoThrow on mobile) */
  fetchImplementation?: FetchImplementation;
  // ChatOpenAI-compatible fields
  apiKey?: string;
  configuration?: Record<string, unknown>;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  maxRetries?: number;
  maxConcurrency?: number;
  [key: string]: any;
}

/**
 * GitHub Copilot ChatModel built on top of ChatOpenAICompletions.
 *
 * Reason: We extend ChatOpenAICompletions instead of ChatOpenAI because:
 * 1. ChatOpenAI routes between Completions API and Responses API internally.
 *    GitHub Copilot only supports the Chat Completions API endpoint.
 * 2. ChatOpenAICompletions provides `bindTools()` (via BaseChatOpenAI),
 *    `_streamResponseChunks`, and streaming infrastructure directly — no
 *    routing indirection.
 *
 * Authentication (dynamic Copilot token refresh) and Copilot-specific headers
 * are injected via `configuration.fetch` using GitHubCopilotProvider's lifecycle.
 */
export class GitHubCopilotChatModel extends ChatOpenAICompletions {
  lc_serializable = false;
  lc_namespace = ["langchain", "chat_models", "github_copilot"];

  /**
   * Build a fetch wrapper that injects a valid Copilot token and custom headers
   * on every request, with automatic 401 retry after token refresh.
   *
   * @param provider - GitHubCopilotProvider singleton for token management
   * @param baseFetch - Underlying fetch implementation (native or CORS-safe)
   * @returns A fetch-compatible function with Copilot auth injected
   */
  private static buildAuthedFetch(
    provider: GitHubCopilotProvider,
    baseFetch: FetchImplementation
  ): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
    return async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
      // Reason: FetchImplementation expects string, but OpenAI SDK may pass Request or URL
      const url =
        typeof input === "string" ? input : input instanceof Request ? input.url : input.toString();

      const doRequest = async (token: string): Promise<Response> => {
        const copilotHeaders = provider.buildCopilotRequestHeaders(token);
        const mergedHeaders = new Headers(init.headers);
        // Copilot headers take precedence (especially Authorization)
        for (const [key, value] of Object.entries(copilotHeaders)) {
          mergedHeaders.set(key, value);
        }

        return baseFetch(url, { ...init, headers: mergedHeaders });
      };

      let token = await provider.getValidCopilotToken();
      let response = await doRequest(token);

      // 401/403: invalidate cached token and retry once with a fresh one
      if (response.status === 401 || response.status === 403) {
        try {
          await response.body?.cancel();
        } catch {
          // Ignore cancellation errors — body may already be closed
        }
        provider.invalidateCopilotToken();
        token = await provider.getValidCopilotToken();
        response = await doRequest(token);
      }

      return response;
    };
  }

  /**
   * Create a Copilot-backed ChatOpenAICompletions instance.
   * Wires up dynamic token refresh and Copilot headers via a custom fetch wrapper.
   */
  constructor(fields: GitHubCopilotChatModelParams) {
    const { fetchImplementation, configuration, apiKey, ...rest } = fields;

    const provider = GitHubCopilotProvider.getInstance();
    const baseFetch = fetchImplementation ?? (configuration?.fetch as FetchImplementation) ?? fetch;
    const authedFetch = GitHubCopilotChatModel.buildAuthedFetch(provider, baseFetch);

    super({
      ...rest,
      // ChatOpenAICompletions requires an apiKey but Copilot tokens are dynamic;
      // real Authorization is injected in the fetch wrapper above.
      apiKey: apiKey || "copilot-dynamic-token",
      // Reason: Copilot API may not support stream_options.include_usage,
      // which ChatOpenAI sends by default. Disable to avoid potential 400 errors.
      streamUsage: false,
      configuration: {
        ...(configuration ?? {}),
        // Reason: OpenAI SDK appends "/chat/completions" to baseURL automatically
        baseURL: (configuration?.baseURL as string) ?? COPILOT_API_BASE,
        fetch: authedFetch,
      },
    });
  }

  /** LangChain model type identifier. */
  override _llmType(): string {
    return "github-copilot";
  }

  /**
   * Override streaming to fix two Copilot-specific issues with delta processing:
   *
   * 1. Missing role: Copilot API (especially when proxying Claude models) may omit
   *    `delta.role` from streaming chunks. The converter only creates AIMessageChunk
   *    (with tool_call_chunks) for role="assistant". Without it, chunks fall through
   *    to ChatMessageChunk which lacks tool_call_chunks, breaking Agent mode tool
   *    calling entirely.
   *
   * 2. Non-string content: Claude models may return delta.content as an array of
   *    content parts. The parent skips chunks where `typeof content !== "string"`,
   *    silently dropping all text.
   *
   * Reason: We override `_streamResponseChunks` instead of the deprecated
   * `_convertCompletionsDeltaToBaseMessageChunk` method. This uses the public
   * `convertCompletionsDeltaToBaseMessageChunk` function directly, which is the
   * officially supported API for delta conversion.
   *
   * Note: This method mirrors @langchain/openai@1.2.2
   * (dist/chat_models/completions.js:140-211) with two Copilot-specific patches.
   * Re-diff when upgrading @langchain/openai.
   */
  override async *_streamResponseChunks(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun
  ): AsyncGenerator<ChatGenerationChunk> {
    const messagesMapped = convertMessagesToCompletionsMessageParams({
      messages,
      model: this.model,
    });
    const params = {
      ...this.invocationParams(options, { streaming: true }),
      messages: messagesMapped,
      stream: true as const,
    };

    let defaultRole: string | undefined;
    const streamIterable = await this.completionWithRetry(params, options);
    let usage: any;

    for await (const data of streamIterable) {
      const choice = (data as any)?.choices?.[0];
      if ((data as any).usage) usage = (data as any).usage;
      if (!choice) continue;

      const { delta } = choice;
      if (!delta) continue;

      // Reason: Copilot API omits delta.role when proxying Claude models.
      // The converter uses `delta.role ?? defaultRole` to determine message type.
      // If both are undefined, it falls through to ChatMessageChunk (no tool_call_chunks).
      // Model responses are always from the assistant role, so defaulting here is safe.
      const effectiveRole = delta.role ?? defaultRole ?? "assistant";
      if (!delta.role) {
        delta.role = effectiveRole;
      }

      // Reason: Normalize content before conversion. Claude models may return
      // delta.content as an array of content parts which the converter doesn't handle.
      delta.content = normalizeDeltaContent(delta.content);

      const chunk = convertCompletionsDeltaToBaseMessageChunk({
        delta,
        rawResponse: data as any,
        includeRawResponse: (this as any).__includeRawResponse,
        defaultRole: effectiveRole as any,
      });
      defaultRole = delta.role ?? defaultRole;

      const newTokenIndices = {
        prompt: options.promptIndex ?? 0,
        completion: choice.index ?? 0,
      };

      if (typeof chunk.content !== "string") {
        continue;
      }

      const generationInfo: Record<string, any> = { ...newTokenIndices };
      if (choice.finish_reason != null) {
        generationInfo.finish_reason = choice.finish_reason;
        generationInfo.system_fingerprint = (data as any).system_fingerprint;
        generationInfo.model_name = (data as any).model;
        generationInfo.service_tier = (data as any).service_tier;
      }
      if (this.logprobs) generationInfo.logprobs = choice.logprobs;

      const generationChunk = new ChatGenerationChunk({
        message: chunk,
        text: chunk.content,
        generationInfo,
      });
      yield generationChunk;
      await runManager?.handleLLMNewToken(
        generationChunk.text ?? "",
        newTokenIndices,
        undefined,
        undefined,
        undefined,
        { chunk: generationChunk }
      );
    }

    // Yield usage metadata chunk if available
    if (usage) {
      const inputTokenDetails: Record<string, number> = {};
      if (usage.prompt_tokens_details?.audio_tokens != null) {
        inputTokenDetails.audio = usage.prompt_tokens_details.audio_tokens;
      }
      if (usage.prompt_tokens_details?.cached_tokens != null) {
        inputTokenDetails.cache_read = usage.prompt_tokens_details.cached_tokens;
      }
      const outputTokenDetails: Record<string, number> = {};
      if (usage.completion_tokens_details?.audio_tokens != null) {
        outputTokenDetails.audio = usage.completion_tokens_details.audio_tokens;
      }
      if (usage.completion_tokens_details?.reasoning_tokens != null) {
        outputTokenDetails.reasoning = usage.completion_tokens_details.reasoning_tokens;
      }
      const usageChunk = new ChatGenerationChunk({
        message: new AIMessageChunk({
          content: "",
          response_metadata: { usage: { ...usage } },
          usage_metadata: {
            input_tokens: usage.prompt_tokens,
            output_tokens: usage.completion_tokens,
            total_tokens: usage.total_tokens,
            ...(Object.keys(inputTokenDetails).length > 0 && {
              input_token_details: inputTokenDetails,
            }),
            ...(Object.keys(outputTokenDetails).length > 0 && {
              output_token_details: outputTokenDetails,
            }),
          },
        }),
        text: "",
      });
      yield usageChunk;
    }

    if (options.signal?.aborted) throw new Error("AbortError");
  }

  /**
   * Simple token estimation based on character count.
   * Kept as a safe fallback for direct usage outside ChatModelManager.
   */
  override async getNumTokens(content: MessageContent): Promise<number> {
    const text = extractTextFromChunk(content);
    if (!text) return 0;
    return Math.ceil(text.length / CHARS_PER_TOKEN);
  }
}
