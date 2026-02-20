import { hasSelfHostSearchKey, selfHostWebSearch } from "./selfHostServices";

// --- Mocks ---

const mockGetSettings = jest.fn();
jest.mock("@/settings/model", () => ({
  getSettings: () => mockGetSettings(),
}));

jest.mock("@/encryptionService", () => ({
  getDecryptedKey: (key: string) => Promise.resolve(key),
}));

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logError: jest.fn(),
  logWarn: jest.fn(),
}));

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

beforeEach(() => {
  jest.clearAllMocks();
  // Default settings: firecrawl provider
  mockGetSettings.mockReturnValue({
    selfHostSearchProvider: "firecrawl",
    firecrawlApiKey: "fc-test-key",
    perplexityApiKey: "",
    supadataApiKey: "",
  });
});

// --- hasSelfHostSearchKey ---

describe("hasSelfHostSearchKey", () => {
  it("returns true when firecrawl provider has a key", () => {
    mockGetSettings.mockReturnValue({
      selfHostSearchProvider: "firecrawl",
      firecrawlApiKey: "fc-key",
      perplexityApiKey: "",
    });
    expect(hasSelfHostSearchKey()).toBe(true);
  });

  it("returns false when firecrawl provider has no key", () => {
    mockGetSettings.mockReturnValue({
      selfHostSearchProvider: "firecrawl",
      firecrawlApiKey: "",
      perplexityApiKey: "pplx-key",
    });
    expect(hasSelfHostSearchKey()).toBe(false);
  });

  it("returns true when perplexity provider has a key", () => {
    mockGetSettings.mockReturnValue({
      selfHostSearchProvider: "perplexity",
      firecrawlApiKey: "",
      perplexityApiKey: "pplx-key",
    });
    expect(hasSelfHostSearchKey()).toBe(true);
  });

  it("returns false when perplexity provider has no key", () => {
    mockGetSettings.mockReturnValue({
      selfHostSearchProvider: "perplexity",
      firecrawlApiKey: "fc-key",
      perplexityApiKey: "",
    });
    expect(hasSelfHostSearchKey()).toBe(false);
  });

  it("defaults to firecrawl for unknown provider", () => {
    mockGetSettings.mockReturnValue({
      selfHostSearchProvider: "unknown",
      firecrawlApiKey: "fc-key",
      perplexityApiKey: "",
    });
    expect(hasSelfHostSearchKey()).toBe(true);
  });
});

// --- Firecrawl search ---

describe("selfHostWebSearch — Firecrawl", () => {
  beforeEach(() => {
    mockGetSettings.mockReturnValue({
      selfHostSearchProvider: "firecrawl",
      firecrawlApiKey: "fc-test-key",
      perplexityApiKey: "",
    });
  });

  it("parses v2 data.web format", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          web: [
            { title: "Result 1", description: "Desc 1", url: "https://example.com/1" },
            { title: "Result 2", description: "Desc 2", url: "https://example.com/2" },
          ],
        },
      }),
    });

    const result = await selfHostWebSearch("test query");

    expect(result.citations).toEqual(["https://example.com/1", "https://example.com/2"]);
    expect(result.content).toContain("### Result 1");
    expect(result.content).toContain("### Result 2");
  });

  it("falls back to data array for older responses", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [{ title: "Old", description: "Old desc", url: "https://old.com" }],
      }),
    });

    const result = await selfHostWebSearch("test query");

    expect(result.citations).toEqual(["https://old.com"]);
    expect(result.content).toContain("### Old");
  });

  it("returns empty results for malformed data", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: "not an array or object" }),
    });

    const result = await selfHostWebSearch("test query");

    expect(result.content).toBe("");
    expect(result.citations).toEqual([]);
  });

  it("throws on HTTP errors", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    });

    await expect(selfHostWebSearch("test query")).rejects.toThrow(
      "Firecrawl search failed (401): Unauthorized"
    );
  });

  it("handles empty results array", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { web: [] } }),
    });

    const result = await selfHostWebSearch("test query");

    expect(result.content).toBe("");
    expect(result.citations).toEqual([]);
  });

  it("sends correct request format", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { web: [] } }),
    });

    await selfHostWebSearch("my query");

    expect(mockFetch).toHaveBeenCalledWith("https://api.firecrawl.dev/v2/search", {
      method: "POST",
      headers: {
        Authorization: "Bearer fc-test-key",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: "my query", limit: 5 }),
    });
  });
});

// --- Perplexity Sonar search ---

describe("selfHostWebSearch — Perplexity Sonar", () => {
  beforeEach(() => {
    mockGetSettings.mockReturnValue({
      selfHostSearchProvider: "perplexity",
      firecrawlApiKey: "",
      perplexityApiKey: "pplx-test-key",
    });
  });

  it("parses standard Sonar response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "Here is the answer about AI." } }],
        citations: ["https://source1.com", "https://source2.com"],
      }),
    });

    const result = await selfHostWebSearch("what is AI");

    expect(result.content).toBe("Here is the answer about AI.");
    expect(result.citations).toEqual(["https://source1.com", "https://source2.com"]);
  });

  it("handles missing citations", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "Some answer" } }],
      }),
    });

    const result = await selfHostWebSearch("test");

    expect(result.content).toBe("Some answer");
    expect(result.citations).toEqual([]);
  });

  it("handles empty choices", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [],
        citations: ["https://cite.com"],
      }),
    });

    const result = await selfHostWebSearch("test");

    expect(result.content).toBe("");
    expect(result.citations).toEqual(["https://cite.com"]);
  });

  it("throws on HTTP errors", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: async () => "Rate limited",
    });

    await expect(selfHostWebSearch("test")).rejects.toThrow(
      "Perplexity Sonar search failed (429): Rate limited"
    );
  });

  it("sends correct request format with model=sonar", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "" } }], citations: [] }),
    });

    await selfHostWebSearch("my query");

    expect(mockFetch).toHaveBeenCalledWith("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        Authorization: "Bearer pplx-test-key",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "sonar",
        messages: [{ role: "user", content: "my query" }],
      }),
    });
  });
});

// --- Provider dispatch ---

describe("selfHostWebSearch — provider dispatch", () => {
  it("routes to Firecrawl URL when provider is firecrawl", async () => {
    mockGetSettings.mockReturnValue({
      selfHostSearchProvider: "firecrawl",
      firecrawlApiKey: "fc-key",
      perplexityApiKey: "",
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { web: [] } }),
    });

    await selfHostWebSearch("test");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.firecrawl.dev/v2/search",
      expect.any(Object)
    );
  });

  it("routes to Perplexity URL when provider is perplexity", async () => {
    mockGetSettings.mockReturnValue({
      selfHostSearchProvider: "perplexity",
      firecrawlApiKey: "",
      perplexityApiKey: "pplx-key",
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "" } }], citations: [] }),
    });

    await selfHostWebSearch("test");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.perplexity.ai/chat/completions",
      expect.any(Object)
    );
  });

  it("defaults to Firecrawl for unknown provider value", async () => {
    mockGetSettings.mockReturnValue({
      selfHostSearchProvider: "unknown-provider",
      firecrawlApiKey: "fc-key",
      perplexityApiKey: "",
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { web: [] } }),
    });

    await selfHostWebSearch("test");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.firecrawl.dev/v2/search",
      expect.any(Object)
    );
  });
});
