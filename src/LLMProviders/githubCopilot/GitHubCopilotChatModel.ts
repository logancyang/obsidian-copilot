import type { BaseMessageChunk, MessageContent } from "@langchain/core/messages";
import { ChatOpenAICompletions } from "@langchain/openai";
import { COPILOT_API_BASE, GitHubCopilotProvider } from "./GitHubCopilotProvider";
import type { FetchImplementation } from "@/utils";
import { extractTextFromChunk } from "@/utils";

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

/** Extract the constructor fields type from ChatOpenAICompletions. */
type ChatOpenAICompletionsFields = NonNullable<
  ConstructorParameters<typeof ChatOpenAICompletions>[0]
>;

/**
 * Constructor params for GitHubCopilotChatModel.
 * Inherits all ChatOpenAICompletions fields (temperature, maxTokens, etc.)
 * and adds Copilot-specific options.
 */
export type GitHubCopilotChatModelParams = ChatOpenAICompletionsFields & {
  /** Custom fetch implementation for CORS bypass (e.g., safeFetchNoThrow on mobile) */
  fetchImplementation?: FetchImplementation;
};

/**
 * GitHub Copilot ChatModel built on top of ChatOpenAICompletions.
 *
 * Reason: We extend ChatOpenAICompletions instead of ChatOpenAI because:
 * 1. ChatOpenAI routes between Completions API and Responses API internally.
 *    GitHub Copilot only supports the Chat Completions API endpoint.
 * 2. ChatOpenAICompletions provides `bindTools()` (via BaseChatOpenAI),
 *    `_streamResponseChunks`, and `_convertCompletionsDeltaToBaseMessageChunk`
 *    directly — no routing indirection.
 * 3. `_convertCompletionsDeltaToBaseMessageChunk` is directly overridable,
 *    allowing us to normalize non-string content from Claude models.
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
      // Reason: OpenAI SDK v6 always calls fetch(urlString, init), so we only need
      // to handle string and URL inputs. Request objects are not used by the SDK,
      // but we extract the URL defensively to avoid silent failures.
      // Note: If a future SDK version passes Request objects, this wrapper would
      // need to clone the Request to preserve method/body/headers and support retry.
      // Reason: Guard `typeof Request` to avoid ReferenceError in environments
      // where the Request global may not exist (e.g., some Obsidian mobile runtimes).
      const url =
        typeof input === "string"
          ? input
          : typeof Request !== "undefined" && input instanceof Request
            ? input.url
            : input.toString();

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

      // 401: invalidate cached token and retry once with a fresh one.
      // Reason: Only retry on 401 (Unauthorized / expired token). 403 means
      // "Forbidden" (e.g., no Copilot subscription) — a permanent condition
      // where token refresh won't help. This matches GitHubCopilotProvider's
      // own retry logic which also limits retries to 401.
      if (response.status === 401) {
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
   * Override delta-to-chunk conversion to fix two Copilot-specific issues:
   *
   * 1. Missing role: Copilot API (especially when proxying Claude models) may omit
   *    `delta.role` from streaming chunks. The parent converter only creates
   *    AIMessageChunk (with tool_call_chunks) for role="assistant". Without it,
   *    chunks fall through to ChatMessageChunk which lacks tool_call_chunks,
   *    breaking Agent mode tool calling entirely.
   *
   * 2. Non-string content: Claude models may return delta.content as an array of
   *    content parts. The parent's _streamResponseChunks skips chunks where
   *    `typeof content !== "string"`, silently dropping all text.
   */
  protected override _convertCompletionsDeltaToBaseMessageChunk(
    delta: Record<string, any>,
    rawResponse: any,
    // Reason: Parent expects OpenAI's ChatCompletionRole type, but we accept any string
    // to avoid coupling to the exact OpenAI SDK type. Cast is safe because we pass through.
    defaultRole?: any
  ): BaseMessageChunk {
    // Reason: Copilot API omits delta.role when proxying Claude models.
    // The parent converter uses `delta.role ?? defaultRole` to determine message type.
    // If both are undefined, it falls through to ChatMessageChunk (no tool_call_chunks).
    // Model responses are always from the assistant role, so defaulting here is safe.
    // We set defaultRole instead of mutating delta.role to avoid modifying transport objects.
    if (!delta.role && !defaultRole) {
      defaultRole = "assistant";
    }

    // Reason: Mutate delta.content in place instead of spreading.
    // OpenAI SDK's delta objects may have non-enumerable properties (e.g., tool_calls)
    // that would be lost by `{ ...delta }` spread. Direct mutation is safe because
    // each delta is a single-use streaming chunk.
    delta.content = normalizeDeltaContent(delta.content);

    return super._convertCompletionsDeltaToBaseMessageChunk(delta, rawResponse, defaultRole);
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
