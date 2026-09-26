import {
  BOOST_ATTRIBUTE_EXTREME_COUNT,
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
    it(`uses the named source quotas, records overlapping sources, and deduplicates paths (${issue})`, () => {
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

      expect(BOOST_MIYO_COUNT).toBe(100);
      expect(BOOST_FILENAME_COUNT).toBe(20);
      expect(BOOST_ATTRIBUTE_EXTREME_COUNT).toBe(3);
      expect(BOOST_CREATED_COUNT).toBe(20);
      expect(BOOST_MODIFIED_COUNT).toBe(10);
      expect(BOOST_MAX_CANDIDATES).toBe(150);
      expect(new Set(pool.map(({ candidate }) => candidate.path)).size).toBe(pool.length);
      expect(pool[0]).toMatchObject({
        candidate: { path: "Folder/File 0.pdf" },
        searchScore: 1,
        searchRank: 1,
      });
      expect(pool[0].sources).toContain("miyo");
      expect(pool[0].sources).toContain("filename");
    });

    it(`fully represents all four source quotas when their candidates are disjoint (${issue})`, () => {
      const files = Array.from({ length: 150 }, (_, index) => ({
        ...file(index),
        ctime: index >= 120 && index < 140 ? 2_000 + index : 0,
        mtime: index >= 140 ? 2_000 + index : 0,
      }));
      const pool = buildBoostPool({
        basicCandidates: Array.from({ length: 100 }, (_, index) => miyoCandidate(index)),
        files,
        selectedTypes: new Set(["pdf"]),
        fuzzySearch: (name) => {
          const index = Number(name.replace("File ", ""));
          return index >= 100 && index < 120 ? { score: 200 - index, matches: [] } : null;
        },
      });

      expect(pool).toHaveLength(150);
      expect(pool.filter(({ sources }) => sources.includes("miyo"))).toHaveLength(100);
      expect(pool.filter(({ sources }) => sources.includes("filename"))).toHaveLength(20);
      expect(pool.filter(({ sources }) => sources.includes("created"))).toHaveLength(20);
      expect(pool.filter(({ sources }) => sources.includes("modified"))).toHaveLength(10);
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

    it(`adds size and date extremes for every checked file type (${issue})`, () => {
      const files = ["epub", "pdf"].flatMap((extension, typeIndex) =>
        Array.from({ length: 8 }, (_, index) => ({
          ...file(typeIndex * 10 + index),
          path: `Books/${extension}-${index}.${extension}`,
          name: `${extension}-${index}.${extension}`,
          basename: `${extension}-${index}`,
          extension,
          size: 1_000 + index,
          ctime: 10_000 + index,
          mtime: 20_000 + index,
        }))
      );

      const pool = buildBoostPool({
        basicCandidates: [],
        files,
        selectedTypes: new Set(["epub", "pdf"]),
        fuzzySearch: () => null,
      });
      const attributePaths = new Set(
        pool
          .filter(({ sources }) => sources.includes("attributes"))
          .map(({ candidate }) => candidate.path)
      );

      for (const extension of ["epub", "pdf"]) {
        for (const index of [0, 1, 2, 5, 6, 7]) {
          expect(attributePaths).toContain(`Books/${extension}-${index}.${extension}`);
        }
      }
      expect(
        pool.find(({ candidate }) => candidate.path === "Books/epub-7.epub")?.candidate.snippet
      ).toBe("1007 B · EPUB");
    });
  });
});
