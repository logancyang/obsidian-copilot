import {
  MAX_MIYO_CONTENT_CHARS,
  SEND_MIYO_CONTENT_TO_JEV,
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
        new Date(2026, 8, 18, 14, 32)
      );

      expect(request.questions.c0.instructions.file.content).toBeUndefined();
      expect(request.questions.c0.instructions.file.created).toBeTruthy();
      expect(request.questions.c0.instructions.file.modified).toBeTruthy();
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
