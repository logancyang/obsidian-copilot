import { Document } from "@langchain/core/documents";
import { mergeFilterAndSearchResults } from "./mergeResults";

function makeDoc(path: string, source: string, score = 1.0): Document {
  return new Document({
    pageContent: `Content of ${path}`,
    metadata: { path, source, score, includeInContext: true },
  });
}

describe("mergeFilterAndSearchResults", () => {
  it("should return both filter and search docs when no overlap", () => {
    const filterDocs = [makeDoc("filter1.md", "title-match")];
    const searchDocs = [makeDoc("search1.md", "v3", 0.8)];

    const result = mergeFilterAndSearchResults(filterDocs, searchDocs);

    expect(result.filterResults).toHaveLength(1);
    expect(result.filterResults[0].metadata.path).toBe("filter1.md");
    expect(result.searchResults).toHaveLength(1);
    expect(result.searchResults[0].metadata.path).toBe("search1.md");
  });

  it("should drop search docs that overlap with filter paths", () => {
    const filterDocs = [makeDoc("shared.md", "title-match")];
    const searchDocs = [makeDoc("shared.md", "v3", 0.8), makeDoc("unique.md", "v3", 0.6)];

    const result = mergeFilterAndSearchResults(filterDocs, searchDocs);

    expect(result.filterResults).toHaveLength(1);
    expect(result.searchResults).toHaveLength(1);
    expect(result.searchResults[0].metadata.path).toBe("unique.md");
  });

  it("should handle empty filter docs", () => {
    const searchDocs = [makeDoc("a.md", "v3", 0.8), makeDoc("b.md", "v3", 0.6)];

    const result = mergeFilterAndSearchResults([], searchDocs);

    expect(result.filterResults).toHaveLength(0);
    expect(result.searchResults).toHaveLength(2);
  });

  it("should handle empty search docs", () => {
    const filterDocs = [makeDoc("a.md", "title-match"), makeDoc("b.md", "tag-match")];

    const result = mergeFilterAndSearchResults(filterDocs, []);

    expect(result.filterResults).toHaveLength(2);
    expect(result.searchResults).toHaveLength(0);
  });

  it("should handle both empty", () => {
    const result = mergeFilterAndSearchResults([], []);

    expect(result.filterResults).toHaveLength(0);
    expect(result.searchResults).toHaveLength(0);
  });

  it("should never remove filter docs even if paths overlap", () => {
    const filterDocs = [makeDoc("a.md", "title-match"), makeDoc("b.md", "tag-match")];
    const searchDocs = [
      makeDoc("a.md", "v3", 0.9),
      makeDoc("b.md", "v3", 0.8),
      makeDoc("c.md", "v3", 0.7),
    ];

    const result = mergeFilterAndSearchResults(filterDocs, searchDocs);

    // All filter docs preserved
    expect(result.filterResults).toHaveLength(2);
    // Only c.md survives (a.md and b.md are deduped out of search)
    expect(result.searchResults).toHaveLength(1);
    expect(result.searchResults[0].metadata.path).toBe("c.md");
  });

  it("should handle docs without path metadata gracefully", () => {
    const nopathDoc = new Document({
      pageContent: "No path",
      metadata: { source: "v3", score: 0.5 },
    });

    const filterDocs = [makeDoc("a.md", "title-match")];

    const result = mergeFilterAndSearchResults(filterDocs, [nopathDoc]);

    // Doc without path should survive (not matched against filter paths)
    expect(result.searchResults).toHaveLength(1);
  });
});
