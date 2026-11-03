import {
  googleHostBaseUrl,
  groqHostBaseUrl,
  isCatalogProviderDefaultEndpoint,
  opencodeSdkBaseUrl,
} from "./providerBaseUrl";

describe("providerBaseUrl", () => {
  describe("googleHostBaseUrl()", () => {
    it("strips a trailing /v1beta (Google's documented endpoint form)", () => {
      expect(googleHostBaseUrl("https://generativelanguage.googleapis.com/v1beta")).toBe(
        "https://generativelanguage.googleapis.com"
      );
    });

    it("strips a trailing /v1", () => {
      expect(googleHostBaseUrl("https://generativelanguage.googleapis.com/v1")).toBe(
        "https://generativelanguage.googleapis.com"
      );
    });

    it("leaves a host-only URL unchanged", () => {
      expect(googleHostBaseUrl("https://generativelanguage.googleapis.com")).toBe(
        "https://generativelanguage.googleapis.com"
      );
    });

    it("tolerates trailing slashes and surrounding whitespace", () => {
      expect(googleHostBaseUrl("  https://generativelanguage.googleapis.com/v1beta/ ")).toBe(
        "https://generativelanguage.googleapis.com"
      );
    });

    it("strips the suffix from a proxy origin too (proxies mirror the path shape)", () => {
      expect(googleHostBaseUrl("https://my-gateway.example.com/v1beta")).toBe(
        "https://my-gateway.example.com"
      );
    });

    it("does not touch mid-path version segments", () => {
      expect(googleHostBaseUrl("https://gw.example.com/v1/acct/google-ai-studio")).toBe(
        "https://gw.example.com/v1/acct/google-ai-studio"
      );
    });

    it("returns undefined for blank input", () => {
      expect(googleHostBaseUrl(undefined)).toBeUndefined();
      expect(googleHostBaseUrl("")).toBeUndefined();
      expect(googleHostBaseUrl("   ")).toBeUndefined();
    });
  });

  describe("groqHostBaseUrl()", () => {
    it("strips a trailing /openai/v1 (the models.dev form the dialog seeds)", () => {
      expect(groqHostBaseUrl("https://api.groq.com/openai/v1")).toBe("https://api.groq.com");
    });

    it("strips a trailing /openai", () => {
      expect(groqHostBaseUrl("https://api.groq.com/openai")).toBe("https://api.groq.com");
    });

    it("strips a trailing /v1", () => {
      expect(groqHostBaseUrl("https://api.groq.com/v1")).toBe("https://api.groq.com");
    });

    it("leaves a host-only URL unchanged", () => {
      expect(groqHostBaseUrl("https://api.groq.com")).toBe("https://api.groq.com");
    });

    it("returns undefined for blank input", () => {
      expect(groqHostBaseUrl(undefined)).toBeUndefined();
      expect(groqHostBaseUrl("")).toBeUndefined();
    });
  });

  describe("opencodeSdkBaseUrl()", () => {
    it("passes the saved URL through unchanged when the provider's SDK reads it the way Copilot saves it", () => {
      expect(opencodeSdkBaseUrl("mistral", "https://api.mistral.ai/v1")).toBe(
        "https://api.mistral.ai/v1"
      );
      expect(opencodeSdkBaseUrl("deepinfra", "https://api.deepinfra.com/v1/openai")).toBe(
        "https://api.deepinfra.com/v1/openai"
      );
      expect(opencodeSdkBaseUrl("perplexity", "https://api.perplexity.ai/v1")).toBe(
        "https://api.perplexity.ai/v1"
      );
      expect(opencodeSdkBaseUrl(undefined, "https://gateway.example.com/v1")).toBe(
        "https://gateway.example.com/v1"
      );
    });

    it.each([
      ["aihubmix", "https://api.inferera.com/v1", "https://api.inferera.com"],
      ["cohere", "https://api.cohere.com/compatibility/v1", "https://api.cohere.com/v2"],
      ["anthropic", "https://claude-proxy.example.com", "https://claude-proxy.example.com/v1"],
      ["google", "https://gemini-proxy.example.com", "https://gemini-proxy.example.com/v1beta"],
    ])(
      "rewrites a %s URL saved as %s to %s, the ending its OpenCode SDK expects (https://github.com/logancyang/obsidian-copilot/issues/3641)",
      (catalogProviderId, saved, expected) => {
        expect(opencodeSdkBaseUrl(catalogProviderId, saved)).toBe(expected);
      }
    );

    it.each([
      ["anthropic", "https://claude-proxy.example.com/v1"],
      ["google", "https://gemini-proxy.example.com/v1beta"],
      ["google", "https://gemini-proxy.example.com/v1"],
      ["google", "https://gemini-proxy.example.com/v1alpha"],
      ["cohere", "https://api.cohere.com/v2"],
      ["aihubmix", "https://aihubmix.com"],
    ])("leaves a %s URL already in its SDK's shape unchanged: %s", (catalogProviderId, saved) => {
      expect(opencodeSdkBaseUrl(catalogProviderId, saved)).toBe(saved);
    });

    it("keeps a gateway's own path prefix and rewrites only the ending, ignoring a trailing slash", () => {
      expect(opencodeSdkBaseUrl("aihubmix", "https://gw.example.com/team/aihubmix/v1/")).toBe(
        "https://gw.example.com/team/aihubmix"
      );
    });

    it("returns undefined when no base URL is saved", () => {
      expect(opencodeSdkBaseUrl("aihubmix", undefined)).toBeUndefined();
      expect(opencodeSdkBaseUrl("mistral", undefined)).toBeUndefined();
    });
  });

  describe("isCatalogProviderDefaultEndpoint()", () => {
    it("recognizes the versioned Google endpoint", () => {
      expect(
        isCatalogProviderDefaultEndpoint(
          "google",
          "https://generativelanguage.googleapis.com/v1beta"
        )
      ).toBe(true);
    });

    it("recognizes the host-only Google endpoint (the configure-dialog seed)", () => {
      expect(
        isCatalogProviderDefaultEndpoint("google", "https://generativelanguage.googleapis.com")
      ).toBe(true);
    });

    it("recognizes the versioned Groq endpoint with a trailing slash", () => {
      expect(isCatalogProviderDefaultEndpoint("groq", "https://api.groq.com/openai/v1/")).toBe(
        true
      );
    });

    it("rejects a proxy origin", () => {
      expect(isCatalogProviderDefaultEndpoint("openai", "https://my-proxy.example.com/v1")).toBe(
        false
      );
    });

    it("rejects a non-default path on the canonical origin", () => {
      expect(
        isCatalogProviderDefaultEndpoint(
          "google",
          "https://generativelanguage.googleapis.com/v1alpha"
        )
      ).toBe(false);
    });

    it("rejects unknown catalog ids", () => {
      expect(isCatalogProviderDefaultEndpoint("mistral", "https://api.mistral.ai/v1")).toBe(false);
      expect(isCatalogProviderDefaultEndpoint(undefined, "https://api.groq.com")).toBe(false);
    });

    it("rejects unparseable URLs", () => {
      expect(isCatalogProviderDefaultEndpoint("google", "not a url")).toBe(false);
    });
  });
});
