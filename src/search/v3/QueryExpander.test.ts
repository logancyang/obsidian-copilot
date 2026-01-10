import { QueryExpander } from "./QueryExpander";

// Mock the settings module
jest.mock("@/settings/model", () => ({
  getSettings: jest.fn(() => ({ debug: false })),
}));

describe("QueryExpander", () => {
  let expander: QueryExpander;
  let mockChatModel: any;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Create mock chat model
    mockChatModel = {
      invoke: jest.fn(),
    };

    // Create expander with mock chat model getter
    expander = new QueryExpander({
      getChatModel: async () => mockChatModel,
    });
  });

  describe("expand", () => {
    it("should return empty result for empty query", async () => {
      const result = await expander.expand("");
      expect(result).toEqual({
        queries: [],
        salientTerms: [],
        originalQuery: "",
        expandedQueries: [],
        expandedTerms: [],
      });
    });

    it("should return empty result for whitespace query", async () => {
      const result = await expander.expand("   ");
      expect(result).toEqual({
        queries: [],
        salientTerms: [],
        originalQuery: "",
        expandedQueries: [],
        expandedTerms: [],
      });
    });

    it("should expand query with LLM and extract substantive terms from original query", async () => {
      mockChatModel.invoke.mockResolvedValue({
        content: `<queries>
<query>piano sheet music</query>
<query>musical notation for piano</query>
</queries>
<terms>
<term>piano</term>
<term>notes</term>
</terms>`,
      });

      const result = await expander.expand("find my piano notes");

      // Check queries
      expect(result.queries).toContain("find my piano notes");
      expect(result.queries).toContain("piano sheet music");
      expect(result.queries).toContain("musical notation for piano");

      // Check terms - should be from original query only
      expect(result.salientTerms).toContain("piano");
      expect(result.salientTerms).toContain("notes");
      // Should NOT contain terms from expanded queries
      expect(result.salientTerms).not.toContain("sheet");
      expect(result.salientTerms).not.toContain("music");
    });

    it("should keep hash-prefixed tags intact as salient terms", async () => {
      mockChatModel.invoke.mockResolvedValue({
        content: `<queries></queries><terms></terms>`,
      });

      const result = await expander.expand("status update for #ProjectAlpha #2024/Plan");

      expect(result.salientTerms).toEqual(expect.arrayContaining(["#projectalpha", "#2024/plan"]));
      expect(result.salientTerms).not.toContain("projectalpha");
      expect(result.salientTerms).not.toContain("2024/plan");
    });

    it("should keep standalone term when both tagged and untagged variants exist", async () => {
      mockChatModel.invoke.mockRejectedValue(new Error("LLM error"));

      const result = await expander.expand("#project project kickoff brief");

      expect(result.salientTerms).toEqual(
        expect.arrayContaining(["#project", "project", "kickoff", "brief"])
      );
    });

    it("should retain standalone term even when similar tag bodies appear multiple times", async () => {
      mockChatModel.invoke.mockRejectedValue(new Error("LLM error"));

      const result = await expander.expand("#project updates about project deadlines");

      // In fallback mode (LLM error), terms are extracted from original query
      // "about" is included because there's no stopword filtering in fallback
      expect(result.salientTerms).toEqual(
        expect.arrayContaining(["#project", "updates", "about", "project", "deadlines"])
      );
    });

    it("should limit variants to maxVariants", async () => {
      mockChatModel.invoke.mockResolvedValue({
        content: `<queries>
<query>variant1</query>
<query>variant2</query>
<query>variant3</query>
<query>variant4</query>
<query>variant5</query>
</queries>
<terms>
<term>term1</term>
</terms>`,
      });

      const expander = new QueryExpander({
        maxVariants: 2,
        getChatModel: async () => mockChatModel,
      });
      const result = await expander.expand("test");

      expect(result.queries).toEqual(["test", "variant1", "variant2"]);
    });

    it("should handle LLM timeout with fallback", async () => {
      // Mock slow LLM response
      mockChatModel.invoke.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ content: "slow" }), 1000))
      );

      const expander = new QueryExpander({
        timeout: 100,
        getChatModel: async () => mockChatModel,
      });
      const result = await expander.expand("search typescript interfaces");

      expect(result.queries).toEqual(["search typescript interfaces"]);
      expect(result.salientTerms).toContain("typescript");
      expect(result.salientTerms).toContain("interfaces");
    });

    it("should handle LLM errors gracefully", async () => {
      mockChatModel.invoke.mockRejectedValue(new Error("LLM error"));

      const result = await expander.expand("test error handling #Tagged");

      expect(result.queries).toEqual(["test error handling #Tagged"]);
      expect(result.salientTerms).toContain("test");
      expect(result.salientTerms).toContain("error");
      expect(result.salientTerms).toContain("handling");
      expect(result.salientTerms).toContain("#tagged");
    });

    it("should properly handle AbortController signal", async () => {
      // Mock LLM call to verify AbortController signal is passed
      let receivedSignal: AbortSignal | undefined;
      mockChatModel.invoke.mockImplementation(
        async (prompt: string, options?: { signal?: AbortSignal }) => {
          receivedSignal = options?.signal;
          return { content: "mocked response" };
        }
      );

      const expander = new QueryExpander({
        timeout: 10000, // Long timeout to ensure it doesn't trigger during tests
        getChatModel: async () => mockChatModel,
      });

      await expander.expand("test query");

      // Verify that the AbortSignal was passed to the LLM call
      expect(receivedSignal).toBeDefined();
      expect(receivedSignal).toBeInstanceOf(AbortSignal);
    });

    it("should cancel LLM request when timeout is reached", async () => {
      let isAborted = false;
      mockChatModel.invoke.mockImplementation(
        async (prompt: string, options?: { signal?: AbortSignal }) => {
          // Set up listener to detect when request is aborted
          options?.signal?.addEventListener("abort", () => {
            isAborted = true;
          });

          // Simulate slow response that should be aborted
          await new Promise((resolve) => setTimeout(resolve, 1000));

          // This should not complete due to timeout
          return { content: "slow response" };
        }
      );

      const expander = new QueryExpander({
        timeout: 100, // Short timeout to trigger abort
        getChatModel: async () => mockChatModel,
      });

      const result = await expander.expand("test timeout abort");

      // Should fallback due to timeout
      expect(result.queries).toEqual(["test timeout abort"]);
      expect(result.salientTerms).toContain("test");
      expect(result.salientTerms).toContain("timeout");
      expect(result.salientTerms).toContain("abort");

      // Give a moment for abort event to fire
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(isAborted).toBe(true);
    });

    it("should handle missing chat model", async () => {
      const expander = new QueryExpander({
        getChatModel: async () => null,
      });

      const result = await expander.expand("test model");

      expect(result.queries).toEqual(["test model"]);
      expect(result.salientTerms).toContain("test");
      expect(result.salientTerms).toContain("model");
    });

    it("should handle no chat model getter", async () => {
      const expander = new QueryExpander(); // No getChatModel provided

      const result = await expander.expand("test");

      expect(result.queries).toEqual(["test"]);
      expect(result.salientTerms).toContain("test");
    });

    it("should parse different response formats", async () => {
      // Test with new XML format (salient vs expanded separation)
      mockChatModel.invoke.mockResolvedValue({
        content: `<salient>
<term>test1</term>
</salient>
<queries>
<query>xml variant</query>
</queries>
<expanded>
<term>important</term>
<term>keyword</term>
</expanded>`,
      });
      let result = await expander.expand("test1");
      expect(result.queries).toContain("test1");
      expect(result.queries).toContain("xml variant");
      // salientTerms come from <salient> section (original query terms only)
      expect(result.salientTerms).toContain("test1");
      // expandedTerms come from <expanded> section (for recall)
      expect(result.expandedTerms).toContain("important");
      expect(result.expandedTerms).toContain("keyword");

      // Clear cache for next test
      expander.clearCache();

      // Test old <terms> format (backward compatibility - treats as expanded)
      mockChatModel.invoke.mockResolvedValue({
        content: `<queries>
<query>old format variant</query>
</queries>
<terms>
<term>related</term>
<term>term</term>
</terms>`,
      });
      result = await expander.expand("test2");
      expect(result.queries).toContain("test2");
      expect(result.queries).toContain("old format variant");
      // With old format, salientTerms fallback to extracting from original query
      expect(result.salientTerms).toContain("test2");
      // Old <terms> go to expandedTerms
      expect(result.expandedTerms).toContain("related");
      expect(result.expandedTerms).toContain("term");
    });

    it("should validate terms and filter action verbs", async () => {
      mockChatModel.invoke.mockResolvedValue({
        content: `<queries>
<query>typescript type definitions</query>
</queries>
<terms>
<term>typescript</term>
<term>interfaces</term>
<term>!</term>
<term>a</term>
</terms>`,
      });

      const result = await expander.expand("search typescript interfaces");

      // Valid terms should be included
      expect(result.salientTerms).toContain("typescript");
      expect(result.salientTerms).toContain("interfaces");
      // Invalid terms should be filtered
      expect(result.salientTerms).not.toContain("!"); // Special char only
      expect(result.salientTerms).not.toContain("a"); // Too short
    });

    it("should extract compound terms", async () => {
      const result = await expander.expand("machine-learning deep-learning");

      // Should extract both compound and split terms
      expect(result.salientTerms).toContain("machine-learning");
      expect(result.salientTerms).toContain("machine");
      expect(result.salientTerms).toContain("learning");
      expect(result.salientTerms).toContain("deep-learning");
      expect(result.salientTerms).toContain("deep");
    });

    it("should extract terms from original query when LLM provides none", async () => {
      mockChatModel.invoke.mockResolvedValue({
        content: `<queries>
<query>piano sheet music</query>
<query>musical notation</query>
</queries>
<terms>
</terms>`,
      });

      const result = await expander.expand("find piano notes");

      // Should extract terms from original query only
      expect(result.salientTerms).toContain("piano"); // From original
      expect(result.salientTerms).toContain("notes"); // From original
      // "find" should be excluded by the LLM prompt
      // Should NOT contain terms from expanded queries
      expect(result.salientTerms).not.toContain("sheet");
      expect(result.salientTerms).not.toContain("music");
      expect(result.salientTerms).not.toContain("musical");
      expect(result.salientTerms).not.toContain("notation");
    });

    it("should handle malformed LLM responses", async () => {
      // Test with null response
      mockChatModel.invoke.mockResolvedValue(null);
      let result = await expander.expand("test1");
      expect(result.queries).toEqual(["test1"]);
      expect(result.salientTerms.length).toBeGreaterThan(0);

      // Clear cache for next test
      expander.clearCache();

      // Test with undefined response
      mockChatModel.invoke.mockResolvedValue(undefined);
      result = await expander.expand("test2");
      expect(result.queries).toEqual(["test2"]);

      // Clear cache for next test
      expander.clearCache();

      // Test with empty object
      mockChatModel.invoke.mockResolvedValue({});
      result = await expander.expand("test3");
      expect(result.queries).toEqual(["test3"]);
    });
  });

  describe("caching", () => {
    it("should cache expansion results", async () => {
      mockChatModel.invoke.mockResolvedValue({
        content: `<queries>
<query>variant1</query>
</queries>
<terms>
<term>term1</term>
</terms>`,
      });

      // First call
      await expander.expand("test");
      expect(mockChatModel.invoke).toHaveBeenCalledTimes(1);

      // Second call should use cache
      const result = await expander.expand("test");
      expect(mockChatModel.invoke).toHaveBeenCalledTimes(1);
      expect(result.queries).toContain("test");
      expect(result.queries).toContain("variant1");
    });

    it("should evict old cache entries when full", async () => {
      const expander = new QueryExpander({
        cacheSize: 2,
        getChatModel: async () => mockChatModel,
      });

      mockChatModel.invoke.mockImplementation((prompt: string) => {
        const query = prompt.match(/"([^"]+)"/)?.[1] || "";
        return { content: `QUERIES:\n- ${query}_variant` };
      });

      await expander.expand("query1");
      await expander.expand("query2");
      expect(expander.getCacheSize()).toBe(2);

      await expander.expand("query3");
      expect(expander.getCacheSize()).toBe(2);

      // query1 should be evicted, so it will call LLM again
      mockChatModel.invoke.mockClear();
      await expander.expand("query1");
      expect(mockChatModel.invoke).toHaveBeenCalled();
    });

    it("should clear cache on demand", () => {
      expander.clearCache();
      expect(expander.getCacheSize()).toBe(0);
    });
  });

  describe("configuration", () => {
    it("should use custom options", async () => {
      const expander = new QueryExpander({
        maxVariants: 3,
        timeout: 200,
        cacheSize: 50,
        getChatModel: async () => mockChatModel,
      });

      mockChatModel.invoke.mockResolvedValue({
        content: `QUERIES:
- v1
- v2
- v3
- v4
- v5`,
      });

      const result = await expander.expand("test");
      expect(result.queries).toEqual(["test", "v1", "v2", "v3"]);
    });

    it("should use default options when not provided", () => {
      const expander = new QueryExpander({
        getChatModel: async () => mockChatModel,
      });
      expect(expander.getCacheSize()).toBe(0);
    });
  });

  describe("backward compatibility", () => {
    it("should support expandQueries method", async () => {
      mockChatModel.invoke.mockResolvedValue({
        content: `QUERIES:
- variant1
- variant2`,
      });

      const queries = await expander.expandQueries("test");
      expect(queries).toContain("test");
      expect(queries).toContain("variant1");
      expect(queries).toContain("variant2");
    });
  });
});
