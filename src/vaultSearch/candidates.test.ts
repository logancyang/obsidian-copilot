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
          mtime: 20,
        },
        {
          path: "Notes/Stoic practice.md",
          name: "Stoic practice.md",
          basename: "Stoic practice",
          extension: "md",
          mtime: 10,
        },
        {
          path: "Papers/Unrelated.pdf",
          name: "Unrelated.pdf",
          basename: "Unrelated",
          extension: "pdf",
          mtime: 30,
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
