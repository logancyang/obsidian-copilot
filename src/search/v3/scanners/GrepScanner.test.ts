import { GrepScanner } from "./GrepScanner";

describe("GrepScanner", () => {
  let scanner: GrepScanner;
  let mockApp: any;
  let mockFiles: any[];

  beforeEach(() => {
    // Mock file data
    mockFiles = [
      { path: "note1.md", content: "This is about TypeScript and JavaScript" },
      { path: "note2.md", content: "Python programming with machine learning" },
      { path: "note3.md", content: "JavaScript frameworks like React and Vue" },
      { path: "note4.md", content: "中文笔记关于编程" },
      { path: "note5.md", content: "Mixed content with TypeScript 和中文" },
    ];

    // Create mock app
    mockApp = {
      vault: {
        getMarkdownFiles: jest.fn(() => mockFiles.map((f) => ({ path: f.path }))),
        cachedRead: jest.fn((file) => {
          const mockFile = mockFiles.find((f) => f.path === file.path);
          return Promise.resolve(mockFile?.content || "");
        }),
      },
    };

    scanner = new GrepScanner(mockApp);
  });

  describe("batchCachedReadGrep", () => {
    it("should find files containing query substrings", async () => {
      const results = await scanner.batchCachedReadGrep(["typescript"], 10);

      expect(results).toContain("note1.md");
      expect(results).toContain("note5.md");
      expect(results).not.toContain("note2.md");
    });

    it("should perform case-insensitive search", async () => {
      const results = await scanner.batchCachedReadGrep(["JAVASCRIPT"], 10);

      expect(results).toContain("note1.md");
      expect(results).toContain("note3.md");
    });

    it("should search with multiple queries", async () => {
      const results = await scanner.batchCachedReadGrep(["python", "react"], 10);

      expect(results).toContain("note2.md"); // Contains Python
      expect(results).toContain("note3.md"); // Contains React
    });

    it("should respect the limit parameter", async () => {
      const results = await scanner.batchCachedReadGrep(
        ["programming", "typescript", "javascript"],
        2
      );

      expect(results.length).toBeLessThanOrEqual(2);
    });

    it("should handle CJK content", async () => {
      const results = await scanner.batchCachedReadGrep(["中文"], 10);

      expect(results).toContain("note4.md");
      expect(results).toContain("note5.md");
    });

    it("should return empty array for no matches", async () => {
      const results = await scanner.batchCachedReadGrep(["nonexistent"], 10);

      expect(results).toEqual([]);
    });

    it("should handle empty query array", async () => {
      const results = await scanner.batchCachedReadGrep([], 10);

      expect(results).toEqual([]);
    });

    it("should skip files that can't be read", async () => {
      mockApp.vault.cachedRead = jest.fn((file) => {
        if (file.path === "note2.md") {
          return Promise.reject(new Error("File read error"));
        }
        const mockFile = mockFiles.find((f) => f.path === file.path);
        return Promise.resolve(mockFile?.content || "");
      });

      const results = await scanner.batchCachedReadGrep(["programming"], 10);

      // Should still find other files with "programming"
      expect(results).not.toContain("note2.md");
      // But note4 has "编程" not "programming" in English
    });
  });

  describe("grep", () => {
    it("should search for a single query", async () => {
      const results = await scanner.grep("typescript");

      expect(results).toContain("note1.md");
      expect(results).toContain("note5.md");
    });

    it("should use default limit", async () => {
      // Add many more mock files
      const manyFiles = Array.from({ length: 300 }, (_, i) => ({
        path: `note${i + 100}.md`,
        content: "typescript content",
      }));
      mockFiles.push(...manyFiles);

      const results = await scanner.grep("typescript");

      expect(results.length).toBeLessThanOrEqual(200); // Default limit
    });
  });

  describe("fileContainsAny", () => {
    it("should return true if file contains any query", async () => {
      const file = { path: "note1.md" };
      const result = await scanner.fileContainsAny(file as any, ["python", "typescript"]);

      expect(result).toBe(true); // Contains "typescript"
    });

    it("should return false if file contains no queries", async () => {
      const file = { path: "note1.md" };
      const result = await scanner.fileContainsAny(file as any, ["python", "machine"]);

      expect(result).toBe(false);
    });

    it("should handle read errors gracefully", async () => {
      mockApp.vault.cachedRead = jest.fn(() => Promise.reject(new Error("Read error")));

      const file = { path: "note1.md" };
      const result = await scanner.fileContainsAny(file as any, ["typescript"]);

      expect(result).toBe(false);
    });
  });
});
