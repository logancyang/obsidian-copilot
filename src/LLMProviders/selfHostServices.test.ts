import {
  createSelfHostWebSearchAgentBridge,
  hasSelfHostSearchKey,
  selfHostWebSearch,
  type SelfHostWebSearchAgentBridge,
  type SelfHostWebSearchAgentChannel,
} from "./selfHostServices";

const mockGetSettings = jest.fn();
jest.mock("@/settings/model", () => ({
  getSettings: (): unknown => mockGetSettings(),
}));

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logError: jest.fn(),
  logWarn: jest.fn(),
}));

const mockFetch = jest.fn();
jest.mock("@/utils", () => {
  const actual = jest.requireActual<Record<string, unknown>>("@/utils");
  return {
    ...actual,
    safeFetchNoThrow: (url: string, options?: RequestInit): unknown => mockFetch(url, options),
  };
});

function providerSettings(provider: string, overrides: Record<string, string> = {}) {
  return {
    selfHostSearchProvider: provider,
    firecrawlApiKey: "",
    perplexityApiKey: "",
    parallelApiKey: "",
    exaApiKey: "",
    supadataApiKey: "",
    ...overrides,
  };
}

function mockJsonResponse(json: unknown): void {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => json,
  });
}

function parallelRequestBody(): { objective: string; search_queries: string[] } {
  const options = mockFetch.mock.calls[0]?.[1] as RequestInit;
  if (typeof options.body !== "string") {
    throw new Error("Expected Parallel request body to be a string");
  }
  return JSON.parse(options.body) as { objective: string; search_queries: string[] };
}

function requestAgentSearchChannel(
  channel: Readonly<SelfHostWebSearchAgentChannel>,
  query: string,
  token = channel.token,
  url = channel.url
): Promise<{ status: number; contentType: string | undefined; body: unknown }> {
  const http = jest.requireActual<typeof import("node:http")>("node:http");
  return new Promise((resolve, reject) => {
    const request = http.request(
      url,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "text/plain; charset=utf-8",
          "Content-Length": Buffer.byteLength(query),
        },
      },
      (response) => {
        let responseBody = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          responseBody += chunk;
        });
        response.on("end", () => {
          resolve({
            status: response.statusCode ?? 0,
            contentType: response.headers["content-type"],
            body: JSON.parse(responseBody) as unknown,
          });
        });
      }
    );
    request.on("error", reject);
    request.end(query);
  });
}

describe("selfHostServices", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSettings.mockReturnValue(
      providerSettings("firecrawl", { firecrawlApiKey: "fc-test-key" })
    );
  });

  describe("hasSelfHostSearchKey()", () => {
    it.each([
      ["firecrawl", "firecrawlApiKey", "fc-key"],
      ["perplexity", "perplexityApiKey", "pplx-key"],
      ["parallel", "parallelApiKey", "parallel-key"],
      ["exa", "exaApiKey", "exa-key"],
    ])(
      "uses only the selected %s credential (https://github.com/Brevilabs/obsidian-copilot-private/issues/285)",
      (provider, keyField, key) => {
        mockGetSettings.mockReturnValue(providerSettings(provider, { [keyField]: key }));

        expect(hasSelfHostSearchKey()).toBe(true);
      }
    );

    it.each([
      ["firecrawl", "perplexityApiKey", "pplx-key"],
      ["perplexity", "firecrawlApiKey", "fc-key"],
      ["parallel", "exaApiKey", "exa-key"],
      ["exa", "parallelApiKey", "parallel-key"],
    ])(
      "does not accept another provider's credential for %s (https://github.com/Brevilabs/obsidian-copilot-private/issues/285)",
      (provider, otherKeyField, otherKey) => {
        mockGetSettings.mockReturnValue(providerSettings(provider, { [otherKeyField]: otherKey }));

        expect(hasSelfHostSearchKey()).toBe(false);
      }
    );

    it("defaults to the Firecrawl credential for an unknown provider", () => {
      mockGetSettings.mockReturnValue(providerSettings("unknown", { firecrawlApiKey: "fc-key" }));

      expect(hasSelfHostSearchKey()).toBe(true);
    });
  });

  describe("createSelfHostWebSearchAgentBridge()", () => {
    const bridges: SelfHostWebSearchAgentBridge[] = [];

    afterEach(() => {
      for (const bridge of bridges) bridge.dispose();
      bridges.length = 0;
    });

    function createBridge(
      isModeValid: () => boolean,
      hasSearchKey: () => boolean,
      search: (query: string) => Promise<{ content: string; citations: string[] }>
    ): SelfHostWebSearchAgentBridge {
      const bridge = createSelfHostWebSearchAgentBridge(isModeValid, hasSearchKey, search);
      bridges.push(bridge);
      return bridge;
    }

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/165 routes an entitled Agent Chat query through a reusable plugin-owned channel", async () => {
      const search = jest.fn().mockResolvedValue({
        content: "日本語の結果 ✅",
        citations: ["https://example.com"],
      });
      const bridge = createBridge(
        () => true,
        () => true,
        search
      );
      const channel = await bridge.getChannel();

      await expect(requestAgentSearchChannel(channel, "current\nfacts ✅")).resolves.toEqual({
        status: 200,
        contentType: "application/json; charset=utf-8",
        body: { content: "日本語の結果 ✅", citations: ["https://example.com"] },
      });
      await expect(bridge.getChannel()).resolves.toBe(channel);
      expect(search).toHaveBeenCalledWith("current\nfacts ✅");
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/165 fails closed when the signed Self-Host entitlement is unavailable", async () => {
      const search = jest.fn();
      const bridge = createBridge(
        () => false,
        () => true,
        search
      );
      const channel = await bridge.getChannel();

      await expect(requestAgentSearchChannel(channel, "private query")).resolves.toEqual({
        status: 500,
        contentType: "application/json; charset=utf-8",
        body: { error: "Self-host web search is not available for this session." },
      });
      expect(search).not.toHaveBeenCalled();
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/165 fails closed when the selected provider has no API key", async () => {
      const search = jest.fn();
      const bridge = createBridge(
        () => true,
        () => false,
        search
      );
      const channel = await bridge.getChannel();

      await expect(requestAgentSearchChannel(channel, "private query")).resolves.toEqual({
        status: 500,
        contentType: "application/json; charset=utf-8",
        body: { error: "Add an API key for the selected self-host search provider." },
      });
      expect(search).not.toHaveBeenCalled();
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/165 rejects another local process without the per-lifecycle token", async () => {
      const search = jest.fn();
      const bridge = createBridge(
        () => true,
        () => true,
        search
      );
      const channel = await bridge.getChannel();

      await expect(
        requestAgentSearchChannel(channel, "private query", "wrong-token")
      ).resolves.toEqual({
        status: 401,
        contentType: "application/json; charset=utf-8",
        body: { error: "Unauthorized." },
      });
      expect(search).not.toHaveBeenCalled();
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/165 rejects empty and oversized local search requests before provider dispatch", async () => {
      const search = jest.fn();
      const bridge = createBridge(
        () => true,
        () => true,
        search
      );
      const channel = await bridge.getChannel();

      await expect(requestAgentSearchChannel(channel, "   ")).resolves.toEqual({
        status: 400,
        contentType: "application/json; charset=utf-8",
        body: { error: "A non-empty query is required." },
      });
      await expect(requestAgentSearchChannel(channel, "x".repeat(64 * 1024 + 1))).resolves.toEqual({
        status: 413,
        contentType: "application/json; charset=utf-8",
        body: { error: "Request body is too large." },
      });
      expect(search).not.toHaveBeenCalled();
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/165 exposes only the search route on the local channel", async () => {
      const search = jest.fn();
      const bridge = createBridge(
        () => true,
        () => true,
        search
      );
      const channel = await bridge.getChannel();

      await expect(
        requestAgentSearchChannel(
          channel,
          "private query",
          channel.token,
          channel.url.replace("/search", "/other")
        )
      ).resolves.toEqual({
        status: 404,
        contentType: "application/json; charset=utf-8",
        body: { error: "Not found." },
      });
      expect(search).not.toHaveBeenCalled();
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/165 closes the local channel with its plugin lifecycle", async () => {
      const bridge = createBridge(
        () => true,
        () => true,
        jest.fn()
      );
      const channel = await bridge.getChannel();

      bridge.dispose();

      await expect(bridge.getChannel()).rejects.toThrow("channel is closed");
      await expect(requestAgentSearchChannel(channel, "private query")).rejects.toThrow();
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/165 rejects channel startup when the plugin is disposed before listening", async () => {
      const bridge = createBridge(
        () => true,
        () => true,
        jest.fn()
      );
      const channel = bridge.getChannel();

      bridge.dispose();

      await expect(channel).rejects.toThrow("channel is closed");
    });
  });

  describe("selfHostWebSearch()", () => {
    describe("Firecrawl", () => {
      beforeEach(() => {
        mockGetSettings.mockReturnValue(
          providerSettings("firecrawl", { firecrawlApiKey: "fc-test-key" })
        );
      });

      it("parses the v2 data.web format", async () => {
        mockJsonResponse({
          data: {
            web: [
              { title: "Result 1", description: "Desc 1", url: "https://example.com/1" },
              { title: "Result 2", description: "Desc 2", url: "https://example.com/2" },
            ],
          },
        });

        const result = await selfHostWebSearch("test query");

        expect(result.citations).toEqual(["https://example.com/1", "https://example.com/2"]);
        expect(result.content).toContain("### Result 1");
        expect(result.content).toContain("### Result 2");
      });

      it("falls back to the older flat data array", async () => {
        mockJsonResponse({
          data: [{ title: "Old", description: "Old desc", url: "https://old.com" }],
        });

        const result = await selfHostWebSearch("test query");

        expect(result.citations).toEqual(["https://old.com"]);
        expect(result.content).toContain("### Old");
      });

      it("returns empty results for malformed data", async () => {
        mockJsonResponse({ data: "not an array or object" });

        await expect(selfHostWebSearch("test query")).resolves.toEqual({
          content: "",
          citations: [],
        });
      });

      it("returns empty results for an empty result array", async () => {
        mockJsonResponse({ data: { web: [] } });

        await expect(selfHostWebSearch("test query")).resolves.toEqual({
          content: "",
          citations: [],
        });
      });

      it("includes the status and body in HTTP errors", async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 401,
          text: async () => "Unauthorized",
        });

        await expect(selfHostWebSearch("test query")).rejects.toThrow(
          "Firecrawl search failed (401): Unauthorized"
        );
      });

      it("sends the expected request", async () => {
        mockJsonResponse({ data: { web: [] } });

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

    describe("Perplexity Sonar", () => {
      beforeEach(() => {
        mockGetSettings.mockReturnValue(
          providerSettings("perplexity", { perplexityApiKey: "pplx-test-key" })
        );
      });

      it("parses the answer and citations", async () => {
        mockJsonResponse({
          choices: [{ message: { content: "Here is the answer about AI." } }],
          citations: ["https://source1.com", "https://source2.com"],
        });

        await expect(selfHostWebSearch("what is AI")).resolves.toEqual({
          content: "Here is the answer about AI.",
          citations: ["https://source1.com", "https://source2.com"],
        });
      });

      it("handles missing citations", async () => {
        mockJsonResponse({ choices: [{ message: { content: "Some answer" } }] });

        await expect(selfHostWebSearch("test")).resolves.toEqual({
          content: "Some answer",
          citations: [],
        });
      });

      it("handles an empty choices array", async () => {
        mockJsonResponse({ choices: [], citations: ["https://cite.com"] });

        await expect(selfHostWebSearch("test")).resolves.toEqual({
          content: "",
          citations: ["https://cite.com"],
        });
      });

      it("includes the status and body in HTTP errors", async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 429,
          text: async () => "Rate limited",
        });

        await expect(selfHostWebSearch("test")).rejects.toThrow(
          "Perplexity Sonar search failed (429): Rate limited"
        );
      });

      it("sends the expected request", async () => {
        mockJsonResponse({ choices: [{ message: { content: "" } }], citations: [] });

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

    describe("Parallel", () => {
      beforeEach(() => {
        mockGetSettings.mockReturnValue(
          providerSettings("parallel", { parallelApiKey: "parallel-test-key" })
        );
      });

      it("normalizes excerpts and only nonempty URLs as citations (https://github.com/Brevilabs/obsidian-copilot-private/issues/285)", async () => {
        mockJsonResponse({
          results: [
            null,
            {
              title: "Parallel result",
              url: "https://parallel.example/result",
              excerpts: ["First excerpt", "Second excerpt"],
            },
            { title: "No URL", url: "  ", excerpts: ["Still useful"] },
          ],
        });

        const result = await selfHostWebSearch("test query");

        expect(result.content).toContain("### Parallel result\nFirst excerpt\nSecond excerpt");
        expect(result.content).toContain("### No URL\nStill useful");
        expect(result.citations).toEqual(["https://parallel.example/result"]);
      });

      it("returns empty results for a malformed result collection (https://github.com/Brevilabs/obsidian-copilot-private/issues/285)", async () => {
        mockJsonResponse({ results: "not-an-array" });

        await expect(selfHostWebSearch("test query")).resolves.toEqual({
          content: "",
          citations: [],
        });
      });

      it("returns empty results for an empty result array (https://github.com/Brevilabs/obsidian-copilot-private/issues/285)", async () => {
        mockJsonResponse({ results: [] });

        await expect(selfHostWebSearch("test query")).resolves.toEqual({
          content: "",
          citations: [],
        });
      });

      it("includes the status and body in provider errors (https://github.com/Brevilabs/obsidian-copilot-private/issues/285)", async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 422,
          text: async () => "Invalid query",
        });

        await expect(selfHostWebSearch("test query")).rejects.toThrow(
          "Parallel search failed (422): Invalid query"
        );
      });

      it("sends the GA request with only the Parallel credential (https://github.com/Brevilabs/obsidian-copilot-private/issues/285)", async () => {
        mockJsonResponse({ results: [] });

        await selfHostWebSearch("my query");

        expect(mockFetch).toHaveBeenCalledWith("https://api.parallel.ai/v1/search", {
          method: "POST",
          headers: {
            "x-api-key": "parallel-test-key",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ objective: "my query", search_queries: ["my query"] }),
        });
      });

      it("keeps a 200-character search query unchanged (https://github.com/Brevilabs/obsidian-copilot-private/issues/285)", async () => {
        const query = "q".repeat(200);
        mockJsonResponse({ results: [] });

        await selfHostWebSearch(query);

        expect(parallelRequestBody().search_queries).toEqual([query]);
      });

      it("truncates a 201-character search query to 200 characters (https://github.com/Brevilabs/obsidian-copilot-private/issues/285)", async () => {
        const query = "q".repeat(201);
        mockJsonResponse({ results: [] });

        await selfHostWebSearch(query);

        expect(parallelRequestBody().search_queries).toEqual(["q".repeat(200)]);
      });

      it("keeps a 5000-character objective unchanged (https://github.com/Brevilabs/obsidian-copilot-private/issues/285)", async () => {
        const query = "q".repeat(5000);
        mockJsonResponse({ results: [] });

        await selfHostWebSearch(query);

        expect(parallelRequestBody().objective).toBe(query);
      });

      it("truncates a 5001-character objective to 5000 characters (https://github.com/Brevilabs/obsidian-copilot-private/issues/285)", async () => {
        const query = "q".repeat(5001);
        mockJsonResponse({ results: [] });

        await selfHostWebSearch(query);

        expect(parallelRequestBody().objective).toBe("q".repeat(5000));
      });
    });

    describe("Exa", () => {
      beforeEach(() => {
        mockGetSettings.mockReturnValue(providerSettings("exa", { exaApiKey: "exa-test-key" }));
      });

      it("normalizes highlights and only nonempty URLs as citations (https://github.com/Brevilabs/obsidian-copilot-private/issues/285)", async () => {
        mockJsonResponse({
          results: [
            42,
            {
              title: "Exa result",
              url: "https://exa.example/result",
              highlights: ["First highlight", "Second highlight"],
            },
            { title: "No URL", highlights: ["Still useful"] },
          ],
        });

        const result = await selfHostWebSearch("test query");

        expect(result.content).toContain("### Exa result\nFirst highlight\nSecond highlight");
        expect(result.content).toContain("### No URL\nStill useful");
        expect(result.citations).toEqual(["https://exa.example/result"]);
      });

      it("returns empty results for a malformed result collection (https://github.com/Brevilabs/obsidian-copilot-private/issues/285)", async () => {
        mockJsonResponse({ results: { title: "not an array" } });

        await expect(selfHostWebSearch("test query")).resolves.toEqual({
          content: "",
          citations: [],
        });
      });

      it("returns empty results for an empty result array (https://github.com/Brevilabs/obsidian-copilot-private/issues/285)", async () => {
        mockJsonResponse({ results: [] });

        await expect(selfHostWebSearch("test query")).resolves.toEqual({
          content: "",
          citations: [],
        });
      });

      it("includes the status and body in provider errors (https://github.com/Brevilabs/obsidian-copilot-private/issues/285)", async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 401,
          text: async () => "Invalid API key",
        });

        await expect(selfHostWebSearch("test query")).rejects.toThrow(
          "Exa search failed (401): Invalid API key"
        );
      });

      it("sends the search request with only the Exa credential (https://github.com/Brevilabs/obsidian-copilot-private/issues/285)", async () => {
        mockJsonResponse({ results: [] });

        await selfHostWebSearch("my query");

        expect(mockFetch).toHaveBeenCalledWith("https://api.exa.ai/search", {
          method: "POST",
          headers: {
            "x-api-key": "exa-test-key",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            query: "my query",
            numResults: 5,
            contents: { highlights: true },
          }),
        });
      });
    });

    describe("provider dispatch", () => {
      it.each([
        [
          "firecrawl",
          "firecrawlApiKey",
          "fc-key",
          "https://api.firecrawl.dev/v2/search",
          { data: { web: [] } },
        ],
        [
          "perplexity",
          "perplexityApiKey",
          "pplx-key",
          "https://api.perplexity.ai/chat/completions",
          { choices: [] },
        ],
        [
          "parallel",
          "parallelApiKey",
          "parallel-key",
          "https://api.parallel.ai/v1/search",
          { results: [] },
        ],
        ["exa", "exaApiKey", "exa-key", "https://api.exa.ai/search", { results: [] }],
      ])(
        "routes %s to its direct endpoint (https://github.com/Brevilabs/obsidian-copilot-private/issues/285)",
        async (provider, keyField, key, url, responseBody) => {
          mockGetSettings.mockReturnValue(providerSettings(provider, { [keyField]: key }));
          mockJsonResponse(responseBody);

          await selfHostWebSearch("test");

          expect(mockFetch).toHaveBeenCalledWith(url, expect.any(Object));
        }
      );

      it("defaults to Firecrawl for an unknown provider", async () => {
        mockGetSettings.mockReturnValue(
          providerSettings("unknown-provider", { firecrawlApiKey: "fc-key" })
        );
        mockJsonResponse({ data: { web: [] } });

        await selfHostWebSearch("test");

        expect(mockFetch).toHaveBeenCalledWith(
          "https://api.firecrawl.dev/v2/search",
          expect.any(Object)
        );
      });
    });
  });
});
