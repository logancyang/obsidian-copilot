import { isProviderSideFailure } from "./providerSideFailure";

describe("providerSideFailure", () => {
  describe("isProviderSideFailure()", () => {
    it.each([
      [
        "OpenCode free usage limit",
        "Internal error: Free usage limit reached. Free models work in OpenCode (https://opencode.ai); subscribe to OpenCode Go to keep going: https://opencode.ai/go",
      ],
      [
        "Copilot Plus weekly cap",
        'Internal error: Provider request failed with HTTP 429: {"detail":{"error":{"message":"You\'ve reached your Copilot Plus weekly usage limit.","type":"token_limit_error"}}}',
      ],
      [
        "exhausted rate-limited routes",
        "Internal error: All models exhausted: 1 route checked (1 model lacks vision). Add more API keys or wait for rate limits to reset.",
      ],
      [
        "OpenAI quota",
        "insufficient_quota: You exceeded your current quota, please check your plan and billing details.",
      ],
      [
        "Anthropic credit",
        "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.",
      ],
      ["OpenRouter credits", "Provider returned status 402: Insufficient credits"],
      [
        "OpenRouter max_tokens affordability",
        "Internal error: This request requires more credits, or fewer max_tokens. You requested up to 256000 tokens, but can only afford 32935. To increase, visit https://openrouter.ai/settings/credits and add more credits",
      ],
      [
        "OpenRouter in-flight credit reservation",
        "Internal error: This request would exceed your available credits given your current in-flight requests. Retry after in-flight requests settle, or add credits.",
      ],
      [
        "DeepSeek balance",
        "Internal error: Insufficient Balance (request_id: 69669aa1-63a2-4d12-8591-142347639ee6)",
      ],
      ["Gemini exhaustion", "RESOURCE_EXHAUSTED: Resource has been exhausted (e.g. check quota)."],
      ["generic throttling", "429 Too Many Requests"],
      ["Claude plan limit", "You've hit your session limit · resets 3pm"],
      ["Codex plan limit", "You've hit your usage limit. Upgrade to Pro or try again later."],
    ])(
      "https://github.com/Brevilabs/obsidian-copilot-private/issues/810 recognizes the %s as a provider limit",
      (_label, errorText) => {
        expect(isProviderSideFailure(errorText)).toBe(true);
      }
    );

    it.each([
      [
        "refused connection to a custom endpoint",
        "Internal error: ConnectionRefused: Unable to connect. Is the computer able to access the url?",
      ],
      [
        "reset provider socket",
        "Internal error: Cannot connect to API: ECONNRESET: The socket connection was closed unexpectedly. For more information, pass `verbose: true` in the second argument to fetch()",
      ],
      ["Node refused connection", "connect ECONNREFUSED 127.0.0.1:11434"],
    ])(
      "https://github.com/Brevilabs/obsidian-copilot-private/issues/826 recognizes a %s as an unreachable provider",
      (_label, errorText) => {
        expect(isProviderSideFailure(errorText)).toBe(true);
      }
    );

    it.each([
      ["a backend crash", "Internal error"],
      ["a missing model", "model not supported: gemini-4"],
      [
        "an unsupported model capability",
        "registry.ollama.ai/library/gemma:latest does not support tools",
      ],
      ["a request id containing 429", "Internal error: request req_4291 failed"],
    ])("treats %s as a possible Copilot failure", (_label, errorText) => {
      expect(isProviderSideFailure(errorText)).toBe(false);
    });
  });
});
