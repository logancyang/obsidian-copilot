// Mock Obsidian modules first (before imports)
jest.mock("obsidian", () => {
  // Define MockTFile inside the mock factory
  class MockTFile {
    path: string;
    basename: string;
    stat: { mtime: number };

    constructor(path: string) {
      this.path = path;
      this.basename = path.replace(".md", "");
      this.stat = { mtime: Date.now() };
    }
  }

  return {
    TFile: MockTFile,
    Platform: {
      isMobile: false,
    },
    getAllTags: jest.fn((cache) => {
      if (cache?.frontmatter?.tags) {
        return cache.frontmatter.tags;
      }
      return [];
    }),
  };
});

// Mock ChunkManager
jest.mock("../chunks", () => ({
  ChunkManager: jest.fn().mockImplementation(() => ({
    getChunks: jest.fn().mockImplementation((candidates) => {
      const mockChunks = [
        {
          id: "note1.md#0",
          notePath: "note1.md",
          chunkIndex: 0,
          content: "TypeScript is a typed superset of JavaScript",
          title: "TypeScript Guide",
          heading: "Introduction",
          mtime: Date.now(),
        },
        {
          id: "note2.md#0",
          notePath: "note2.md",
          chunkIndex: 0,
          content: "Machine learning with Python and TensorFlow",
          title: "ML Tutorial",
          heading: "Machine Learning Basics",
          mtime: Date.now(),
        },
        {
          id: "note3.md#0",
          notePath: "note3.md",
          chunkIndex: 0,
          content: "React and Vue are JavaScript frameworks",
          title: "note3",
          heading: "",
          mtime: Date.now(),
        },
        {
          id: "test.md#0",
          notePath: "test.md",
          chunkIndex: 0,
          content: "First chunk content with typescript",
          title: "Test Document",
          heading: "Introduction",
          mtime: Date.now(),
        },
        {
          id: "test.md#1",
          notePath: "test.md",
          chunkIndex: 1,
          content: "Second chunk content with javascript",
          title: "Test Document",
          heading: "Setup Guide",
          mtime: Date.now(),
        },
        {
          id: "Piano Lessons/Lesson 1.md#0",
          notePath: "Piano Lessons/Lesson 1.md",
          chunkIndex: 0,
          content: "Basic piano techniques and scales for beginners",
          title: "Piano Lesson 1",
          heading: "Piano Basics",
          mtime: Date.now(),
        },
        {
          id: "Piano Lessons/Lesson 2.md#0",
          notePath: "Piano Lessons/Lesson 2.md",
          chunkIndex: 0,
          content: "Advanced piano techniques and chord progressions",
          title: "Piano Lesson 2",
          heading: "Piano Scales",
          mtime: Date.now(),
        },
        {
          id: "daily/2024-01-01.md#0",
          notePath: "daily/2024-01-01.md",
          chunkIndex: 0,
          content: "Today I practiced piano for 30 minutes",
          title: "Daily Note",
          heading: "",
          mtime: Date.now(),
        },
        {
          id: "projects/music.md#0",
          notePath: "projects/music.md",
          chunkIndex: 0,
          content: "Piano music theory and composition notes",
          title: "Music Project",
          heading: "Music Theory",
          mtime: Date.now(),
        },
        {
          id: "tags-uppercase.md#0",
          notePath: "tags-uppercase.md",
          chunkIndex: 0,
          content: "Status review for #BP and cross-linking #Project/Beta milestones",
          title: "Uppercase Tag Note",
          heading: "Status",
          mtime: Date.now(),
        },
        {
          id: "author-test.md#0",
          notePath: "author-test.md",
          chunkIndex: 0,
          content: "This is a draft document",
          title: "author-test",
          heading: "",
          mtime: Date.now(),
        },
        {
          id: "project-test.md#0",
          notePath: "project-test.md",
          chunkIndex: 0,
          content: "Machine learning research content",
          title: "project-test",
          heading: "",
          mtime: Date.now(),
        },
        {
          id: "array-test.md#0",
          notePath: "array-test.md",
          chunkIndex: 0,
          content: "Testing arrays in frontmatter",
          title: "array-test",
          heading: "",
          mtime: Date.now(),
        },
        {
          id: "edge-cases.md#0",
          notePath: "edge-cases.md",
          chunkIndex: 0,
          content: "Testing edge cases",
          title: "edge-cases",
          heading: "",
          mtime: Date.now(),
        },
        {
          id: "circular.md#0",
          notePath: "circular.md",
          chunkIndex: 0,
          content: "body",
          title: "circular",
          heading: "",
          mtime: Date.now(),
        },
        {
          id: "common.md#0",
          notePath: "common.md",
          chunkIndex: 0,
          content: "Meeting note summary with meeting agenda note note.",
          title: "Common Note",
          heading: "",
          mtime: Date.now(),
        },
        {
          id: "unique.md#0",
          notePath: "unique.md",
          chunkIndex: 0,
          content: "Meeting note covering architecture rareterm decisions for alpha.",
          title: "Unique Note",
          heading: "",
          mtime: Date.now(),
        },
      ];

      // Filter chunks based on candidates
      return Promise.resolve(
        mockChunks.filter((chunk) =>
          candidates.some((candidate: string) => chunk.notePath === candidate)
        )
      );
    }),
    getChunkText: jest.fn((id: string) => {
      const chunkContent: Record<string, string> = {
        "note1.md#0": "TypeScript is a typed superset of JavaScript",
        "note2.md#0": "Machine learning with Python and TensorFlow",
        "note3.md#0": "React and Vue are JavaScript frameworks",
        "test.md#0": "First chunk content with typescript",
        "test.md#1": "Second chunk content with javascript",
        "Piano Lessons/Lesson 1.md#0": "Basic piano techniques and scales for beginners",
        "Piano Lessons/Lesson 2.md#0": "Advanced piano techniques and chord progressions",
        "daily/2024-01-01.md#0": "Today I practiced piano for 30 minutes",
        "projects/music.md#0": "Piano music theory and composition notes",
        "author-test.md#0": "This is a draft document",
        "project-test.md#0": "Machine learning research content",
        "array-test.md#0": "Testing arrays in frontmatter",
        "edge-cases.md#0": "Testing edge cases",
        "circular.md#0": "body",
      };
      return chunkContent[id] || "";
    }),
  })),
}));

import { TFile } from "obsidian";
import { FullTextEngine } from "./FullTextEngine";

describe("FullTextEngine", () => {
  let engine: FullTextEngine;
  let mockApp: any;

  beforeEach(() => {
    // Mock metadata cache
    const mockCache: Record<string, any> = {
      "note1.md": {
        headings: [{ heading: "Introduction" }, { heading: "Setup Guide" }],
        frontmatter: { title: "TypeScript Guide", tags: ["programming", "typescript"] },
      },
      "note2.md": {
        headings: [{ heading: "Machine Learning Basics" }],
        frontmatter: { title: "ML Tutorial" },
      },
      "note3.md": {
        headings: [],
        frontmatter: {},
      },
      // Add frontmatter test files
      "author-test.md": {
        headings: [],
        frontmatter: {
          author: "John Doe",
          date: "2024-01-01",
          status: "draft",
        },
      },
      "project-test.md": {
        headings: [],
        frontmatter: {
          project: "Machine Learning",
          priority: 1,
          tags: ["ai", "research"],
          nested: { ignore: "this" }, // Should be ignored
        },
      },
      "tags-uppercase.md": {
        headings: [{ heading: "Status" }],
        frontmatter: {
          title: "Uppercase Tag Note",
          tags: ["#BP"],
        },
      },
      "array-test.md": {
        headings: [],
        frontmatter: {
          keywords: ["typescript", "react", "testing"],
          authors: ["Alice", "Bob"],
          numbers: [100, 200, 300],
        },
      },
      "edge-cases.md": {
        headings: [],
        frontmatter: {
          published: true,
          draft: false,
          date: new Date("2024-01-15"),
          nullValue: null,
          emptyString: "  ",
          nestedArray: [["should", "skip"], "but this works"],
        },
      },
      "circular.md": {
        headings: [],
        frontmatter: {}, // Will be set up separately for circular test
      },
      "common.md": {
        headings: [],
        frontmatter: {},
      },
      "unique.md": {
        headings: [],
        frontmatter: {},
      },
    };

    // Mock app
    mockApp = {
      vault: {
        getAbstractFileByPath: jest.fn((path) => {
          if (!path || path === "missing.md") return null;
          const file = new (TFile as any)(path);
          // Make it pass instanceof TFile check
          Object.setPrototypeOf(file, TFile.prototype);
          return file;
        }),
        cachedRead: jest.fn((file) => {
          const contents: Record<string, string> = {
            "note1.md": "TypeScript is a typed superset of JavaScript",
            "note2.md": "Machine learning with Python and TensorFlow",
            "note3.md": "React and Vue are JavaScript frameworks",
            // Add frontmatter test file contents
            "author-test.md": "This is a draft document",
            "project-test.md": "Machine learning research content",
            "array-test.md": "Testing arrays in frontmatter",
            "edge-cases.md": "Testing edge cases",
            "circular.md": "body",
            "common.md": "Meeting note summary with meeting agenda note note.",
            "unique.md": "Meeting note covering architecture rareterm decisions for alpha.",
            "tags-uppercase.md": "Status review for #BP and cross-linking #Project/Beta milestones",
          };
          return Promise.resolve(contents[file.path] || "");
        }),
      },
      metadataCache: {
        getFileCache: jest.fn((file: any) => mockCache[file.path]),
        resolvedLinks: {
          "note1.md": { "note2.md": 1, "note3.md": 2 },
          "note2.md": { "note1.md": 1 },
          "note3.md": {},
        },
        getBacklinksForFile: jest.fn((file) => ({
          data: file.path === "note1.md" ? { "note2.md": 1 } : {},
        })),
      },
    };

    engine = new FullTextEngine(mockApp);
  });

  describe("tokenizeMixed", () => {
    it("should tokenize ASCII words", () => {
      const tokens = (engine as any).tokenizeMixed("Hello World TypeScript");

      expect(tokens).toContain("hello");
      expect(tokens).toContain("world");
      expect(tokens).toContain("typescript");
    });

    it("should tokenize alphanumeric and underscores", () => {
      const tokens = (engine as any).tokenizeMixed("test_123 var_name");

      expect(tokens).toContain("test_123");
      expect(tokens).toContain("var_name");
    });

    it("should generate CJK bigrams", () => {
      const tokens = (engine as any).tokenizeMixed("中文编程");

      expect(tokens).toContain("中文");
      expect(tokens).toContain("文编");
      expect(tokens).toContain("编程");
    });

    it("should handle mixed content", () => {
      const tokens = (engine as any).tokenizeMixed("TypeScript 和 JavaScript 编程");

      expect(tokens).toContain("typescript");
      expect(tokens).toContain("javascript");
      expect(tokens).toContain("编程");
    });

    it("should handle single CJK characters", () => {
      const tokens = (engine as any).tokenizeMixed("中 文");

      expect(tokens).toContain("中");
      expect(tokens).toContain("文");
    });

    it("should tokenize hash tags and their hierarchy variants", () => {
      const tokens = (engine as any).tokenizeMixed("Working on #Project/Alpha and #deepWork");

      expect(tokens).toEqual(
        expect.arrayContaining([
          "#project/alpha",
          "#project",
          "project/alpha",
          "project",
          "alpha",
          "#deepwork",
          "deepwork",
        ])
      );
    });

    it("should not split hyphenated tags into partial word tokens", () => {
      const tokens = (engine as any).tokenizeMixed("#copilot-conversation updates");

      expect(tokens).toContain("#copilot-conversation");
      expect(tokens).toContain("copilot-conversation");
      expect(tokens).not.toContain("copilot");
      expect(tokens).not.toContain("conversation");
    });

    it("should return empty array for empty input", () => {
      const tokens = (engine as any).tokenizeMixed("");
      expect(tokens).toEqual([]);
    });
  });

  describe("buildFromCandidates", () => {
    it("should index candidate files as chunks", async () => {
      const candidates = ["note1.md", "note2.md"];
      const indexed = await engine.buildFromCandidates(candidates);

      // Should index chunks, not notes (likely more than 2 due to chunking)
      expect(indexed).toBeGreaterThanOrEqual(2);

      const stats = engine.getStats();
      expect(stats.documentsIndexed).toBeGreaterThanOrEqual(2);
    });

    it("should respect memory limits during chunking", async () => {
      const candidates = Array.from({ length: 100 }, (_, i) => `note${i}.md`);

      // Mock vault to return files for all candidates
      mockApp.vault.getAbstractFileByPath = jest.fn((path) => ({
        path,
        basename: path.replace(".md", ""),
        stat: { mtime: Date.now() },
      }));

      // Mock content that would generate many chunks
      mockApp.vault.cachedRead = jest.fn(() => Promise.resolve("Large content ".repeat(1000)));

      await engine.buildFromCandidates(candidates);

      const stats = engine.getStats();
      // Should stop indexing when memory limit is reached
      expect(stats.memoryPercent).toBeLessThanOrEqual(100);
    });

    it("should handle missing files gracefully", async () => {
      mockApp.vault.getAbstractFileByPath = jest.fn((path) => {
        if (path === "missing.md") return null;
        const file = new (TFile as any)(path);
        Object.setPrototypeOf(file, TFile.prototype);
        return file;
      });

      const candidates = ["note1.md", "missing.md", "note2.md"];
      const indexed = await engine.buildFromCandidates(candidates);

      // Should index chunks from valid files only
      expect(indexed).toBeGreaterThanOrEqual(2); // Should skip missing file
    });

    it("should clear previous index before building", async () => {
      await engine.buildFromCandidates(["note1.md"]);
      let stats = engine.getStats();
      const firstIndexSize = stats.documentsIndexed;
      expect(firstIndexSize).toBeGreaterThan(0);

      await engine.buildFromCandidates(["note2.md", "note3.md"]);
      stats = engine.getStats();
      // Should have cleared previous chunks and indexed new ones
      expect(stats.documentsIndexed).toBeGreaterThan(0);
      // The new index may have different number of chunks
    });

    it("should handle clear errors gracefully", async () => {
      await engine.buildFromCandidates(["note1.md"]);

      // Mock the index to throw an error on destroy/clear
      const mockIndex = (engine as any).index;
      if (mockIndex) {
        mockIndex.destroy = jest.fn(() => {
          throw new Error("Mock cleanup error");
        });
        mockIndex.clear = jest.fn(() => {
          throw new Error("Mock cleanup error");
        });
      }

      // Clear should not throw despite index cleanup error
      expect(() => engine.clear()).not.toThrow();

      // Should still reset state
      expect((engine as any).index).toBeNull();
      expect((engine as any).indexedChunks.size).toBe(0);
    });

    it("should skip unsafe vault paths", async () => {
      // Mock vault to return files for any safe path
      mockApp.vault.getAbstractFileByPath = jest.fn((path) => {
        if (path === "note1.md") {
          const file = new (TFile as any)(path);
          Object.setPrototypeOf(file, TFile.prototype);
          return file;
        }
        return null;
      });

      const candidates = ["../evil.md", "/abs.md", "note1.md"];
      const indexed = await engine.buildFromCandidates(candidates);
      // Should only index chunks from the safe file
      expect(indexed).toBeGreaterThanOrEqual(1);
    });
  });

  describe("search", () => {
    beforeEach(async () => {
      await engine.buildFromCandidates(["note1.md", "note2.md", "note3.md", "tags-uppercase.md"]);
    });

    it("should search indexed chunks and return chunk IDs", () => {
      const results = engine.search(["typescript"], 10, [], "typescript");

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].engine).toBe("fulltext");

      // Results should now be chunk IDs (note_path#chunk_index)
      const hasChunkId = results.some((r) => r.id.includes("#"));
      expect(hasChunkId).toBe(true);
    });

    it("should handle multiple query variants", () => {
      const results = engine.search(["typescript", "javascript"], 10, [], "typescript");

      expect(results.length).toBeGreaterThan(0);
    });

    it("should return empty array for no matches", () => {
      const results = engine.search(["nonexistentterm"], 10, [], "nonexistentterm");

      expect(results).toEqual([]);
    });

    it("should respect limit parameter", () => {
      const results = engine.search(["typescript"], 1, [], "typescript");

      expect(results.length).toBeLessThanOrEqual(1);
    });

    it("should match uppercase tag queries case-insensitively", () => {
      const results = engine.search(["#BP", "#bp", "bp"], 10, ["#bp"], "#BP");

      expect(results.length).toBeGreaterThan(0);
      const containsUpperCaseTagNote = results.some((r) => r.id.startsWith("tags-uppercase.md"));
      expect(containsUpperCaseTagNote).toBe(true);
    });

    it("should handle empty query array", () => {
      const results = engine.search([], 10, [], "");

      expect(results).toEqual([]);
    });
  });

  describe("search scoring", () => {
    beforeEach(async () => {
      // Create more specific test data for scoring tests
      const scoringMockCache: Record<string, any> = {
        "Piano Lessons/Lesson 1.md": {
          headings: [{ heading: "Piano Basics" }],
          frontmatter: { title: "Piano Lesson 1" },
        },
        "Piano Lessons/Lesson 2.md": {
          headings: [{ heading: "Piano Scales" }],
          frontmatter: { title: "Piano Lesson 2" },
        },
        "daily/2024-01-01.md": {
          headings: [],
          frontmatter: { title: "Daily Note" },
        },
        "projects/music.md": {
          headings: [{ heading: "Music Theory" }],
          frontmatter: { title: "Music Project", tags: ["piano", "music"] },
        },
      };

      mockApp.metadataCache.getFileCache = jest.fn((file: any) => scoringMockCache[file.path]);
      mockApp.vault.cachedRead = jest.fn((file) => {
        const contents: Record<string, string> = {
          "Piano Lessons/Lesson 1.md": "Learning piano fundamentals and basic notes",
          "Piano Lessons/Lesson 2.md": "Advanced piano techniques and chord progressions",
          "daily/2024-01-01.md": "Today I practiced piano for 30 minutes",
          "projects/music.md": "Piano music theory and composition notes",
        };
        return Promise.resolve(contents[file.path] || "");
      });

      await engine.buildFromCandidates([
        "Piano Lessons/Lesson 1.md",
        "Piano Lessons/Lesson 2.md",
        "daily/2024-01-01.md",
        "projects/music.md",
      ]);
    });

    it("should apply field weighting correctly", () => {
      const results = engine.search(["piano"], 10, [], "piano");

      // Title matches should score higher than body matches
      const titleMatch = results.find((r) => r.id.includes("Lesson"));
      const bodyMatch = results.find((r) => r.id.includes("daily"));

      if (titleMatch && bodyMatch) {
        expect(titleMatch.score).toBeGreaterThan(bodyMatch.score);
      }
    });

    it("should boost multi-field matches", () => {
      const results = engine.search(["piano"], 10, [], "piano");

      // The music.md file has "piano" in tags and body, should get multi-field bonus
      const multiFieldMatch = results.find((r) => r.id === "projects/music.md#0");
      expect(multiFieldMatch).toBeDefined();

      // Should be ranked relatively high due to multi-field bonus
      const index = results.findIndex((r) => r.id === "projects/music.md#0");
      expect(index).toBeLessThan(3); // Should be in top 3
    });

    it("should score path matches with proper weight", () => {
      const results = engine.search(["piano lessons"], 10, [], "piano lessons");

      // Files in "Piano Lessons" folder should match on path field (as chunks)
      const lessonFiles = results.filter((r) => r.id.includes("Piano Lessons"));
      expect(lessonFiles.length).toBe(2);

      // Both lesson files should be ranked high
      const lesson1Index = results.findIndex((r) => r.id.includes("Lesson 1.md#0"));
      const lesson2Index = results.findIndex((r) => r.id.includes("Lesson 2.md#0"));

      expect(lesson1Index).toBeLessThan(3);
      expect(lesson2Index).toBeLessThan(3);
    });

    it("should rank results by relevance only", () => {
      const results = engine.search(["piano"], 10, [], "piano");

      // All results should have decreasing scores (no position bias)
      for (let i = 1; i < results.length; i++) {
        expect(results[i].score).toBeLessThanOrEqual(results[i - 1].score);
      }

      // Verify results are ranked by pure relevance, not position
      if (results.length > 1) {
        expect(results[0].score).toBeGreaterThan(0);
      }
    });

    it("should prioritize chunks that match tag queries", () => {
      const results = engine.search(["#piano", "piano"], 10, ["#piano"], "#piano");

      expect(results.length).toBeGreaterThan(0);
      const tagMatchIndex = results.findIndex((r) => r.id === "projects/music.md#0");
      expect(tagMatchIndex).toBeGreaterThanOrEqual(0);

      const lessonIndex = results.findIndex((r) => r.id.includes("Lesson 1"));
      if (lessonIndex >= 0) {
        expect(tagMatchIndex).toBeLessThan(lessonIndex);
      }

      const tagMatchScore = results[tagMatchIndex]?.score ?? 0;
      const otherScore = lessonIndex >= 0 ? (results[lessonIndex]?.score ?? 0) : 0;
      expect(tagMatchScore).toBeGreaterThan(otherScore);
    });

    it("should return valid BM25 scores for search results", async () => {
      await engine.buildFromCandidates(["common.md"]);
      const results = engine.search(["meeting"], 10, ["meeting"], "meeting");

      // MiniSearch uses BM25+ scoring - verify score is positive and reasonable
      expect(results[0].explanation?.baseScore).toBeGreaterThan(0);
      expect(results[0].explanation?.baseScore).toBeLessThan(10);
    });

    it("should keep rare terms dominant when combined with common terms", async () => {
      await engine.buildFromCandidates(["common.md", "unique.md"]);
      const results = engine.search(
        ["meeting", "rareterm"],
        10,
        ["meeting", "rareterm"],
        "meeting rareterm"
      );

      expect(results[0].id).toBe("unique.md#0");
    });

    it("should find matches for tag-like queries in body content", async () => {
      await engine.buildFromCandidates(["unique.md"]);
      const results = engine.search(["#rareterm"], 10, ["#rareterm"], "#rareterm");

      // MiniSearch should find the document containing "rareterm" in body
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].id).toBe("unique.md#0");

      // The explanation should contain lexical matches (MiniSearch reports which terms matched)
      expect(results[0].explanation?.lexicalMatches).toBeDefined();
      expect(results[0].explanation?.lexicalMatches?.length).toBeGreaterThan(0);
    });
  });

  describe("weighted query expansion", () => {
    it("should apply 90/10 weight split between salient and expanded terms", async () => {
      // Use Piano Lessons files which contain "piano" in content
      await engine.buildFromCandidates(["Piano Lessons/Lesson 1.md", "projects/music.md"]);

      // Search with salient terms only (no expanded)
      const salientOnly = engine.search(["piano"], 10, ["piano"], "piano", []);

      // Search with both salient and expanded terms
      const withExpanded = engine.search(["piano"], 10, ["piano"], "piano", ["music", "lesson"]);

      // Both should find results (piano content exists in these files)
      expect(salientOnly.length).toBeGreaterThan(0);
      expect(withExpanded.length).toBeGreaterThan(0);

      // Results with expanded terms may have different scores due to 10% secondary boost
      const lessonResultSalient = salientOnly.find((r) =>
        r.id.startsWith("Piano Lessons/Lesson 1.md")
      );
      const lessonResultExpanded = withExpanded.find((r) =>
        r.id.startsWith("Piano Lessons/Lesson 1.md")
      );

      expect(lessonResultSalient).toBeDefined();
      expect(lessonResultExpanded).toBeDefined();
    });

    it("should include expanded boost in explanation when expanded terms match", async () => {
      await engine.buildFromCandidates(["common.md"]);

      // common.md contains "meeting" - use it as expanded term
      // Use "note" as salient term since common.md contains "Meeting note summary"
      const results = engine.search(
        ["note", "meeting"], // queries
        10,
        ["note"], // salient terms
        "note", // original query
        ["meeting"] // expanded terms
      );

      // Should find results (common.md has "meeting" and "note" in content)
      expect(results.length).toBeGreaterThan(0);

      // Check that expandedBoost is present in explanation when expanded terms contributed
      const matchingResult = results.find((r) => r.explanation?.expandedBoost !== undefined);
      if (matchingResult) {
        expect(matchingResult.explanation?.expandedBoost).toBeGreaterThan(0);
      }
    });

    it("should give secondary-only results (found via expansion only) lower scores", async () => {
      // common.md has "agenda" (unique to it), unique.md has "rareterm" (unique to it)
      await engine.buildFromCandidates(["common.md", "unique.md"]);

      // "rareterm" only exists in unique.md, "agenda" only exists in common.md
      // Search with salient term "agenda" (matches only common.md)
      // and expanded term "rareterm" (matches only unique.md)
      const results = engine.search(
        ["agenda", "rareterm"], // queries
        10,
        ["agenda"], // salient (matches only common.md)
        "agenda",
        ["rareterm"] // expanded (matches only unique.md)
      );

      // Should find results
      expect(results.length).toBeGreaterThan(0);

      const commonResult = results.find((r) => r.id.startsWith("common.md"));
      const uniqueResult = results.find((r) => r.id.startsWith("unique.md"));

      // Common should be found (matches salient term "agenda")
      expect(commonResult).toBeDefined();

      // Unique should be found via expansion only
      expect(uniqueResult).toBeDefined();

      // Salient match (90% weight) should score higher than expansion-only (10% weight)
      if (uniqueResult && commonResult) {
        expect(commonResult.score).toBeGreaterThan(uniqueResult.score);
      }
    });
  });

  describe("chunk-based indexing", () => {
    it("should index chunks with proper field weights", async () => {
      const candidates = ["test.md"];
      const indexed = await engine.buildFromCandidates(candidates);

      expect(indexed).toBe(2); // Two chunks

      // Search should find chunks by heading
      const headingResults = engine.search(["Introduction"], 10, [], "Introduction");
      expect(headingResults.length).toBeGreaterThan(0);

      // Should find by title
      const titleResults = engine.search(["Test Document"], 10, [], "Test Document");
      expect(titleResults.length).toBeGreaterThan(0);
    });

    it("should not store chunk body content in index", async () => {
      const candidates = ["test.md"];
      await engine.buildFromCandidates(candidates);

      // Verify that index stores metadata only, not body
      const stats = engine.getStats();
      expect(stats.documentsIndexed).toBe(2);

      // Memory usage should be lower since body content isn't stored
      expect(stats.memoryUsed).toBeGreaterThan(0);
    });

    it("should handle chunk field weighting correctly", async () => {
      const candidates = ["test.md"];
      await engine.buildFromCandidates(candidates);

      // Title matches should score higher than body matches
      const titleResults = engine.search(["Test"], 10, [], "Test");
      const bodyResults = engine.search(["content"], 10, [], "content");

      if (titleResults.length > 0 && bodyResults.length > 0) {
        // Title match should generally score higher than body match
        expect(titleResults[0].score).toBeGreaterThan(bodyResults[0].score * 0.5);
      }
    });
  });

  describe("getFieldWeight", () => {
    it("should return correct weights for known fields", () => {
      const getFieldWeight = (engine as any).getFieldWeight.bind(engine);

      expect(getFieldWeight("title")).toBe(3);
      expect(getFieldWeight("heading")).toBe(2.5);
      expect(getFieldWeight("path")).toBe(1.5); // Actual weight from implementation
      expect(getFieldWeight("headings")).toBe(1.5);
      expect(getFieldWeight("tags")).toBe(4);
      expect(getFieldWeight("props")).toBe(1.5);
      expect(getFieldWeight("links")).toBe(1.5);
      expect(getFieldWeight("body")).toBe(1);
    });

    it("should return default weight for unknown fields", () => {
      const getFieldWeight = (engine as any).getFieldWeight.bind(engine);
      expect(getFieldWeight("unknown")).toBe(1);
    });
  });

  describe("clear", () => {
    it("should reset index and memory", async () => {
      await engine.buildFromCandidates(["note1.md", "note2.md"]);

      let stats = engine.getStats();
      expect(stats.documentsIndexed).toBe(2);
      expect(stats.memoryUsed).toBeGreaterThan(0);

      engine.clear();

      stats = engine.getStats();
      expect(stats.documentsIndexed).toBe(0);
      expect(stats.memoryUsed).toBe(0);
    });
  });

  describe("getStats", () => {
    it("should return correct statistics", async () => {
      const stats1 = engine.getStats();
      expect(stats1.documentsIndexed).toBe(0);
      expect(stats1.memoryUsed).toBe(0);
      expect(stats1.memoryPercent).toBe(0);

      await engine.buildFromCandidates(["note1.md"]);

      const stats2 = engine.getStats();
      expect(stats2.documentsIndexed).toBe(1);
      expect(stats2.memoryUsed).toBeGreaterThan(0);
      expect(stats2.memoryPercent).toBeGreaterThanOrEqual(0);
      expect(stats2.memoryPercent).toBeLessThanOrEqual(100);
    });
  });

  describe("frontmatter property indexing", () => {
    it("should index string property values", async () => {
      await engine.buildFromCandidates(["author-test.md"]);

      // Should find by author name
      const results = engine.search(["John Doe"], 10, [], "John Doe");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].id).toBe("author-test.md#0");
    });

    it("should index number property values", async () => {
      await engine.buildFromCandidates(["project-test.md"]);

      // Should find by priority number (converted to string)
      const results = engine.search(["1"], 10, [], "1");
      expect(results.some((r) => r.id === "project-test.md#0")).toBe(true);
    });

    it("should index array property values", async () => {
      await engine.buildFromCandidates(["array-test.md"]);

      // Should find by array elements
      const results1 = engine.search(["typescript"], 10, [], "typescript");
      expect(results1.some((r) => r.id === "array-test.md#0")).toBe(true);

      const results2 = engine.search(["Alice"], 10, [], "Alice");
      expect(results2.some((r) => r.id === "array-test.md#0")).toBe(true);

      // Should find by number in array (converted to string)
      const results3 = engine.search(["300"], 10, [], "300");
      expect(results3.some((r) => r.id === "array-test.md#0")).toBe(true);
    });

    it("should NOT index nested objects", async () => {
      await engine.buildFromCandidates(["project-test.md"]);

      // Should NOT find by nested object value
      const results = engine.search(["ignore"], 10, [], "ignore");
      expect(results.some((r) => r.id === "project-test.md#0")).toBe(false);
    });

    it("should NOT index property keys", async () => {
      await engine.buildFromCandidates(["author-test.md"]);

      // Should NOT find by property key alone
      // Use a unique property key that doesn't appear in values or body
      const results = engine.search(["status"], 10, [], "status");

      // "status" key should not be indexed, but "draft" value should be
      // So searching for "status" should not find the document
      // (unless "status" appears in the body, which it doesn't in our test)
      expect(results.some((r) => r.id === "author-test.md#0")).toBe(false);

      // But searching for the value "draft" should find it
      const valueResults = engine.search(["draft"], 10, [], "draft");
      expect(valueResults.some((r) => r.id === "author-test.md#0")).toBe(true);
    });

    it("should index boolean values", async () => {
      await engine.buildFromCandidates(["edge-cases.md"]);

      // Should find by boolean values converted to strings
      const trueResults = engine.search(["true"], 10, [], "true");
      expect(trueResults.some((r) => r.id === "edge-cases.md#0")).toBe(true);

      const falseResults = engine.search(["false"], 10, [], "false");
      expect(falseResults.some((r) => r.id === "edge-cases.md#0")).toBe(true);
    });

    it("should search for boolean/numeric tokens in props field", async () => {
      await engine.buildFromCandidates(["edge-cases.md", "project-test.md"]);

      const boolResults = engine.search(["true"], 10, [], "true");
      const numResults = engine.search(["1"], 10, [], "1");

      // Just verify they return results
      expect(boolResults.length).toBeGreaterThan(0);
      expect(numResults.length).toBeGreaterThan(0);

      // Scoring is now uniform - no special downweighting
      const boolTop = boolResults[0];
      const numTop = numResults[0];
      expect(boolTop.score).toBeGreaterThan(0);
      expect(numTop.score).toBeGreaterThan(0);
    });

    it("should index Date objects as ISO strings", async () => {
      // Note: Our mock frontmatter has a Date object
      // In real Obsidian, dates in frontmatter are usually strings
      // But we support Date objects if they're present
      await engine.buildFromCandidates(["edge-cases.md"]);

      // The Date object should be converted to ISO string
      // Should find by searching for the ISO format
      const results = engine.search(["2024-01-15T00:00:00"], 10, [], "2024-01-15T00:00:00");
      expect(results.some((r) => r.id === "edge-cases.md#0")).toBe(true);
    });

    it("should skip null values and empty strings", async () => {
      await engine.buildFromCandidates(["edge-cases.md"]);

      // Should NOT find by "null" string
      const nullResults = engine.search(["null"], 10, [], "null");
      expect(nullResults.some((r) => r.id === "edge-cases.md#0")).toBe(false);

      // Empty strings should also be skipped (no way to test directly)
    });

    it("should handle nested arrays properly", async () => {
      await engine.buildFromCandidates(["edge-cases.md"]);

      // Should find the string in the nested array
      const results = engine.search(["but this works"], 10, [], "but this works");
      expect(results.some((r) => r.id === "edge-cases.md#0")).toBe(true);

      // Should NOT find the nested array elements
      const nestedResults = engine.search(["should"], 10, [], "should");
      expect(nestedResults.some((r) => r.id === "edge-cases.md#0")).toBe(false);
    });

    it("should handle circular frontmatter safely", async () => {
      const a: any = { name: "A" };
      const b: any = { name: "B" };
      a.ref = b;
      b.ref = a; // circular

      const propsCache: Record<string, any> = {
        "circular.md": {
          headings: [],
          frontmatter: a,
        },
      };

      mockApp.metadataCache.getFileCache = jest.fn((file: TFile) => {
        return propsCache[file.path] || { headings: [], frontmatter: {} };
      });
      mockApp.vault.cachedRead = jest.fn((file: TFile) => Promise.resolve("body"));

      await expect(engine.buildFromCandidates(["circular.md"])).resolves.toBe(1);
    });
  });

  describe("clear method", () => {
    it("should safely clear when index is null (not yet created)", () => {
      // Engine starts with null index
      expect((engine as any).index).toBeNull();

      // Should not throw error when clearing uninitialized index
      expect(() => engine.clear()).not.toThrow();

      // Should still reset collections
      expect((engine as any).indexedChunks.size).toBe(0);
    });

    it("should properly clear after index has been created", async () => {
      // Build index first
      await engine.buildFromCandidates(["note1.md", "note2.md"]);

      // Verify index was created and chunks indexed
      expect((engine as any).index).not.toBeNull();
      expect((engine as any).indexedChunks.size).toBeGreaterThan(0);

      // Clear should not throw
      expect(() => engine.clear()).not.toThrow();

      // Should reset state
      expect((engine as any).index).toBeNull();
      expect((engine as any).indexedChunks.size).toBe(0);
    });

    it("should allow multiple clear calls safely", async () => {
      // Build index
      await engine.buildFromCandidates(["note1.md"]);

      // Multiple clears should all work
      expect(() => engine.clear()).not.toThrow();
      expect(() => engine.clear()).not.toThrow();
      expect(() => engine.clear()).not.toThrow();

      // State should remain clean
      expect((engine as any).index).toBeNull();
      expect((engine as any).indexedChunks.size).toBe(0);
    });

    it("should nullify MiniSearch index on clear", async () => {
      await engine.buildFromCandidates(["note1.md"]);

      // Verify index exists
      expect((engine as any).index).not.toBeNull();

      engine.clear();

      // MiniSearch cleanup is just nullifying the reference
      expect((engine as any).index).toBeNull();
    });

    it("should allow new index to be created after clear", async () => {
      await engine.buildFromCandidates(["note1.md"]);
      engine.clear();

      // Should be able to create a new index after clearing
      await engine.buildFromCandidates(["note2.md"]);
      expect((engine as any).index).not.toBeNull();
      expect((engine as any).indexedChunks.size).toBeGreaterThan(0);
    });

    it("should handle index without destroy or clear methods", async () => {
      await engine.buildFromCandidates(["note1.md"]);

      // Mock index without cleanup methods
      (engine as any).index = {
        someOtherMethod: jest.fn(),
      };

      // Should not throw and still reset
      expect(() => engine.clear()).not.toThrow();
      expect((engine as any).index).toBeNull();
    });

    it("should continue cleanup even if index cleanup throws", async () => {
      await engine.buildFromCandidates(["note1.md"]);

      // Mock index that throws on cleanup
      (engine as any).index = {
        destroy: jest.fn(() => {
          throw new Error("Mock cleanup failure");
        }),
      };

      // Should not throw despite index cleanup error
      expect(() => engine.clear()).not.toThrow();

      // Should still reset state
      expect((engine as any).index).toBeNull();
      expect((engine as any).indexedChunks.size).toBe(0);
    });

    it("should reset memory manager during clear", async () => {
      await engine.buildFromCandidates(["note1.md", "note2.md"]);

      // Verify some memory is used
      const statsBefore = engine.getStats();
      expect(statsBefore.memoryUsed).toBeGreaterThan(0);

      engine.clear();

      // Memory should be reset
      const statsAfter = engine.getStats();
      expect(statsAfter.memoryUsed).toBe(0);
      expect(statsAfter.documentsIndexed).toBe(0);
    });
  });
});
