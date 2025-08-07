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

import { FullTextEngine } from "./FullTextEngine";
import { TFile } from "obsidian";

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

    it("should return empty array for empty input", () => {
      const tokens = (engine as any).tokenizeMixed("");
      expect(tokens).toEqual([]);
    });
  });

  describe("buildFromCandidates", () => {
    it("should index candidate files", async () => {
      const candidates = ["note1.md", "note2.md"];
      const indexed = await engine.buildFromCandidates(candidates);

      expect(indexed).toBe(2);

      const stats = engine.getStats();
      expect(stats.documentsIndexed).toBe(2);
    });

    it("should respect candidate limit", async () => {
      const candidates = Array.from({ length: 1000 }, (_, i) => `note${i}.md`);

      // Mock vault to return files for all candidates
      mockApp.vault.getAbstractFileByPath = jest.fn((path) => ({
        path,
        basename: path.replace(".md", ""),
        stat: { mtime: Date.now() },
      }));

      await engine.buildFromCandidates(candidates);

      const stats = engine.getStats();
      expect(stats.documentsIndexed).toBeLessThanOrEqual(500); // Desktop limit
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

      expect(indexed).toBe(2); // Should skip missing file
    });

    it("should clear previous index before building", async () => {
      await engine.buildFromCandidates(["note1.md"]);
      let stats = engine.getStats();
      expect(stats.documentsIndexed).toBe(1);

      await engine.buildFromCandidates(["note2.md", "note3.md"]);
      stats = engine.getStats();
      expect(stats.documentsIndexed).toBe(2); // Should have cleared note1
    });
  });

  describe("search", () => {
    beforeEach(async () => {
      await engine.buildFromCandidates(["note1.md", "note2.md", "note3.md"]);
    });

    it("should search indexed documents", () => {
      const results = engine.search(["typescript"], 10);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].engine).toBe("fulltext");
    });

    it("should handle multiple query variants", () => {
      const results = engine.search(["typescript", "javascript"], 10);

      expect(results.length).toBeGreaterThan(0);
    });

    it("should return empty array for no matches", () => {
      const results = engine.search(["nonexistentterm"], 10);

      expect(results).toEqual([]);
    });

    it("should respect limit parameter", () => {
      const results = engine.search(["typescript"], 1);

      expect(results.length).toBeLessThanOrEqual(1);
    });

    it("should handle empty query array", () => {
      const results = engine.search([], 10);

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
      const results = engine.search(["piano"], 10);

      // Title matches should score higher than body matches
      const titleMatch = results.find((r) => r.id.includes("Lesson"));
      const bodyMatch = results.find((r) => r.id.includes("daily"));

      if (titleMatch && bodyMatch) {
        expect(titleMatch.score).toBeGreaterThan(bodyMatch.score);
      }
    });

    it("should boost multi-field matches", () => {
      const results = engine.search(["piano"], 10);

      // The music.md file has "piano" in tags and body, should get multi-field bonus
      const multiFieldMatch = results.find((r) => r.id === "projects/music.md");
      expect(multiFieldMatch).toBeDefined();

      // Should be ranked relatively high due to multi-field bonus
      const index = results.findIndex((r) => r.id === "projects/music.md");
      expect(index).toBeLessThan(3); // Should be in top 3
    });

    it("should score path matches with proper weight", () => {
      const results = engine.search(["piano lessons"], 10);

      // Files in "Piano Lessons" folder should match on path field
      const lessonFiles = results.filter((r) => r.id.includes("Piano Lessons"));
      expect(lessonFiles.length).toBe(2);

      // Both lesson files should be ranked high
      const lesson1Index = results.findIndex((r) => r.id.includes("Lesson 1"));
      const lesson2Index = results.findIndex((r) => r.id.includes("Lesson 2"));

      expect(lesson1Index).toBeLessThan(3);
      expect(lesson2Index).toBeLessThan(3);
    });

    it("should handle position-based scoring", () => {
      const results = engine.search(["piano"], 10);

      // All results should have decreasing scores
      for (let i = 1; i < results.length; i++) {
        expect(results[i].score).toBeLessThanOrEqual(results[i - 1].score);
      }
    });
  });

  describe("getFieldWeight", () => {
    it("should return correct weights for known fields", () => {
      const getFieldWeight = (engine as any).getFieldWeight.bind(engine);

      expect(getFieldWeight("title")).toBe(3);
      expect(getFieldWeight("path")).toBe(2.5);
      expect(getFieldWeight("headings")).toBe(2);
      expect(getFieldWeight("tags")).toBe(2);
      expect(getFieldWeight("props")).toBe(2);
      expect(getFieldWeight("links")).toBe(2);
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
    beforeEach(() => {
      // Add test notes with various frontmatter properties
      const propsCache: Record<string, any> = {
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
      };

      // Update mock cache
      mockApp.metadataCache.getFileCache = jest.fn((file: TFile) => {
        return propsCache[file.path] || { headings: [], frontmatter: {} };
      });

      // Update vault content
      mockApp.vault.cachedRead = jest.fn((file: TFile) => {
        const contents: Record<string, string> = {
          "author-test.md": "This is a draft document",
          "project-test.md": "Machine learning research content",
          "array-test.md": "Testing arrays in frontmatter",
          "edge-cases.md": "Testing edge cases",
        };
        return Promise.resolve(contents[file.path] || "");
      });
    });

    it("should index string property values", async () => {
      await engine.buildFromCandidates(["author-test.md"]);

      // Should find by author name
      const results = engine.search(["John Doe"], 10);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].id).toBe("author-test.md");
    });

    it("should index number property values", async () => {
      await engine.buildFromCandidates(["project-test.md"]);

      // Should find by priority number (converted to string)
      const results = engine.search(["1"], 10);
      expect(results.some((r) => r.id === "project-test.md")).toBe(true);
    });

    it("should index array property values", async () => {
      await engine.buildFromCandidates(["array-test.md"]);

      // Should find by array elements
      const results1 = engine.search(["typescript"], 10);
      expect(results1.some((r) => r.id === "array-test.md")).toBe(true);

      const results2 = engine.search(["Alice"], 10);
      expect(results2.some((r) => r.id === "array-test.md")).toBe(true);

      // Should find by number in array (converted to string)
      const results3 = engine.search(["300"], 10);
      expect(results3.some((r) => r.id === "array-test.md")).toBe(true);
    });

    it("should NOT index nested objects", async () => {
      await engine.buildFromCandidates(["project-test.md"]);

      // Should NOT find by nested object value
      const results = engine.search(["ignore"], 10);
      expect(results.some((r) => r.id === "project-test.md")).toBe(false);
    });

    it("should NOT index property keys", async () => {
      await engine.buildFromCandidates(["author-test.md"]);

      // Should NOT find by property key alone
      // Use a unique property key that doesn't appear in values or body
      const results = engine.search(["status"], 10);

      // "status" key should not be indexed, but "draft" value should be
      // So searching for "status" should not find the document
      // (unless "status" appears in the body, which it doesn't in our test)
      expect(results.some((r) => r.id === "author-test.md")).toBe(false);

      // But searching for the value "draft" should find it
      const valueResults = engine.search(["draft"], 10);
      expect(valueResults.some((r) => r.id === "author-test.md")).toBe(true);
    });

    it("should index boolean values", async () => {
      await engine.buildFromCandidates(["edge-cases.md"]);

      // Should find by boolean values converted to strings
      const trueResults = engine.search(["true"], 10);
      expect(trueResults.some((r) => r.id === "edge-cases.md")).toBe(true);

      const falseResults = engine.search(["false"], 10);
      expect(falseResults.some((r) => r.id === "edge-cases.md")).toBe(true);
    });

    it("should index Date objects as ISO strings", async () => {
      // Note: Our mock frontmatter has a Date object
      // In real Obsidian, dates in frontmatter are usually strings
      // But we support Date objects if they're present
      await engine.buildFromCandidates(["edge-cases.md"]);

      // The Date object should be converted to ISO string
      // Should find by searching for the ISO format
      const results = engine.search(["2024-01-15T00:00:00"], 10);
      expect(results.some((r) => r.id === "edge-cases.md")).toBe(true);
    });

    it("should skip null values and empty strings", async () => {
      await engine.buildFromCandidates(["edge-cases.md"]);

      // Should NOT find by "null" string
      const nullResults = engine.search(["null"], 10);
      expect(nullResults.some((r) => r.id === "edge-cases.md")).toBe(false);

      // Empty strings should also be skipped (no way to test directly)
    });

    it("should handle nested arrays properly", async () => {
      await engine.buildFromCandidates(["edge-cases.md"]);

      // Should find the string in the nested array
      const results = engine.search(["but this works"], 10);
      expect(results.some((r) => r.id === "edge-cases.md")).toBe(true);

      // Should NOT find the nested array elements
      const nestedResults = engine.search(["should"], 10);
      expect(nestedResults.some((r) => r.id === "edge-cases.md")).toBe(false);
    });
  });
});
