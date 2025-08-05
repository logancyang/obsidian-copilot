import { LexicalEngine } from "./LexicalEngine";
import { TFile, Vault } from "obsidian";

describe("LexicalEngine", () => {
  let engine: LexicalEngine;
  let mockVault: Partial<Vault>;

  beforeEach(() => {
    engine = new LexicalEngine();

    // Create mock vault with test files
    const mockFiles = [
      {
        path: "notes/typescript.md",
        basename: "typescript",
        content: "TypeScript is a typed superset of JavaScript that compiles to plain JavaScript.",
      },
      {
        path: "notes/javascript.md",
        basename: "javascript",
        content: "JavaScript is a programming language commonly used in web development.",
      },
      {
        path: "notes/react.md",
        basename: "react",
        content: "React is a JavaScript library for building user interfaces.",
      },
    ];

    mockVault = {
      getMarkdownFiles: () => mockFiles as unknown as TFile[],
      cachedRead: async (file: TFile) => {
        const mockFile = mockFiles.find((f) => f.path === file.path);
        return mockFile?.content || "";
      },
    };
  });

  describe("initialization", () => {
    it("should initialize with vault files", async () => {
      await engine.initialize(mockVault as Vault);

      // Search for a known term
      const results = engine.search(["typescript"], 10);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].noteId).toBe("notes/typescript.md");
    });
  });

  describe("search", () => {
    beforeEach(async () => {
      await engine.initialize(mockVault as Vault);
    });

    it("should find notes by title", () => {
      const results = engine.search(["react"], 10);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].noteId).toBe("notes/react.md");
      expect(results[0].engine).toBe("lexical");
    });

    it("should find notes by content", () => {
      const results = engine.search(["programming language"], 10);
      expect(results.length).toBeGreaterThan(0);
      const paths = results.map((r) => r.noteId);
      expect(paths).toContain("notes/javascript.md");
    });

    it("should handle multiple query variants", () => {
      const results = engine.search(["javascript", "typescript", "scripting"], 10);
      expect(results.length).toBeGreaterThan(0);
      // Should find both JavaScript and TypeScript notes
      const paths = results.map((r) => r.noteId);
      expect(paths).toContain("notes/javascript.md");
      expect(paths).toContain("notes/typescript.md");
    });

    it("should assign scores based on relevance", () => {
      const results = engine.search(["javascript"], 10);
      expect(results.length).toBeGreaterThan(0);
      // First result should have highest score
      if (results.length > 1) {
        expect(results[0].score).toBeGreaterThanOrEqual(results[1].score);
      }
    });

    it("should handle empty queries gracefully", () => {
      const results = engine.search(["", "  "], 10);
      expect(results).toEqual([]);
    });
  });

  describe("file operations", () => {
    beforeEach(async () => {
      await engine.initialize(mockVault as Vault);
    });

    it("should update existing files", () => {
      const mockFile = {
        path: "notes/typescript.md",
        basename: "typescript",
      } as TFile;

      engine.updateFile(mockFile, "TypeScript is amazing for type safety!");

      const results = engine.search(["type safety"], 10);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].noteId).toBe("notes/typescript.md");
    });

    it("should add new files", () => {
      const mockFile = {
        path: "notes/vue.md",
        basename: "vue",
      } as TFile;

      engine.updateFile(mockFile, "Vue is a progressive JavaScript framework");

      const results = engine.search(["vue"], 10);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].noteId).toBe("notes/vue.md");
    });

    it("should remove files", () => {
      engine.removeFile("notes/react.md");

      const results = engine.search(["react"], 10);
      const paths = results.map((r) => r.noteId);
      expect(paths).not.toContain("notes/react.md");
    });
  });

  describe("cleanup", () => {
    it("should clear the index on cleanup", async () => {
      await engine.initialize(mockVault as Vault);

      // Verify index has data
      let results = engine.search(["javascript"], 10);
      expect(results.length).toBeGreaterThan(0);

      // Clean up
      engine.cleanup();

      // Index should be empty
      results = engine.search(["javascript"], 10);
      expect(results.length).toBe(0);
    });
  });
});
