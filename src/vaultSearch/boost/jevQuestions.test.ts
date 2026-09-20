import {
  MAX_JEV_STATE_BYTES,
  MAX_MIYO_CONTENT_CHARS,
  SEND_MIYO_CONTENT_TO_JEV,
  buildJevRequests,
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

function buildRequest(
  query: string,
  vault: string,
  pool: BoostPoolCandidate[],
  files: BoostPoolCandidate["file"][],
  now: Date
) {
  return buildJevRequests(query, vault, [pool], files, now)[0];
}

describe("jevQuestions", () => {
  describe("buildJevRequests()", () => {
    it(`sends local and relative dates plus capped Miyo content behind the demo switch (${issue})`, () => {
      const request = buildRequest(
        "the pdf i got yesterday",
        "Main",
        [candidate],
        [candidate.file],
        new Date(2026, 8, 18, 14, 32)
      );
      const file = request.questions.c0.instructions.file;

      expect(SEND_MIYO_CONTENT_TO_JEV).toBe(true);
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
    });

    it(`keeps filename and recency candidates metadata-only (${issue})`, () => {
      const localCandidate: BoostPoolCandidate = {
        ...candidate,
        candidate: { ...candidate.candidate, source: "filename" as const },
        sources: ["filename", "created"],
      };

      const request = buildRequest(
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

      const request = buildRequest(
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
      expect(request.state.file_type_counts).toEqual({ epub: 3 });
    });

    it(`includes the complete inventory only when the UTF-8 state fits its byte budget (${issue})`, () => {
      const fittingFile = {
        ...candidate.file,
        path: `Notes/${"界".repeat(13_000)}.md`,
        name: "fits.md",
        extension: "md",
      };
      const oversizedFile = {
        ...candidate.file,
        path: `Notes/${"界".repeat(13_500)}.md`,
        name: "too-large.md",
        extension: "md",
      };

      const fitting = buildRequest(
        "largest note",
        "Main",
        [{ ...candidate, file: fittingFile }],
        [fittingFile],
        new Date(2026, 8, 18, 14, 32)
      );
      const oversized = buildRequest(
        "largest note",
        "Main",
        [{ ...candidate, file: oversizedFile }],
        [oversizedFile],
        new Date(2026, 8, 18, 14, 32)
      );

      expect(fitting.state.file_inventory).toContain(fittingFile.path);
      expect(
        new TextEncoder().encode(JSON.stringify(fitting.state)).byteLength
      ).toBeLessThanOrEqual(MAX_JEV_STATE_BYTES);
      expect(oversized.state).toMatchObject({
        file_type_counts: { md: 1 },
        file_inventory_omitted: true,
      });
      expect(oversized.state.file_inventory).toBeUndefined();
    });

    it(`falls back to counts and exact ranks instead of sending a partial inventory (${issue})`, () => {
      const files = [
        { ...candidate.file, path: `Notes/${"a".repeat(22_000)}.md`, name: "first.md" },
        { ...candidate.file, path: `Notes/${"b".repeat(22_000)}.md`, name: "second.md" },
      ];
      const ranked = {
        ...candidate,
        file: files[0],
        candidate: { ...candidate.candidate, path: files[0].path },
      };

      const request = buildRequest(
        "largest note",
        "Main",
        [ranked],
        files,
        new Date(2026, 8, 18, 14, 32)
      );

      expect(request.state.file_inventory).toBeUndefined();
      expect(request.state.file_inventory_omitted).toBe(true);
      expect(request.state.file_type_counts).toEqual({ pdf: 2 });
      expect(request.questions.c0.instructions.file.size_rank).toBe(
        "1 of 2 pdf files (largest first)"
      );
    });

    it(`reuses one state across every batch in a search (${issue})`, () => {
      const requests = buildJevRequests(
        "paper",
        "Main",
        [[candidate], [candidate]],
        [candidate.file],
        new Date(2026, 8, 18, 14, 32)
      );

      expect(requests).toHaveLength(2);
      expect(requests[0].state).toBe(requests[1].state);
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
