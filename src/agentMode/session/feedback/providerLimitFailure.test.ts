import { isProviderLimitFailure } from "./providerLimitFailure";

describe("providerLimitFailure", () => {
  describe("isProviderLimitFailure()", () => {
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
      ["Gemini exhaustion", "RESOURCE_EXHAUSTED: Resource has been exhausted (e.g. check quota)."],
      ["generic throttling", "429 Too Many Requests"],
      ["Claude plan limit", "You've hit your session limit · resets 3pm"],
      ["Codex plan limit", "You've hit your usage limit. Upgrade to Pro or try again later."],
    ])(
      "https://github.com/Brevilabs/obsidian-copilot-private/issues/810 recognizes the %s as a provider limit",
      (_label, errorText) => {
        expect(isProviderLimitFailure(errorText)).toBe(true);
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
      expect(isProviderLimitFailure(errorText)).toBe(false);
    });
  });
});
