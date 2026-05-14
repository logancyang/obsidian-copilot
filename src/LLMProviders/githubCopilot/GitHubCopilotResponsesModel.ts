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
          : input instanceof URL
            ? input.href
            : input.url;

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
    const baseFetch = fetchImplementation ?? configuration?.fetch ?? fetch;
    const authedFetch = buildGitHubCopilotAuthedFetch(provider, baseFetch);

    super({
      ...rest,
      apiKey: apiKey || "copilot-dynamic-token",
      useResponsesApi: true,
      streamUsage: false,
      configuration: {
        ...(configuration ?? {}),
        baseURL: configuration?.baseURL ?? COPILOT_API_BASE,
        fetch: authedFetch,
      },
    });
  }

  /** LangChain model type identifier. */
  override _llmType(): string {
    return "github-copilot";
  }
}
