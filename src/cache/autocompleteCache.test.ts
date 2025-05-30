import { AutocompleteCache } from "./autocompleteCache";

describe("AutocompleteCache", () => {
  let cache: AutocompleteCache;

  beforeEach(() => {
    cache = AutocompleteCache.getInstance();
    cache.clear(); // Start with a clean cache for each test
  });

  describe("Basic cache operations", () => {
    test("should store and retrieve values", () => {
      const key = "test-key";
      const value = { response: "test response" };

      cache.set(key, value);
      const retrieved = cache.get(key);

      expect(retrieved).toEqual(value);
    });

    test("should return undefined for non-existent keys", () => {
      const retrieved = cache.get("non-existent-key");
      expect(retrieved).toBeUndefined();
    });

    test("should clear all cached values", () => {
      cache.set("key1", "value1");
      cache.set("key2", "value2");

      cache.clear();

      expect(cache.get("key1")).toBeUndefined();
      expect(cache.get("key2")).toBeUndefined();
    });
  });

  describe("Cache key generation", () => {
    test("should generate consistent sentence keys", () => {
      const prefix = "Hello world";
      const noteContext = "Some note context";
      const relevantNotes = "Relevant notes content";

      const key1 = cache.generateSentenceKey(prefix, noteContext, relevantNotes);
      const key2 = cache.generateSentenceKey(prefix, noteContext, relevantNotes);

      expect(key1).toBe(key2);
      expect(key1).toContain("sentence:");
    });

    test("should generate different sentence keys for different inputs", () => {
      const key1 = cache.generateSentenceKey("prefix1", "context1", "notes1");
      const key2 = cache.generateSentenceKey("prefix2", "context2", "notes2");

      expect(key1).not.toBe(key2);
    });

    test("should generate consistent word keys", () => {
      const contextPrefix = "Hello wo";
      const contextSuffix = "rld";
      const suggestionWords = ["world", "work", "word"];

      const key1 = cache.generateWordKey(contextPrefix, contextSuffix, suggestionWords);
      const key2 = cache.generateWordKey(contextPrefix, contextSuffix, suggestionWords);

      expect(key1).toBe(key2);
      expect(key1).toContain("word:");
    });

    test("should generate different word keys for different inputs", () => {
      const key1 = cache.generateWordKey("prefix1", "suffix1", ["word1"]);
      const key2 = cache.generateWordKey("prefix2", "suffix2", ["word2"]);

      expect(key1).not.toBe(key2);
    });
  });

  describe("TTL (Time To Live)", () => {
    test("should expire entries after TTL", async () => {
      // Create a cache with very short TTL for testing
      const shortTtlCache = new (AutocompleteCache as any)();
      shortTtlCache.ttlMs = 10; // 10ms TTL

      const key = "test-key";
      const value = "test-value";

      shortTtlCache.set(key, value);

      // Should be available immediately
      expect(shortTtlCache.get(key)).toBe(value);

      // Wait for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 20));

      // Should be expired now
      expect(shortTtlCache.get(key)).toBeUndefined();
    });
  });

  describe("Cache size limits", () => {
    test("should respect max size limit", () => {
      // Create a cache with small max size for testing
      const smallCache = new (AutocompleteCache as any)();
      smallCache.maxSize = 2;

      smallCache.set("key1", "value1");
      smallCache.set("key2", "value2");
      smallCache.set("key3", "value3"); // This should evict key1

      expect(smallCache.get("key1")).toBeUndefined(); // Evicted
      expect(smallCache.get("key2")).toBe("value2");
      expect(smallCache.get("key3")).toBe("value3");
    });
  });

  describe("Cache statistics", () => {
    test("should return correct cache stats", () => {
      cache.set("key1", "value1");
      cache.set("key2", "value2");

      const stats = cache.getStats();

      expect(stats.size).toBe(2);
      expect(stats.maxSize).toBe(200);
      expect(stats.ttlMs).toBe(10 * 60 * 1000); // 10 minutes
    });
  });

  describe("Real-world scenarios", () => {
    test("should cache word completion responses", () => {
      const contextPrefix = "Hello wo";
      const contextSuffix = "rld, how are you?";
      const suggestionWords = ["world", "work", "word"];
      const response = { response: { selected_word: "world" } };

      const key = cache.generateWordKey(contextPrefix, contextSuffix, suggestionWords);
      cache.set(key, response);

      const cached = cache.get(key);
      expect(cached).toEqual(response);
    });

    test("should cache sentence completion responses", () => {
      const prefix = "The weather today is ";
      const noteContext = "Weather notes and context";
      const relevantNotes = "Related weather information";
      const response = { response: { completion: "quite pleasant and sunny." } };

      const key = cache.generateSentenceKey(prefix, noteContext, relevantNotes);
      cache.set(key, response);

      const cached = cache.get(key);
      expect(cached).toEqual(response);
    });
  });
});
