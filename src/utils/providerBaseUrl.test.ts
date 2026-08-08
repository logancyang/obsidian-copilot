import {
  googleHostBaseUrl,
  groqHostBaseUrl,
  isCatalogProviderDefaultEndpoint,
} from "./providerBaseUrl";

describe("googleHostBaseUrl", () => {
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

describe("groqHostBaseUrl", () => {
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

describe("isCatalogProviderDefaultEndpoint", () => {
  it("recognizes the versioned Google endpoint", () => {
    expect(
      isCatalogProviderDefaultEndpoint("google", "https://generativelanguage.googleapis.com/v1beta")
    ).toBe(true);
  });

  it("recognizes the host-only Google endpoint (the configure-dialog seed)", () => {
    expect(
      isCatalogProviderDefaultEndpoint("google", "https://generativelanguage.googleapis.com")
    ).toBe(true);
  });

  it("recognizes the versioned Groq endpoint with a trailing slash", () => {
    expect(isCatalogProviderDefaultEndpoint("groq", "https://api.groq.com/openai/v1/")).toBe(true);
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
