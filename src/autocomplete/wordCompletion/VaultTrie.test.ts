import { VaultTrie } from "./VaultTrie";

describe("Word Completion - VaultTrie", () => {
  let trie: VaultTrie;

  beforeEach(() => {
    trie = new VaultTrie(1000);
  });

  describe("Core Functionality", () => {
    test("should add and retrieve words correctly", () => {
      trie.addWord("test", "context1");
      trie.addWord("example", "context2");

      expect(trie.hasWord("test")).toBe(true);
      expect(trie.hasWord("example")).toBe(true);
      expect(trie.hasWord("nonexistent")).toBe(false);
    });

    test("should respect minimum word length (4 characters)", () => {
      trie.addWord("a", "context1");
      trie.addWord("ab", "context1");
      trie.addWord("abc", "context1");
      trie.addWord("abcd", "context1");

      expect(trie.hasWord("a")).toBe(false);
      expect(trie.hasWord("ab")).toBe(false);
      expect(trie.hasWord("abc")).toBe(false);
      expect(trie.hasWord("abcd")).toBe(true);
    });

    test("should track word frequency and contexts", () => {
      trie.addWord("test", "context1");
      trie.addWord("test", "context2");
      trie.addWord("test", "context3");

      const entry = trie.getWordEntry("test");
      expect(entry?.frequency).toBe(3);
      expect(entry?.contexts).toHaveLength(3);
      expect(entry?.contexts).toContain("context1");
      expect(entry?.contexts).toContain("context2");
      expect(entry?.contexts).toContain("context3");
    });

    test("should limit context array size", () => {
      const word = "test";
      // Add more than 10 contexts
      for (let i = 0; i < 15; i++) {
        trie.addWord(word, `context${i}`);
      }

      const entry = trie.getWordEntry(word);
      expect(entry?.contexts.length).toBeLessThanOrEqual(10);
      expect(entry?.frequency).toBe(15);
    });
  });

  describe("Case-Sensitive Smart Matching (Main Bug Fix)", () => {
    beforeEach(() => {
      // Add the exact scenario from the original bug report
      trie.addWord("Combinator", "Y Combinator.md");
      trie.addWord("combinator", "programming.md");
      trie.addWord("COMBINATOR", "constants.md");
      trie.addWord("Combination", "math.md");
      trie.addWord("combination", "stats.md");
    });

    test("should find all case variants for lowercase prefix", () => {
      const suggestions = trie.getSuggestions("comb", 10);
      const words = suggestions.map((s) => s.word);

      // This was the original failing test - should find ALL case variants
      expect(words).toContain("combinator");
      expect(words).toContain("Combinator");
      expect(words).toContain("COMBINATOR");
      expect(words).toContain("combination");
      expect(words).toContain("Combination");
      expect(suggestions.length).toBe(5);
    });

    test("should prioritize exact case matches", () => {
      const suggestions = trie.getSuggestions("Comb", 10);

      const titleCaseCombinator = suggestions.find((s) => s.word === "Combinator");
      const lowerCaseCombinator = suggestions.find((s) => s.word === "combinator");

      expect(titleCaseCombinator).toBeDefined();
      expect(lowerCaseCombinator).toBeDefined();

      // Title case should have higher score due to exact case match
      expect(titleCaseCombinator!.score).toBeGreaterThan(lowerCaseCombinator!.score);
    });

    test("should prioritize uppercase matches for uppercase prefix", () => {
      const suggestions = trie.getSuggestions("COMB", 10);

      const upperSuggestion = suggestions.find((s) => s.word === "COMBINATOR");
      const lowerSuggestion = suggestions.find((s) => s.word === "combinator");

      expect(upperSuggestion).toBeDefined();
      expect(lowerSuggestion).toBeDefined();
      expect(upperSuggestion!.score).toBeGreaterThan(lowerSuggestion!.score);
    });

    test("should handle the original Y Combinator use case", () => {
      // This validates the original problem is solved
      const combSuggestions = trie.getSuggestions("comb", 10);
      expect(combSuggestions.length).toBeGreaterThan(0);
      expect(combSuggestions.map((s) => s.word)).toContain("Combinator");
    });
  });

  describe("Suggestions and Filtering", () => {
    beforeEach(() => {
      trie.addWord("combinator", "file1");
      trie.addWord("combination", "file2");
      trie.addWord("combine", "file3");
      trie.addWord("computer", "file4");
      trie.addWord("complete", "file5");
    });

    test("should find suggestions for prefix", () => {
      const suggestions = trie.getSuggestions("comb", 10);
      const words = suggestions.map((s) => s.word);

      expect(words).toContain("combinator");
      expect(words).toContain("combination");
      expect(words).toContain("combine");
      expect(words).not.toContain("computer");
      expect(words).not.toContain("complete");
    });

    test("should limit number of suggestions", () => {
      const suggestions = trie.getSuggestions("co", 2);
      expect(suggestions.length).toBeLessThanOrEqual(2);
    });

    test("should return empty array for non-matching prefix", () => {
      const suggestions = trie.getSuggestions("xyz", 10);
      expect(suggestions).toHaveLength(0);
    });

    test("should return empty array for empty prefix", () => {
      const suggestions = trie.getSuggestions("", 10);
      expect(suggestions).toHaveLength(0);
    });
  });

  describe("Scoring and Ranking", () => {
    test("should rank by frequency", () => {
      trie.addWord("frequent", "context1");
      trie.addWord("frequent", "context2");
      trie.addWord("frequent", "context3"); // frequency = 3

      trie.addWord("rare", "context1"); // frequency = 1

      const fSuggestions = trie.getSuggestions("f", 10);
      const rSuggestions = trie.getSuggestions("r", 10);

      const frequentSuggestion = fSuggestions.find((s) => s.word === "frequent");
      const rareSuggestion = rSuggestions.find((s) => s.word === "rare");

      expect(frequentSuggestion).toBeDefined();
      expect(rareSuggestion).toBeDefined();
      expect(frequentSuggestion!.score).toBeGreaterThan(rareSuggestion!.score);
    });

    test("should include case match bonus in scoring", () => {
      trie.addWord("Test", "context1");
      trie.addWord("test", "context1");

      const suggestions = trie.getSuggestions("Test", 10);
      const exactMatch = suggestions.find((s) => s.word === "Test");
      const caseMatch = suggestions.find((s) => s.word === "test");

      expect(exactMatch).toBeDefined();
      expect(caseMatch).toBeDefined();
      expect(exactMatch!.score).toBeGreaterThan(caseMatch!.score);
    });
  });

  describe("Case Variant Preservation", () => {
    beforeEach(() => {
      trie.addWord("test", "context1");
      trie.addWord("Test", "context2");
      trie.addWord("TEST", "context3");
    });

    test("should preserve all case variants", () => {
      const suggestions = trie.getSuggestions("te", 10);
      const words = suggestions.map((s) => s.word);

      // Should preserve all case variants (this was the bug)
      expect(words).toContain("test");
      expect(words).toContain("Test");
      expect(words).toContain("TEST");
      expect(suggestions.length).toBe(3);
    });

    test("should rank highest frequency variant first", () => {
      // Add different frequencies for each variant
      trie.addWord("test", "context1"); // frequency = 1
      trie.addWord("Test", "context2");
      trie.addWord("Test", "context3"); // frequency = 2
      trie.addWord("TEST", "context4"); // frequency = 1

      const suggestions = trie.getSuggestions("te", 10);
      const testSuggestion = suggestions.find((s) => s.word === "Test");
      const lowerSuggestion = suggestions.find((s) => s.word === "test");

      expect(testSuggestion).toBeDefined();
      expect(lowerSuggestion).toBeDefined();
      expect(testSuggestion!.score).toBeGreaterThan(lowerSuggestion!.score);
    });
  });

  describe("Utility Methods", () => {
    beforeEach(() => {
      trie.addWord("test", "context1");
      trie.addWord("example", "context2");
      trie.addWord("sample", "context3");
    });

    test("should get statistics", () => {
      const stats = trie.getStats();
      expect(stats.wordCount).toBe(3);
      expect(stats.nodeCount).toBeGreaterThan(0);
      expect(stats.maxDepth).toBeGreaterThan(0);
    });

    test("should clear all words", () => {
      expect(trie.hasWord("test")).toBe(true);
      trie.clear();
      expect(trie.hasWord("test")).toBe(false);
      expect(trie.getStats().wordCount).toBe(0);
    });

    test("should get all words", () => {
      const allWords = trie.getAllWords();
      expect(allWords).toHaveLength(3);
      expect(allWords.map((w) => w.word)).toContain("test");
      expect(allWords.map((w) => w.word)).toContain("example");
      expect(allWords.map((w) => w.word)).toContain("sample");
    });

    test("should add multiple words at once", () => {
      trie.clear();
      trie.addWords(["word1", "word2", "word3"], "batch_context");

      expect(trie.hasWord("word1")).toBe(true);
      expect(trie.hasWord("word2")).toBe(true);
      expect(trie.hasWord("word3")).toBe(true);
      expect(trie.getStats().wordCount).toBe(3);
    });
  });

  describe("Pruning", () => {
    test("should prune words by frequency", () => {
      // Add words with different frequencies
      trie.addWord("frequent", "context1");
      trie.addWord("frequent", "context2");
      trie.addWord("frequent", "context3"); // frequency = 3

      trie.addWord("rare", "context1"); // frequency = 1

      expect(trie.hasWord("frequent")).toBe(true);
      expect(trie.hasWord("rare")).toBe(true);

      // Prune words with frequency < 2
      const removedCount = trie.pruneByFrequency(2);

      expect(removedCount).toBe(1);
      expect(trie.hasWord("frequent")).toBe(true);
      expect(trie.hasWord("rare")).toBe(false);
    });
  });

  describe("Size Limits", () => {
    test("should respect maximum size limit", () => {
      const smallTrie = new VaultTrie(2);

      smallTrie.addWord("word1", "context1");
      smallTrie.addWord("word2", "context2");
      smallTrie.addWord("word3", "context3"); // Should be rejected

      expect(smallTrie.hasWord("word1")).toBe(true);
      expect(smallTrie.hasWord("word2")).toBe(true);
      expect(smallTrie.hasWord("word3")).toBe(false);
      expect(smallTrie.getStats().wordCount).toBe(2);
    });

    test("should allow updates to existing words even when at capacity", () => {
      const smallTrie = new VaultTrie(2);

      smallTrie.addWord("word1", "context1");
      smallTrie.addWord("word2", "context2");

      // This should work because word1 already exists
      smallTrie.addWord("word1", "context3");

      const entry = smallTrie.getWordEntry("word1");
      expect(entry?.frequency).toBe(2);
      expect(entry?.contexts).toContain("context1");
      expect(entry?.contexts).toContain("context3");
    });
  });

  describe("Edge Cases", () => {
    test("should handle empty strings and short words", () => {
      trie.addWord("", "context1");
      trie.addWord("a", "context2");
      trie.addWord("ab", "context3");
      trie.addWord("abc", "context4");

      expect(trie.hasWord("")).toBe(false);
      expect(trie.hasWord("a")).toBe(false);
      expect(trie.hasWord("ab")).toBe(false);
      expect(trie.hasWord("abc")).toBe(false);
      expect(trie.getStats().wordCount).toBe(0);
    });

    test("should handle special characters in words", () => {
      trie.addWord("test-word", "context1");
      trie.addWord("test_word", "context2");
      trie.addWord("test.word", "context3");

      expect(trie.hasWord("test-word")).toBe(true);
      expect(trie.hasWord("test_word")).toBe(true);
      expect(trie.hasWord("test.word")).toBe(true);
    });

    test("should handle unicode characters", () => {
      trie.addWord("café", "context1");
      trie.addWord("naïve", "context2");
      trie.addWord("résumé", "context3");

      expect(trie.hasWord("café")).toBe(true);
      expect(trie.hasWord("naïve")).toBe(true);
      expect(trie.hasWord("résumé")).toBe(true);
    });
  });
});
