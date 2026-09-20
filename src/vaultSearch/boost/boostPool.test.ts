import {
  BOOST_CREATED_COUNT,
  BOOST_FILENAME_COUNT,
  BOOST_MAX_CANDIDATES,
  BOOST_MIYO_COUNT,
  BOOST_MODIFIED_COUNT,
  buildBoostPool,
} from "@/vaultSearch/boost/boostPool";
import type { SearchCandidate, SearchFile } from "@/vaultSearch/types";

const issue = "https://github.com/Brevilabs/obsidian-copilot-private/issues/516";

function file(index: number): SearchFile {
  return {
    path: `Folder/File ${index}.pdf`,
    name: `File ${index}.pdf`,
    basename: `File ${index}`,
    extension: "pdf",
    ctime: index,
    mtime: index,
    size: 1_000 + index,
    tags: [`tag-${index}`],
  };
}

function miyoCandidate(index: number): SearchCandidate {
  return {
    path: `Folder/File ${index}.pdf`,
    title: `File ${index}`,
    folder: "Folder",
    extension: "pdf",
    snippet: `Snippet ${index}`,
    mtime: index,
    score: 1 - index / 100,
    source: "miyo",
  };
}

describe("boostPool", () => {
  describe("buildBoostPool()", () => {
    it(`uses the named source quotas, records overlapping sources, deduplicates paths, and caps the pool (${issue})`, () => {
      const files = Array.from({ length: 60 }, (_, index) => ({
        ...file(index),
        ctime: index >= 30 && index < 40 ? 2_000 + index : 0,
        mtime: index >= 40 && index < 45 ? 2_000 + index : 0,
      }));
      const pool = buildBoostPool({
        basicCandidates: Array.from({ length: 30 }, (_, index) => miyoCandidate(index)),
        files,
        selectedTypes: new Set(["pdf"]),
        fuzzySearch: (name) => {
          const index = Number(name.replace("File ", ""));
          return index < 10 ? { score: 100 - index, matches: [] } : null;
        },
      });

      expect(BOOST_MIYO_COUNT).toBe(25);
      expect(BOOST_FILENAME_COUNT).toBe(10);
      expect(BOOST_CREATED_COUNT).toBe(10);
      expect(BOOST_MODIFIED_COUNT).toBe(5);
      expect(BOOST_MAX_CANDIDATES).toBe(40);
      expect(pool).toHaveLength(40);
      expect(new Set(pool.map(({ candidate }) => candidate.path)).size).toBe(40);
      expect(pool[0]).toMatchObject({
        candidate: { path: "Folder/File 0.pdf" },
        searchScore: 1,
        searchRank: 1,
      });
      expect(pool[0].sources).toContain("miyo");
      expect(pool[0].sources).toContain("filename");
    });

    it(`limits recency candidates to checked file types (${issue})`, () => {
      const pool = buildBoostPool({
        basicCandidates: [],
        files: [file(1), { ...file(2), path: "Books/Book.epub", extension: "epub" }],
        selectedTypes: new Set(["epub"]),
        fuzzySearch: () => null,
      });

      expect(pool.map(({ candidate }) => candidate.path)).toEqual(["Books/Book.epub"]);
      expect(pool[0].sources).toEqual(expect.arrayContaining(["created", "modified"]));
      expect(pool[0]).toMatchObject({ searchScore: null, searchRank: null });
    });
  });
});
