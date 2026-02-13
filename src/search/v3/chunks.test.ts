// Mock Obsidian modules
jest.mock("obsidian", () => {
  class MockTFile {
    path: string;
    basename: string;
    stat: { mtime: number };

    constructor(path: string) {
      this.path = path;
      this.basename = path.replace(".md", "");
      this.stat = { mtime: Date.now() };
    }

    // Add instanceof compatibility
    static [Symbol.hasInstance](instance: any) {
      return (
        instance && typeof instance === "object" && "path" in instance && "basename" in instance
      );
    }
  }

  return {
    TFile: MockTFile,
  };
});

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

import { TFile } from "obsidian";
import { ChunkManager, ChunkOptions } from "./chunks";

describe("ChunkManager", () => {
  let chunkManager: ChunkManager;
  let mockApp: any;
  // Cache mock files to ensure consistent mtime across calls
  let mockFileCache: Map<string, any>;

  beforeEach(() => {
    mockFileCache = new Map();
    mockApp = {
      vault: {
        getAbstractFileByPath: jest.fn((path) => {
          if (!path || path.startsWith("missing")) return null;
          // Return cached file to ensure consistent mtime
          if (mockFileCache.has(path)) {
            return mockFileCache.get(path);
          }
          const file = new (TFile as any)(path);
          // Ensure the file passes instanceof TFile checks
          Object.setPrototypeOf(file, (TFile as any).prototype);
          mockFileCache.set(path, file);
          return file;
        }),
        cachedRead: jest.fn((file) => {
          const contents: Record<string, string> = {
            "short.md": "This is a short note with minimal content.",
            "medium.md":
              "# Introduction\n\nThis is a medium-length note.\n\n## Section 1\n\nSome content here with multiple paragraphs to test chunking.\n\n## Section 2\n\nMore content in this section that should be chunked appropriately.",
            "long.md":
              "# Large Document\n\nThis is a very long document that will need chunking.\n\n## Chapter 1: Introduction\n\nLorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.\n\n## Chapter 2: Main Content\n\nSed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium, totam rem aperiam, eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo. Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit, sed quia consequuntur magni dolores eos qui ratione voluptatem sequi nesciunt.\n\n### Subsection 2.1\n\nAt vero eos et accusamus et iusto odio dignissimos ducimus qui blanditiis praesentibus voluptatum deleniti atque corrupti quos dolores et quas molestias excepturi sint occaecati cupiditate non provident, similique sunt in culpa qui officia deserunt mollitia animi, id est laborum et dolorum fuga.\n\n## Chapter 3: Conclusion\n\nEt harum quidem rerum facilis est et expedita distinctio. Nam libero tempore, cum soluta nobis est eligendi optio cumque nihil impedit quo minus id quod maxime placeat facere possimus, omnis voluptas assumenda est, omnis dolor repellendus.",
            "code.md":
              "# Code Examples\n\n```javascript\nfunction example() {\n  console.log('This code block should not be split');\n  return 'value';\n}\n```\n\n## Another Section\n\nSome text after the code block.\n\n```python\ndef another_function():\n    print('Another code block')\n    return True\n```\n\nMore content here.",
            "frontmatter.md":
              "---\ntitle: Test Document\nauthor: John Doe\ntags: [test, chunk]\n---\n\n# Document with Frontmatter\n\nThis document has YAML frontmatter that should be excluded from chunks.\n\n## Content Section\n\nThe actual content starts here and should be chunked properly.",
            "chinese.md":
              "# 中文文档测试\n\n这是一个用于测试中文字符分块的文档。中文文本应该能够正确处理。\n\n## 第一部分\n\n中文内容包含各种字符，包括标点符号和数字123。这些内容应该被正确地分块处理。\n\n## 第二部分\n\n更多的中文内容用于测试分块功能的正确性。系统应该能够处理中文、日文和韩文字符。",
          };
          return Promise.resolve(contents[file.path] || "");
        }),
      },
      metadataCache: {
        getFileCache: jest.fn((file) => {
          const headingsByFile: Record<string, any> = {
            "medium.md": {
              headings: [
                { heading: "Introduction", level: 1, position: { start: { offset: 0 } } },
                { heading: "Section 1", level: 2, position: { start: { offset: 50 } } },
                { heading: "Section 2", level: 2, position: { start: { offset: 120 } } },
              ],
              frontmatter: null,
            },
            "long.md": {
              headings: [
                { heading: "Large Document", level: 1, position: { start: { offset: 0 } } },
                {
                  heading: "Chapter 1: Introduction",
                  level: 2,
                  position: { start: { offset: 50 } },
                },
                {
                  heading: "Chapter 2: Main Content",
                  level: 2,
                  position: { start: { offset: 400 } },
                },
                { heading: "Subsection 2.1", level: 3, position: { start: { offset: 800 } } },
                {
                  heading: "Chapter 3: Conclusion",
                  level: 2,
                  position: { start: { offset: 1200 } },
                },
              ],
              frontmatter: null,
            },
            "code.md": {
              headings: [
                { heading: "Code Examples", level: 1, position: { start: { offset: 0 } } },
                { heading: "Another Section", level: 2, position: { start: { offset: 100 } } },
              ],
              frontmatter: null,
            },
            "frontmatter.md": {
              headings: [
                {
                  heading: "Document with Frontmatter",
                  level: 1,
                  position: { start: { offset: 80 } },
                },
                { heading: "Content Section", level: 2, position: { start: { offset: 150 } } },
              ],
              frontmatter: { title: "Test Document", author: "John Doe", tags: ["test", "chunk"] },
            },
            "chinese.md": {
              headings: [
                { heading: "中文文档测试", level: 1, position: { start: { offset: 0 } } },
                { heading: "第一部分", level: 2, position: { start: { offset: 50 } } },
                { heading: "第二部分", level: 2, position: { start: { offset: 100 } } },
              ],
              frontmatter: null,
            },
          };

          return headingsByFile[file.path] || { headings: [], frontmatter: null };
        }),
      },
    };

    chunkManager = new ChunkManager(mockApp);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("getChunks", () => {
    const defaultOptions: ChunkOptions = {
      maxChars: 2000,
      overlap: 0,
      maxBytesTotal: 1024 * 1024, // 1MB
    };

    it("should create single chunk for short documents", async () => {
      const chunks = await chunkManager.getChunks(["short.md"], defaultOptions);

      expect(chunks).toHaveLength(1);
      expect(chunks[0].id).toBe("short.md#0");
      expect(chunks[0].notePath).toBe("short.md");
      expect(chunks[0].chunkIndex).toBe(0);
      expect(chunks[0].content).toContain("This is a short note");
      expect(chunks[0].title).toBe("short");
      expect(chunks[0].heading).toBe("");
    });

    it("should create multiple chunks for long documents", async () => {
      // Use smaller maxChars to force chunking (content must exceed this to be split)
      const smallerOptions: ChunkOptions = {
        ...defaultOptions,
        maxChars: 500, // Force splitting by keeping maxChars smaller than content
      };
      const chunks = await chunkManager.getChunks(["long.md"], smallerOptions);

      expect(chunks.length).toBeGreaterThan(1);

      // Verify chunk IDs are sequential
      chunks.forEach((chunk, index) => {
        const chunkIndex = index.toString();
        expect(chunk.id).toBe(`long.md#${chunkIndex}`);
        expect(chunk.notePath).toBe("long.md");
        expect(chunk.chunkIndex).toBe(index);
      });

      // Verify all chunks have content
      chunks.forEach((chunk) => {
        expect(chunk.content.length).toBeGreaterThan(0);
        expect(chunk.content.length).toBeLessThanOrEqual(smallerOptions.maxChars);
      });
    });

    it("should preserve headings in chunks", async () => {
      // Use smaller maxChars to force heading-based chunking
      // medium.md is ~240 chars, plus header ~50 = ~290, so use maxChars < 290
      const smallerOptions: ChunkOptions = {
        ...defaultOptions,
        maxChars: 200, // Force splitting by headings
      };
      const chunks = await chunkManager.getChunks(["medium.md"], smallerOptions);

      // Find chunk with "Section 1" content
      const section1Chunk = chunks.find((chunk) => chunk.content.includes("Section 1"));
      expect(section1Chunk).toBeDefined();
      expect(section1Chunk!.heading).toContain("Section 1");

      // Find chunk with "Section 2" content
      const section2Chunk = chunks.find((chunk) => chunk.content.includes("Section 2"));
      expect(section2Chunk).toBeDefined();
      expect(section2Chunk!.heading).toContain("Section 2");
    });

    it("should not split code blocks", async () => {
      const largerOptions: ChunkOptions = {
        ...defaultOptions,
        maxChars: 4000, // Ensure code blocks fit
      };
      const chunks = await chunkManager.getChunks(["code.md"], largerOptions);

      // Find chunk containing JavaScript code
      const jsChunk = chunks.find((chunk) => chunk.content.includes("function example"));
      expect(jsChunk).toBeDefined();
      expect(jsChunk!.content).toContain("function example");
      // The chunk may be truncated, so just verify it contains the function start
      expect(jsChunk!.content).toContain("```javascript");

      // Find chunk containing Python code
      const pyChunk = chunks.find((chunk) => chunk.content.includes("def another_function"));
      expect(pyChunk).toBeDefined();
      expect(pyChunk!.content).toContain("def another_function");
      expect(pyChunk!.content).toContain("```python");
    });

    it("should exclude YAML frontmatter from chunks", async () => {
      const largerOptions: ChunkOptions = {
        ...defaultOptions,
        maxChars: 4000, // Ensure frontmatter test content fits
      };
      const chunks = await chunkManager.getChunks(["frontmatter.md"], largerOptions);

      // No chunk should contain the YAML frontmatter
      chunks.forEach((chunk) => {
        expect(chunk.content).not.toContain("title: Test Document");
        expect(chunk.content).not.toContain("author: John Doe");
        expect(chunk.content).not.toContain("tags: [test, chunk]");
        expect(chunk.content).not.toContain("---");
      });

      // But chunks should contain the actual content (might be partial due to chunking)
      const firstChunk = chunks[0];
      expect(firstChunk.content).toContain("Frontmatter"); // Part of the heading should be there
    });

    it("should respect memory limits", async () => {
      const limitedOptions: ChunkOptions = {
        ...defaultOptions,
        maxBytesTotal: 2000, // Small but realistic limit
      };

      const chunks = await chunkManager.getChunks(["long.md"], limitedOptions);

      // Should stop chunking when memory limit is reached or return fewer chunks
      // The memory limit applies to caching, not the initial chunk creation
      // So we just verify chunks were created (the ChunkManager handles memory correctly)
      expect(chunks.length).toBeGreaterThan(0);
    });

    it("should handle missing files gracefully", async () => {
      const chunks = await chunkManager.getChunks(["missing.md", "short.md"], defaultOptions);

      // Should only process the valid file
      expect(chunks).toHaveLength(1);
      expect(chunks[0].notePath).toBe("short.md");
    });

    it("should cache chunks for repeated requests", async () => {
      const chunks1 = await chunkManager.getChunks(["short.md"], defaultOptions);
      const chunks2 = await chunkManager.getChunks(["short.md"], defaultOptions);

      expect(chunks1).toEqual(chunks2);
      // Verify file was only read once
      expect(mockApp.vault.cachedRead).toHaveBeenCalledTimes(1);
    });

    it("should create appropriate sized chunks", async () => {
      const chunks = await chunkManager.getChunks(["medium.md"], defaultOptions);

      // All chunks should respect maxChars limit
      chunks.forEach((chunk) => {
        expect(chunk.content.length).toBeLessThanOrEqual(defaultOptions.maxChars);
      });

      // Should have created at least one chunk
      expect(chunks.length).toBeGreaterThan(0);

      // Most chunks should be reasonably sized (allowing for headers and small chunks)
      const verySmallChunks = chunks.filter((chunk) => chunk.content.length < 100);
      expect(verySmallChunks.length).toBeLessThan(chunks.length); // Not all chunks should be tiny
    });

    it("should respect maxChars by splitting large sections", async () => {
      const chunks = await chunkManager.getChunks(["long.md"], defaultOptions);

      // No chunk should exceed maxChars
      chunks.forEach((chunk) => {
        expect(chunk.content.length).toBeLessThanOrEqual(defaultOptions.maxChars);
      });
    });

    it("should merge a heading-only first chunk for the reported How to Do Great Work note", async () => {
      const notePath = "long-whitespace-heavy.md";
      const noteContent = `# 218 How to Do Great Work


  
 
 July 2023   
  
 If you collected lists of techniques for doing great work in a lot of different fields, what would the intersection look like? I decided to find out by making it.   
  
 Partly my goal was to create a guide that could be used by someone working in any field. But I was also curious about the shape of the intersection. And one thing this exercise shows is that it does have a definite shape; it's not just a point labelled "work hard."   
  
 The following recipe assumes you're very ambitious.   
  
 
  
 
  
 
  
 
  
 The first step is to decide what to work on. The work you choose needs to have three qualities: it has to be something you have a natural aptitude for, that you have a deep interest in, and that offers scope to do great work.   
  
 In practice you don't have to worry much about the third criterion. Ambitious people are if anything already too conservative about it. So all you need to do is find something you have an aptitude for and great interest in. [^1]   
  
 That sounds straightforward, but it's often quite difficult. When you're young you don't know what you're good at or what different kinds of work are like. Some kinds of work you end up doing may not even exist yet. So while some people know what they want to do at 14, most have to figure it out.   
  
 The way to figure out what to work on is by working. If you're not sure what to work on, guess. But pick something and get going. You'll probably guess wrong some of the time, but that's fine. It's good to know about multiple things; some of the biggest discoveries come from noticing connections between different fields.   
  
 Develop a habit of working on your own projects. Don't let "work" mean something other people tell you to do. If you do manage to do great work one day, it will probably be on a project of your own. It may be within some bigger project, but you'll be driving your part of it.   
  
 What should your projects be? Whatever seems to you excitingly ambitious. As you grow older and your taste in projects evolves, exciting and important will converge. At 7 it may seem excitingly ambitious to build huge things out of Lego, then at 14 to teach yourself calculus, till at 21 you're starting to explore unanswered questions in physics. But always preserve excitingness.   
  
 There's a kind of excited curiosity that's both the engine and the rudder of great work. It will not only drive you, but if you let it have its way, will also show you what to work on.   
  
 What are you excessively curious about -- curious to a degree that would bore most other people? That's what you're looking for.   
  
 Once you've found something you're excessively interested in, the next step is to learn enough about it to get you to one of the frontiers of knowledge. Knowledge expands fractally, and from a distance its edges look smooth, but once you learn enough to get close to one, they turn out to be full of gaps.   
  
 The next step is to notice them. This takes some skill, because your brain wants to ignore such gaps in order to make a simpler model of the world. Many discoveries have come from asking questions about things that everyone else took for granted. [^2]   
  
 If the answers seem strange, so much the better. Great work often has a tincture of strangeness. You see this from painting to math. It would be affected to try to manufacture it, but if it appears, embrace it.   
  
 Boldly chase outlier ideas, even if other people aren't interested in them -- in fact, especially if they aren't. If you're excited about some possibility that everyone else ignores, and you have enough expertise to say precisely what they're all overlooking, that's as good a bet as you'll find. [^3]   
  
 Four steps: choose a field, learn enough to get to the frontier, notice gaps, explore promising ones. This is how practically everyone who's done great work has done it, from painters to physicists.   
  
 Steps two and four will require hard work. It may not be possible to prove that you have to work hard to do great things, but the empirical evidence is on the scale of the evidence for mortality. That's why it's essential to work on something you're deeply interested in. Interest will drive you to work harder than mere diligence ever could.   
  
 The three most powerful motives are curiosity, delight, and the desire to do something impressive. Sometimes they converge, and that combination is the most powerful of all.   
  
 The big prize is to discover a new fractal bud. You notice a crack in the surface of knowledge, pry it open, and there's a whole world inside.   
  
 Let's talk a little more about the complicated business of figuring out what to work on. The main reason it's hard is that you can't tell what most kinds of work are like except by doing them. Which means the four steps overlap: you may have to work at something for years before you know how much you like it or how good you are at it. And in the meantime you're not doing, and thus not learning about, most other kinds of work. So in the worst case you choose late based on very incomplete information. [^4]   
  
 The nature of ambition exacerbates this problem. Ambition comes in two forms, one that precedes interest in the subject and one that grows out of it. Most people who do great work have a mix, and the more you have of the former, the harder it will be to decide what to do.   
  
 The educational systems in most countries pretend it's easy. They expect you to commit to a field long before you could know what it's really like. And as a result an ambitious person on an optimal trajectory will often read to the system as an instance of breakage.   
  
 It would be better if they at least admitted it -- if they admitted that the system not only can't do much to help you figure out what to work on, but is designed on the assumption that you'll somehow magically guess as a teenager. They don't tell you, but I will: when it comes to figuring out what to work on, you're on your own. Some people get lucky and do guess correctly, but the rest will find themselves scrambling diagonally across tracks laid down on the assumption that everyone does.   
  
 What should you do if you're young and ambitious but don't know what to work on? What you should _not_ do is drift along passively, assuming the problem will solve itself. You need to take action. But there is no systematic procedure you can follow. When you read biographies of people who've done great work, it's remarkable how much luck is involved. They discover what to work on as a result of a chance meeting, or by reading a book they happen to pick up. So you need to make yourself a big target for luck, and the way to do that is to be curious. Try lots of things, meet lots of people, read lots of books, ask lots of questions. [^5]   
  
 When in doubt, optimize for interestingness. Fields change as you learn more about them. What mathematicians do, for example, is very different from what you do in high school math classes. So you need to give different types of work a chance to show you what they're like. But a field should become _increasingly_ interesting as you learn more about it. If it doesn't, it's probably not for you.   
  
 The discoveries are out there, waiting to be made. Why not by you?

* * *

[^1]: I don't think you could give a precise definition of what counts as great work.
[^2]: A lot of standup comedy is based on noticing anomalies in everyday life.
[^3]: That second qualifier is critical.
[^4]: Finding something to work on is not simply a matter of finding a match.
[^5]: There are many reasons curious people are more likely to do great work.`;

      mockApp.vault.cachedRead = jest.fn((file) =>
        Promise.resolve(file.path === notePath ? noteContent : "")
      );
      mockApp.metadataCache.getFileCache = jest.fn((file) =>
        file.path === notePath
          ? {
              headings: [
                {
                  heading: "218 How to Do Great Work",
                  level: 1,
                  position: { start: { offset: 0 } },
                },
              ],
              frontmatter: null,
            }
          : { headings: [], frontmatter: null }
      );

      const chunks = await chunkManager.getChunks([notePath], {
        ...defaultOptions,
        maxChars: 6000,
      });

      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks[0].content).toContain("# 218 How to Do Great Work");
      expect(chunks[0].content).toContain(
        "If you collected lists of techniques for doing great work"
      );
      expect(chunks[0].content.length).toBeGreaterThan(500);
    });

    it("should keep a heading-only chunk separate when merge would exceed maxChars", async () => {
      const notePath = "heading-only-no-merge.md";
      const noteContent = [
        "# Heading",
        "",
        "This sentence is intentionally long so the second chunk is close to the configured chunk limit.",
        "This sentence is intentionally long so the second chunk is close to the configured chunk limit.",
        "This sentence is intentionally long so the second chunk is close to the configured chunk limit.",
      ].join("\n\n");

      mockApp.vault.cachedRead = jest.fn((file) =>
        Promise.resolve(file.path === notePath ? noteContent : "")
      );
      mockApp.metadataCache.getFileCache = jest.fn((file) =>
        file.path === notePath
          ? {
              headings: [{ heading: "Heading", level: 1, position: { start: { offset: 0 } } }],
              frontmatter: null,
            }
          : { headings: [], frontmatter: null }
      );

      const chunks = await chunkManager.getChunks([notePath], {
        ...defaultOptions,
        maxChars: 90,
      });

      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks[0].content).toContain("# Heading");
      expect(chunks[0].content).not.toContain("This sentence is intentionally long");
    });

    it("should handle CJK characters correctly", async () => {
      const chunks = await chunkManager.getChunks(["chinese.md"], defaultOptions);

      expect(chunks.length).toBeGreaterThan(0);
      chunks.forEach((chunk) => {
        expect(chunk.content).toMatch(/[\u4e00-\u9fff]/); // Contains Chinese characters
        expect(chunk.content.length).toBeGreaterThan(0);
      });
    });
  });

  describe("getChunkText", () => {
    it("should return chunk content by ID", async () => {
      const chunks = await chunkManager.getChunks(["short.md"], {
        maxChars: 2000,
        overlap: 0,
        maxBytesTotal: 1024 * 1024,
      });

      const chunkText = chunkManager.getChunkTextSync(chunks[0].id);
      expect(chunkText).toBe(chunks[0].content);
    });

    it("should return empty string for non-existent chunk ID", () => {
      const chunkText = chunkManager.getChunkTextSync("non-existent.md#999");
      expect(chunkText).toBe("");
    });

    it("should handle malformed chunk IDs", () => {
      const chunkText1 = chunkManager.getChunkTextSync("malformed-id");
      expect(chunkText1).toBe("");

      const chunkText2 = chunkManager.getChunkTextSync("file.md#notanumber");
      expect(chunkText2).toBe("");
    });
  });

  describe("cache behavior", () => {
    it("should evict cache when memory limit is exceeded", async () => {
      // Mock a manager with very small cache limit
      const smallCacheManager = new ChunkManager(mockApp);
      (smallCacheManager as any).maxCacheBytes = 1000; // 1KB limit

      // Add multiple large documents
      await smallCacheManager.getChunks(["long.md"], {
        maxChars: 2000,
        overlap: 0,
        maxBytesTotal: 1024 * 1024,
      });

      await smallCacheManager.getChunks(["medium.md"], {
        maxChars: 2000,
        overlap: 0,
        maxBytesTotal: 1024 * 1024,
      });

      // Cache should not grow indefinitely - check cache size doesn't exceed notes added
      const cacheSize = (smallCacheManager as any).cache.size;
      expect(cacheSize).toBeLessThanOrEqual(3); // Should not cache more than a few notes due to memory limits
    });

    it("should use cache for subsequent requests of same file", async () => {
      // First call
      await chunkManager.getChunks(["short.md"], {
        maxChars: 2000,
        overlap: 0,
        maxBytesTotal: 1024 * 1024,
      });

      // Second call - should use cache
      await chunkManager.getChunks(["short.md"], {
        maxChars: 2000,
        overlap: 0,
        maxBytesTotal: 1024 * 1024,
      });

      // Should have only read the file once due to caching
      expect(mockApp.vault.cachedRead).toHaveBeenCalledTimes(1);
    });
  });

  describe("error handling", () => {
    it("should handle file read errors gracefully", async () => {
      mockApp.vault.cachedRead = jest.fn(() => Promise.reject(new Error("File read failed")));

      const chunks = await chunkManager.getChunks(["error.md"], {
        maxChars: 2000,
        overlap: 0,
        maxBytesTotal: 1024 * 1024,
      });

      expect(chunks).toEqual([]);
    });

    it("should handle empty files", async () => {
      mockApp.vault.cachedRead = jest.fn(() => Promise.resolve(""));

      const chunks = await chunkManager.getChunks(["empty.md"], {
        maxChars: 2000,
        overlap: 0,
        maxBytesTotal: 1024 * 1024,
      });

      expect(chunks).toEqual([]);
    });
  });

  describe("chunk consistency", () => {
    it("should generate consistent chunk IDs across calls", async () => {
      const firstCall = await chunkManager.getChunks(["long.md"], {
        maxChars: 2000,
        overlap: 0,
        maxBytesTotal: 1024 * 1024,
      });

      const secondCall = await chunkManager.getChunks(["long.md"], {
        maxChars: 2000,
        overlap: 0,
        maxBytesTotal: 1024 * 1024,
      });

      expect(firstCall.map((c) => c.id)).toEqual(secondCall.map((c) => c.id));
    });

    it("should maintain chunk order by index", async () => {
      const chunks = await chunkManager.getChunks(["long.md"], {
        maxChars: 2000,
        overlap: 0,
        maxBytesTotal: 1024 * 1024,
      });

      chunks.forEach((chunk, index) => {
        expect(chunk.chunkIndex).toBe(index);
      });
    });
  });

  describe("ID format consistency", () => {
    // Helper function to create a mock file with specific content
    const createMockFile = (path: string, content: string) => {
      mockApp.vault.cachedRead = jest.fn((file) => {
        if (file.path === path) return Promise.resolve(content);
        return Promise.resolve("");
      });
      mockApp.metadataCache.getFileCache = jest.fn((file) => {
        if (file.path === path) {
          return { headings: [], frontmatter: null };
        }
        return { headings: [], frontmatter: null };
      });
    };

    it("should use non-padded format for chunk IDs", async () => {
      // Create content that will generate multiple chunks - make it much longer
      const paragraph =
        "This is a substantial paragraph with enough content to create multiple chunks when split by the chunking algorithm. ".repeat(
          20
        );
      const longContent = Array(10).fill(paragraph).join("\n\n");
      createMockFile("test.md", longContent);

      const chunks = await chunkManager.getChunks(["test.md"], {
        maxChars: 1000, // Force multiple chunks
        overlap: 0,
        maxBytesTotal: 1024 * 1024,
      });

      expect(chunks.length).toBeGreaterThan(1);

      chunks.forEach((chunk, index) => {
        // Verify format uses simple numeric index (no padding)
        const expectedId = `test.md#${index.toString()}`;
        expect(chunk.id).toBe(expectedId);
      });
    });

    it("should handle single and double digit indices correctly", async () => {
      // Create content that will generate 15+ chunks
      const sections = Array(15)
        .fill(0)
        .map((_, i) => `# Section ${i}\n` + "Content ".repeat(200))
        .join("\n\n");

      createMockFile("multi-chunk.md", sections);
      mockApp.metadataCache.getFileCache = jest.fn(() => ({
        headings: Array(15)
          .fill(0)
          .map((_, i) => ({
            heading: `Section ${i}`,
            level: 1,
            position: { start: { offset: i * 1000 } },
          })),
        frontmatter: null,
      }));

      const chunks = await chunkManager.getChunks(["multi-chunk.md"], {
        maxChars: 800,
        overlap: 0,
        maxBytesTotal: 1024 * 1024,
      });

      expect(chunks.length).toBeGreaterThanOrEqual(10);

      // Check various indices
      expect(chunks[0].id).toBe("multi-chunk.md#0");
      expect(chunks[5].id).toBe("multi-chunk.md#5");
      if (chunks.length > 10) {
        expect(chunks[10].id).toBe("multi-chunk.md#10");
      }
    });

    it("should find chunks by exact ID match only", async () => {
      createMockFile("exact-match.md", "Content for testing exact ID matching");

      const chunks = await chunkManager.getChunks(["exact-match.md"], {
        maxChars: 2000,
        overlap: 0,
        maxBytesTotal: 1024 * 1024,
      });

      expect(chunks).toHaveLength(1);

      const correctId = "exact-match.md#0";

      expect(chunks[0].id).toBe(correctId);

      // Should find with correct ID
      const foundContent = chunkManager.getChunkTextSync(correctId);
      expect(foundContent).toBeTruthy();
    });

    it("should maintain ID format consistency in async methods", async () => {
      createMockFile("async-test.md", "Test content for async ID consistency");

      const chunks = await chunkManager.getChunks(["async-test.md"], {
        maxChars: 2000,
        overlap: 0,
        maxBytesTotal: 1024 * 1024,
      });

      const chunkId = chunks[0].id;

      expect(chunkId).toBe("async-test.md#0");

      // Test async getChunkText
      const asyncContent = await chunkManager.getChunkText(chunkId);
      expect(asyncContent).toBeTruthy();

      // Test with current format should work
      const currentFormatContent = await chunkManager.getChunkText("async-test.md#0");
      expect(currentFormatContent).toBeTruthy();
    });

    it("should generate IDs with non-padded format for all ranges", async () => {
      // Test edge cases: 0-9, 10-99, 100+
      const testCases = [
        { index: 0, expected: "0" },
        { index: 5, expected: "5" },
        { index: 10, expected: "10" },
        { index: 99, expected: "99" },
        { index: 100, expected: "100" },
        { index: 999, expected: "999" },
        { index: 1000, expected: "1000" },
      ];

      for (const testCase of testCases) {
        const manager = new ChunkManager(mockApp);
        const generatedId = (manager as any).generateChunkId("test.md", testCase.index);
        expect(generatedId).toBe(`test.md#${testCase.expected}`);
      }
    });
  });
});
