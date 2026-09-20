import {
  filterCandidatesByTypes,
  groupMiyoResults,
  matchFilesByName,
} from "@/vaultSearch/candidates";
import type { SearchCandidate, SearchFile } from "@/vaultSearch/types";

const issue = "https://github.com/Brevilabs/obsidian-copilot-private/issues/515";

describe("candidates", () => {
  describe("groupMiyoResults()", () => {
    it(`groups chunks by file and keeps the best score with its snippet (${issue})`, () => {
      const grouped = groupMiyoResults(
        [
          {
            id: "low",
            path: "Books/Stoicism.epub",
            score: 0.42,
            snippet: "A lower-scoring passage",
            mtime: 10,
          },
          {
            id: "best",
            path: "Books/Stoicism.epub",
            score: 0.91,
            snippet: "The most relevant passage",
            mtime: 20,
          },
          {
            id: "pdf",
            path: "Papers/Attention.pdf",
            score: 0.73,
            snippet: "Transformers",
            mtime: 30,
          },
        ],
        new Set(["epub", "pdf"])
      );

      expect(grouped).toEqual([
        expect.objectContaining({
          path: "Books/Stoicism.epub",
          extension: "epub",
          score: 0.91,
          snippet: "The most relevant passage",
        }),
        expect.objectContaining({ path: "Papers/Attention.pdf", score: 0.73 }),
      ]);
    });

    it(`checks the real path extension instead of trusting Miyo's extension field (${issue})`, () => {
      expect(
        groupMiyoResults(
          [
            {
              id: "mismatch",
              path: "Notes/Reading.md",
              extension: "pdf",
              score: 0.8,
              snippet: "wrong type metadata",
            },
          ],
          new Set(["pdf"])
        )
      ).toEqual([]);
    });
  });

  describe("matchFilesByName()", () => {
    it(`returns checked file types in fuzzy-score order for files Miyo may not index (${issue})`, () => {
      const files: SearchFile[] = [
        {
          path: "Books/Stoic Handbook.epub",
          name: "Stoic Handbook.epub",
          basename: "Stoic Handbook",
          extension: "epub",
          ctime: 20,
          mtime: 20,
          size: 0,
          tags: [],
        },
        {
          path: "Notes/Stoic practice.md",
          name: "Stoic practice.md",
          basename: "Stoic practice",
          extension: "md",
          ctime: 10,
          mtime: 10,
          size: 0,
          tags: [],
        },
        {
          path: "Papers/Unrelated.pdf",
          name: "Unrelated.pdf",
          basename: "Unrelated",
          extension: "pdf",
          ctime: 30,
          mtime: 30,
          size: 0,
          tags: [],
        },
      ];
      const scores = new Map([
        ["Stoic Handbook", 10],
        ["Stoic practice", 5],
      ]);

      const matches = matchFilesByName(files, new Set(["epub", "md"]), (name) => {
        const score = scores.get(name);
        return score === undefined ? null : { score, matches: [] };
      });

      expect(matches.map(({ path }) => path)).toEqual([
        "Books/Stoic Handbook.epub",
        "Notes/Stoic practice.md",
      ]);
      expect(matches.every(({ source }) => source === "filename")).toBe(true);
    });

    it(`returns only the 50 best filename matches in large vaults (${issue})`, () => {
      const files: SearchFile[] = Array.from({ length: 60 }, (_, index) => ({
        path: `Notes/Match ${index}.md`,
        name: `Match ${index}.md`,
        basename: `Match ${index}`,
        extension: "md",
        ctime: index,
        mtime: index,
        size: 0,
        tags: [],
      }));

      const matches = matchFilesByName(files, new Set(["md"]), (name) => ({
        score: Number(name.replace("Match ", "")),
        matches: [],
      }));

      expect(matches).toHaveLength(50);
      expect(matches[0].path).toBe("Notes/Match 59.md");
      expect(matches[49].path).toBe("Notes/Match 10.md");
    });
  });

  describe("filterCandidatesByTypes()", () => {
    it(`removes unchecked types immediately from existing results (${issue})`, () => {
      const candidates: SearchCandidate[] = [
        {
          path: "Books/Stoicism.epub",
          title: "Stoicism",
          folder: "Books",
          extension: "epub",
          snippet: "",
          mtime: 0,
          score: 0.9,
          source: "miyo",
        },
        {
          path: "Papers/Attention.pdf",
          title: "Attention",
          folder: "Papers",
          extension: "pdf",
          snippet: "",
          mtime: 0,
          score: 0.8,
          source: "miyo",
        },
      ];

      expect(filterCandidatesByTypes(candidates, new Set(["pdf"])).map(({ path }) => path)).toEqual(
        ["Papers/Attention.pdf"]
      );
    });
  });
});
