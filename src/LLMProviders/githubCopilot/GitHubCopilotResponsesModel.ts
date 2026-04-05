import { ChatOpenAI } from "@langchain/openai";
import { COPILOT_API_BASE, GitHubCopilotProvider } from "./GitHubCopilotProvider";
import type { FetchImplementation } from "@/utils";

/** Extract the constructor fields type from ChatOpenAI. */
type ChatOpenAIFields = NonNullable<ConstructorParameters<typeof ChatOpenAI>[0]>;

/**
 * Constructor params for GitHubCopilotResponsesModel.
 * Inherits all ChatOpenAI fields and adds Copilot-specific fetch injection.
 */
export type GitHubCopilotResponsesModelParams = ChatOpenAIFields & {
  /** Custom fetch implementation for CORS bypass (e.g., safeFetchNoThrow on mobile) */
  fetchImplementation?: FetchImplementation;
};

/**
 * Builds a fetch wrapper that injects a valid Copilot token and custom headers
 * on every request, with automatic 401 retry after token refresh.
 * @param provider - GitHubCopilotProvider singleton for token management.
 * @param baseFetch - Underlying fetch implementation (native or CORS-safe).
 * @returns A fetch-compatible function with Copilot auth injected.
 */
export function buildGitHubCopilotAuthedFetch(
  provider: GitHubCopilotProvider,
  baseFetch: FetchImplementation
): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  return async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url =
      typeof input === "string"
        ? input
        : typeof Request !== "undefined" && input instanceof Request
          ? input.url
          : input.toString();

    const doRequest = async (token: string): Promise<Response> => {
      const copilotHeaders = provider.buildCopilotRequestHeaders(token);
      const mergedHeaders = new Headers(init.headers);

      for (const [key, value] of Object.entries(copilotHeaders)) {
        mergedHeaders.set(key, value);
      }

      return baseFetch(url, { ...init, headers: mergedHeaders });
    };

    let token = await provider.getValidCopilotToken();
    let response = await doRequest(token);

    if (response.status === 401) {
      try {
        await response.body?.cancel();
      } catch {
        // Ignore cancellation errors when the body is already closed.
      }

      provider.invalidateCopilotToken();
      token = await provider.getValidCopilotToken();
      response = await doRequest(token);
    }

    return response;
  };
}

/**
 * GitHub Copilot model that routes requests through the Responses API.
 * Used for Copilot Codex models, which reject the Chat Completions endpoint.
 */
export class GitHubCopilotResponsesModel extends ChatOpenAI {
  /**
   * Create a Copilot-backed ChatOpenAI instance configured for `/responses`.
   * Wires up dynamic token refresh and Copilot headers via a custom fetch wrapper.
   * @param fields - LangChain/OpenAI constructor fields with Copilot fetch options.
   */
  constructor(fields: GitHubCopilotResponsesModelParams) {
    const { fetchImplementation, configuration, apiKey, ...rest } = fields;

    const provider = GitHubCopilotProvider.getInstance();
    const baseFetch = fetchImplementation ?? (configuration?.fetch as FetchImplementation) ?? fetch;
    const authedFetch = buildGitHubCopilotAuthedFetch(provider, baseFetch);

    super({
      ...rest,
      apiKey: apiKey || "copilot-dynamic-token",
      useResponsesApi: true,
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
}
