import { isProviderSideFailure } from "./providerSideFailure";

function acpFailure(message: string, data: Record<string, unknown>): Error {
  return Object.assign(new Error(message), { code: -32603, data });
}

describe("providerSideFailure", () => {
  describe("isProviderSideFailure()", () => {
    it.each([
      ["OpenCode quota", { service: "session", errorName: "provider.quota" }],
      ["OpenCode rate limit", { service: "session", errorName: "provider.rate-limit" }],
      ["OpenCode free-model limit", { service: "session", errorName: "provider.free-limit" }],
      ["OpenCode Go limit", { service: "session", errorName: "provider.go-limit" }],
      ["OpenCode workspace budget", { service: "session", errorName: "provider.budget-limit" }],
      ["OpenCode model budget", { service: "session", errorName: "provider.model-budget-limit" }],
      ["OpenCode ChatGPT limit", { service: "session", errorName: "provider.chatgpt-limit" }],
      [
        "Codex plan limit",
        { message: "You've hit your usage limit.", codexErrorInfo: "usageLimitExceeded" },
      ],
    ])(
      "https://github.com/Brevilabs/obsidian-copilot-private/issues/810 recognizes the %s category whatever the provider's wording",
      (_label, data) => {
        const error = acpFailure("Internal error: wording no pattern knows", data);

        expect(isProviderSideFailure(error, error.message)).toBe(true);
      }
    );

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/826 recognizes OpenCode's transport category as an unreachable provider", () => {
      const error = acpFailure("Internal error: ConnectionRefused: Unable to connect.", {
        service: "session",
        errorName: "provider.transport",
      });

      expect(isProviderSideFailure(error, error.message)).toBe(true);
    });

    it.each([
      ["Claude plan limit", "You've hit your session limit · resets 3pm"],
      [
        "Anthropic API credit",
        "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.",
      ],
      [
        "Claude API rate limit",
        'API Error: 429 {"type":"error","error":{"type":"rate_limit_error","message":"Number of request tokens has exceeded your per-minute rate limit"}}',
      ],
      [
        "Copilot Plus weekly cap",
        'Internal error: Provider request failed with HTTP 429: {"detail":{"error":{"message":"You\'ve reached your Copilot Plus weekly usage limit.","type":"token_limit_error"}}}',
      ],
      [
        "exhausted rate-limited routes",
        "Internal error: All models exhausted: 1 route checked (1 model lacks vision). Add more API keys or wait for rate limits to reset.",
      ],
    ])(
      "https://github.com/Brevilabs/obsidian-copilot-private/issues/810 recognizes the uncategorized %s by its text",
      (_label, errorText) => {
        expect(isProviderSideFailure(new Error(errorText), errorText)).toBe(true);
      }
    );

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/810 recognizes OpenRouter's max_tokens affordability error, which OpenCode files as an invalid request", () => {
      const error = acpFailure(
        "Internal error: This request requires more credits, or fewer max_tokens. You requested up to 256000 tokens, but can only afford 32935.",
        { service: "session", errorName: "provider.invalid-request" }
      );

      expect(isProviderSideFailure(error, error.message)).toBe(true);
    });

    it("https://github.com/logancyang/obsidian-copilot/issues/4244 recognizes provider authentication by category even with unfamiliar wording", () => {
      const error = acpFailure("Internal error: credentials rejected", {
        service: "session",
        errorName: "provider.auth",
      });

      expect(isProviderSideFailure(error, error.message)).toBe(true);
    });

    it("https://github.com/logancyang/obsidian-copilot/issues/4244 recognizes OpenCode's authentication-required response with empty data", () => {
      const error = Object.assign(
        new Error("Authentication required: provider authentication required"),
        { code: -32000, data: {} }
      );

      expect(isProviderSideFailure(error, error.message)).toBe(true);
    });

    it.each([
      [
        "a tool error mentioning authentication (https://github.com/logancyang/obsidian-copilot/issues/4244)",
        new Error("Copilot tool failed: authentication required"),
      ],
      ["a backend crash", acpFailure("Internal error", { errorName: "ClientError" })],
      [
        "an unsupported model capability",
        acpFailure(
          "Internal error: registry.ollama.ai/library/gemma:latest does not support tools",
          {
            service: "session",
            errorName: "provider.invalid-request",
          }
        ),
      ],
      ["a missing model", new Error("model not supported: gemini-4")],
      ["a request id containing 429", new Error("Internal error: request req_4291 failed")],
      ["an error without data", "Internal error"],
    ])("treats %s as a possible Copilot failure", (_label, error) => {
      const errorText = error instanceof Error ? error.message : error;

      expect(isProviderSideFailure(error, errorText)).toBe(false);
    });
  });
});
