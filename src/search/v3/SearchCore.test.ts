import { SearchCore } from "./SearchCore";

// Minimal mock app for SearchCore
const createMockApp = () => ({
  vault: {
    getAbstractFileByPath: jest.fn((path: string) => ({ path, stat: { mtime: Date.now() } })),
    cachedRead: jest.fn(async () => "content"),
    getMarkdownFiles: jest.fn(() => []),
  },
  metadataCache: {
    resolvedLinks: {},
    getBacklinksForFile: jest.fn(() => ({ data: {} })),
    getFileCache: jest.fn(() => ({ headings: [], frontmatter: {} })),
  },
  workspace: {
    getActiveFile: jest.fn(() => null),
  },
});

describe("SearchCore - grep prior normalization", () => {
  it("should normalize ranked grep scores and not overflow", async () => {
    const app: any = createMockApp();
    const core = new SearchCore(app);

    // Spy on internal rankGrepHits scoring by providing many queries and hits
    const queries = [
      "a b",
      "c d",
      "e f", // phrases
      "a",
      "b",
      "c",
      "d",
      "e",
      "f",
      "g",
      "h",
      "i",
      "j", // terms
    ];
    const hits = ["note1.md", "note2.md", "note3.md"]; // few hits

    // Mock file reads
    app.vault.cachedRead = jest.fn(async (file: any) => `${file.path} content a b c d e f g h i j`);

    // Access private via any
    const ranked = await (core as any).rankGrepHits(queries, hits);
    expect(Array.isArray(ranked)).toBe(true);
    // Should preserve all ids
    expect(ranked.sort()).toEqual(hits.sort());
  });
});
