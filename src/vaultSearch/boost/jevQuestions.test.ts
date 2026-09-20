import {
  MAX_JEV_FILE_LIST_FILES,
  MAX_MIYO_CONTENT_CHARS,
  SEND_MIYO_CONTENT_TO_JEV,
  SEND_VAULT_FILE_LIST_TO_JEV,
  buildJevRequest,
  parseJevProbabilities,
} from "@/vaultSearch/boost/jevQuestions";
import type { BoostPoolCandidate } from "@/vaultSearch/boost/boostPool";

const issue = "https://github.com/Brevilabs/obsidian-copilot-private/issues/516";

const candidate: BoostPoolCandidate = {
  candidate: {
    path: "Inbox/Papers/Attention.pdf",
    title: "Attention Is All You Need",
    folder: "Inbox/Papers",
    extension: "pdf",
    snippet: "Transformers replace recurrent sequence models.",
    content: "Transformers replace recurrent sequence models.".repeat(20),
    mtime: new Date(2026, 8, 18, 9, 30).getTime(),
    score: null,
    source: "recent",
  },
  file: {
    path: "Inbox/Papers/Attention.pdf",
    name: "Attention Is All You Need.pdf",
    basename: "Attention Is All You Need",
    extension: "pdf",
    ctime: new Date(2026, 8, 17, 16, 5).getTime(),
    mtime: new Date(2026, 8, 18, 9, 30).getTime(),
    size: 2_100_000,
    tags: ["paper"],
  },
  sources: ["miyo", "created"],
  searchScore: null,
  searchRank: null,
};

describe("jevQuestions", () => {
  describe("buildJevRequest()", () => {
    it(`sends local and relative dates plus capped Miyo content behind the demo switch (${issue})`, () => {
      const request = buildJevRequest(
        "the pdf i got yesterday",
        "Main",
        [candidate],
        [candidate.file],
        new Date(2026, 8, 18, 14, 32)
      );
      const file = request.questions.c0.instructions.file;

      expect(SEND_MIYO_CONTENT_TO_JEV).toBe(true);
      expect(SEND_VAULT_FILE_LIST_TO_JEV).toBe(true);
      expect(request.state).toMatchObject({
        query: "the pdf i got yesterday",
        vault: "Main",
      });
      expect(request.state.now).toContain("local time");
      expect(file).toMatchObject({
        name: "Attention Is All You Need.pdf",
        size: "2.1 MB",
        tags: ["paper"],
        search_score: null,
        search_rank: null,
      });
      expect(file.content).toHaveLength(MAX_MIYO_CONTENT_CHARS);
      expect(file.created).toContain("yesterday");
      expect(file.modified).toContain("today");
      expect(file.size_rank).toBe("1 of 1 pdf files (largest first)");
      expect(file.created_rank).toBe("1 of 1 pdf files (newest first)");
      expect(file.modified_rank).toBe("1 of 1 pdf files (newest first)");
      expect(request.state.file_inventory).toContain("Inbox/Papers/Attention.pdf");
    });

    it(`keeps filename and recency candidates metadata-only (${issue})`, () => {
      const localCandidate: BoostPoolCandidate = {
        ...candidate,
        candidate: { ...candidate.candidate, source: "filename" as const },
        sources: ["filename", "created"],
      };

      const request = buildJevRequest(
        "paper",
        "Main",
        [localCandidate],
        [localCandidate.file],
        new Date(2026, 8, 18, 14, 32)
      );

      expect(request.questions.c0.instructions.file.content).toBeUndefined();
      expect(request.questions.c0.instructions.file.created).toBeTruthy();
      expect(request.questions.c0.instructions.file.modified).toBeTruthy();
    });

    it(`adds exact peer ranks and neutral criteria for comparative queries (${issue})`, () => {
      const epubFiles = [
        {
          ...candidate.file,
          path: "Books/Largest.epub",
          name: "Largest.epub",
          extension: "epub",
          size: 1_400_000,
          ctime: 10,
          mtime: 30,
        },
        {
          ...candidate.file,
          path: "Books/Middle.epub",
          name: "Middle.epub",
          extension: "epub",
          size: 1_200_000,
          ctime: 20,
          mtime: 20,
        },
        {
          ...candidate.file,
          path: "Books/Smallest.epub",
          name: "Smallest.epub",
          extension: "epub",
          size: 10,
          ctime: 30,
          mtime: 10,
        },
      ];
      const largest: BoostPoolCandidate = {
        ...candidate,
        file: epubFiles[0],
        candidate: {
          ...candidate.candidate,
          path: epubFiles[0].path,
          extension: "epub",
        },
      };

      const request = buildJevRequest(
        "the largest epub",
        "Main",
        [largest],
        epubFiles,
        new Date(2026, 8, 18, 14, 32)
      );
      const question = request.questions.c0;

      expect(question.instructions.file).toMatchObject({
        size_rank: "1 of 3 epub files (largest first)",
        created_rank: "3 of 3 epub files (newest first)",
        modified_rank: "1 of 3 epub files (newest first)",
      });
      expect(question.criteria.true).toContain("query asks about a decision");
      expect(question.criteria.false).not.toContain("records a superseded decision");
      expect(request.state.file_inventory).toContain("Books/Middle.epub");
      expect(request.state.file_type_counts).toEqual({ epub: 3 });
    });

    it(`omits the whole-vault list above the cap but keeps per-type counts and ranks (${issue})`, () => {
      const files = Array.from({ length: MAX_JEV_FILE_LIST_FILES + 1 }, (_, index) => ({
        ...candidate.file,
        path: `Notes/${index}.md`,
        name: `${index}.md`,
        extension: "md",
        size: index,
      }));
      const ranked: BoostPoolCandidate = {
        ...candidate,
        file: files[MAX_JEV_FILE_LIST_FILES],
        candidate: {
          ...candidate.candidate,
          path: files[MAX_JEV_FILE_LIST_FILES].path,
          extension: "md",
        },
      };

      const request = buildJevRequest(
        "largest note",
        "Main",
        [ranked],
        files,
        new Date(2026, 8, 18, 14, 32)
      );

      expect(request.state.file_inventory).toBeUndefined();
      expect(request.state.file_inventory_omitted).toBe(true);
      expect(request.state.file_type_counts).toEqual({ md: MAX_JEV_FILE_LIST_FILES + 1 });
      expect(request.questions.c0.instructions.file.size_rank).toBe(
        `1 of ${MAX_JEV_FILE_LIST_FILES + 1} md files (largest first)`
      );
    });
  });

  describe("parseJevProbabilities()", () => {
    it(`maps finite noul answers to paths and ignores malformed answers (${issue})`, () => {
      const probabilities = parseJevProbabilities(
        [candidate, { ...candidate, candidate: { ...candidate.candidate, path: "Other.md" } }],
        { c0: { noul: 0.92 }, c1: { noul: Number.NaN }, extra: { noul: 1 } }
      );

      expect(probabilities).toEqual(new Map([[candidate.candidate.path, 0.92]]));
    });
  });
});
