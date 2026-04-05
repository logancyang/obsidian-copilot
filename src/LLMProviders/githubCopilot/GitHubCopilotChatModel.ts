import type { BaseMessageChunk, MessageContent } from "@langchain/core/messages";
import { ChatOpenAICompletions } from "@langchain/openai";
import { COPILOT_API_BASE, GitHubCopilotProvider } from "./GitHubCopilotProvider";
import { buildGitHubCopilotAuthedFetch } from "./GitHubCopilotResponsesModel";
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
 * @param content - Raw delta content from the transport layer.
 * @returns Normalized plain-text content.
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
 * This class is kept for Copilot models that still speak the Chat Completions API.
 * Codex models are routed separately through GitHubCopilotResponsesModel.
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
   * @param provider - GitHubCopilotProvider singleton for token management.
   * @param baseFetch - Underlying fetch implementation (native or CORS-safe).
   * @returns A fetch-compatible function with Copilot auth injected.
   */
  private static buildAuthedFetch(
    provider: GitHubCopilotProvider,
    baseFetch: FetchImplementation
  ): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
    return buildGitHubCopilotAuthedFetch(provider, baseFetch);
  }

  /**
   * Create a Copilot-backed ChatOpenAICompletions instance.
   * Wires up dynamic token refresh and Copilot headers via a custom fetch wrapper.
   * @param fields - LangChain/OpenAI constructor fields with Copilot fetch options.
   */
  constructor(fields: GitHubCopilotChatModelParams) {
    const { fetchImplementation, configuration, apiKey, ...rest } = fields;

    const provider = GitHubCopilotProvider.getInstance();
    const baseFetch = fetchImplementation ?? (configuration?.fetch as FetchImplementation) ?? fetch;
    const authedFetch = GitHubCopilotChatModel.buildAuthedFetch(provider, baseFetch);

    super({
      ...rest,
      apiKey: apiKey || "copilot-dynamic-token",
      streamUsage: false,
      configuration: {
        ...(configuration ?? {}),
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
   * @param delta - Streaming delta payload.
   * @param rawResponse - Raw transport response chunk.
   * @param defaultRole - Fallback role inferred by LangChain.
   * @returns A normalized LangChain message chunk.
   */
  protected override _convertCompletionsDeltaToBaseMessageChunk(
    delta: Record<string, any>,
    rawResponse: any,
    defaultRole?: any
  ): BaseMessageChunk {
    if (!delta.role && !defaultRole) {
      defaultRole = "assistant";
    }

    delta.content = normalizeDeltaContent(delta.content);

    return super._convertCompletionsDeltaToBaseMessageChunk(delta, rawResponse, defaultRole);
  }

  /**
   * Simple token estimation based on character count.
   * Kept as a safe fallback for direct usage outside ChatModelManager.
   * @param content - Message content to estimate.
   * @returns Approximate token count.
   */
  override async getNumTokens(content: MessageContent): Promise<number> {
    const text = extractTextFromChunk(content);
    if (!text) return 0;
    return Math.ceil(text.length / CHARS_PER_TOKEN);
  }
}
