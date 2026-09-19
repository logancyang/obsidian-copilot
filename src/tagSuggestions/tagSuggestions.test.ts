import { BrevilabsApiError } from "@/LLMProviders/brevilabsClient";
import {
  addTagToFrontmatter,
  buildEvidenceQuestion,
  buildTagSuggestionState,
  collectTagCandidates,
  packTagSuggestionRequests,
  rankTagSuggestions,
  tagSuggestionErrorNotice,
  TagCandidate,
} from "@/tagSuggestions/tagSuggestions";
import { App, CachedMetadata, TFile } from "obsidian";

function file(path: string, mtime = 0): TFile {
  const TFileConstructor = TFile as unknown as new (path: string) => TFile;
  const value = new TFileConstructor(path);
  Object.assign(value, {
    parent: { path: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "" },
    stat: { mtime },
  });
  return value;
}

function metadata(tags: string[], frontmatter: Record<string, unknown> = {}): CachedMetadata {
  return {
    frontmatter,
    tags: tags.map((tag) => ({ tag: `#${tag}`, position: {} })),
  } as unknown as CachedMetadata;
}

function candidate(tag: string, titles = ["First", "Second"]): TagCandidate {
  return {
    key: tag.toLowerCase(),
    tag,
    count: titles.length,
    titles,
    prior: 0,
  };
}

describe("tagSuggestions", () => {
  describe("buildTagSuggestionState()", () => {
    it("uses the whole body for a short note and includes cached tags and aliases", () => {
      const active = file("Projects/Launch.md");
      const state = buildTagSuggestionState(
        active,
        "---\ntag: work\naliases: [Launch plan]\n---\nShort body",
        metadata(["inline"], { tag: "work", aliases: ["Launch plan"] })
      );

      expect(state).toEqual({
        title: "Launch",
        folder: "Projects",
        existing_tags: ["work", "inline"],
        aliases: ["Launch plan"],
        content: "Short body",
      });
    });

    it("builds the excerpt, headings, and first section lines for a long note", () => {
      const body = `# First\nFirst lead\n${"x".repeat(1600)}\n## Second\nSecond lead`;
      const state = buildTagSuggestionState(file("Long.md"), body, metadata([]));

      expect(state.content).toBeUndefined();
      expect(state.headings).toEqual(["First", "Second"]);
      expect(state.section_leads).toEqual(["First lead", "Second lead"]);
      expect(state.excerpt?.length).toBe(1500);
    });
  });

  describe("collectTagCandidates()", () => {
    it("filters existing and hex-colour tags, then applies the unchanged 600-item shortlist", () => {
      const active = file("Projects/Active.md", 10_000);
      const otherFiles = Array.from({ length: 605 }, (_, index) =>
        file(`Other/Note ${index}.md`, index)
      );
      const hexFile = file("Other/Colour.md");
      const caches = new Map<TFile, CachedMetadata>([
        [active, metadata(["existing"], { tags: ["existing"] })],
        ...otherFiles.map(
          (other, index) => [other, metadata([`tag-${String(index).padStart(3, "0")}`])] as const
        ),
        [hexFile, metadata(["abcdef"])],
      ]);
      const app = {
        vault: { getMarkdownFiles: () => [active, ...otherFiles, hexFile] },
        metadataCache: { getFileCache: (note: TFile) => caches.get(note) ?? null },
      } as unknown as App;

      const result = collectTagCandidates(app, active, "No lexical matches here");

      expect(result).toHaveLength(600);
      expect(result[0].tag).toBe("tag-000");
      expect(result.at(-1)?.tag).toBe("tag-599");
      expect(result.some(({ tag }) => tag === "existing" || tag === "abcdef")).toBe(false);
    });
  });

  describe("buildEvidenceQuestion()", () => {
    it("matches the evaluated evidence wording and clips evidence titles", () => {
      const question = buildEvidenceQuestion(
        candidate("research", ["A".repeat(80), "Second", "Third", "Fourth", "Ignored"])
      );

      expect(question).toEqual({
        type: "noul",
        instructions:
          'Should this note be tagged "#research"? In this vault "#research" is used on 5 notes, such as: ' +
          `${"A".repeat(59)}…; Second; Third; Fourth.`,
      });
    });
  });

  describe("packTagSuggestionRequests()", () => {
    it("splits evidence questions before the 28k token budget and keeps every body under 256 KB", () => {
      const candidates = Array.from({ length: 600 }, (_, index) =>
        candidate(`tag-${index}-${"x".repeat(120)}`, ["A".repeat(60), "B", "C", "D"])
      );

      const requests = packTagSuggestionRequests(
        { title: "Note", folder: "", existing_tags: [], content: "body" },
        candidates,
        "user-1"
      );

      expect(requests.length).toBeGreaterThan(1);
      for (const request of requests) {
        expect(request.estimatedTokens).toBeLessThanOrEqual(28_000);
        expect(
          new TextEncoder().encode(
            JSON.stringify({
              state: request.state,
              questions: request.questions,
              user_id: "user-1",
            })
          ).byteLength
        ).toBeLessThanOrEqual(256 * 1024);
      }
    });

    it("splits on encoded body size when unusual tag text grows faster than the token estimate", () => {
      const candidates = Array.from({ length: 600 }, (_, index) =>
        candidate(`${index}-${"\ud800".repeat(300)}`, ["Evidence"])
      );

      const requests = packTagSuggestionRequests(
        { title: "Note", folder: "", existing_tags: [], content: "body" },
        candidates,
        "user-1"
      );

      expect(requests.length).toBeGreaterThan(1);
      expect(
        requests.every(
          (request) =>
            new TextEncoder().encode(
              JSON.stringify({
                state: request.state,
                questions: request.questions,
                user_id: "user-1",
              })
            ).byteLength <=
            256 * 1024
        )
      ).toBe(true);
    });
  });

  describe("rankTagSuggestions()", () => {
    it("reads noul answers across packed responses and sorts highest first", () => {
      const candidates = [candidate("alpha", ["A"]), candidate("beta", ["B", "C"])];
      const requests = packTagSuggestionRequests(
        { title: "Note", folder: "", existing_tags: [], content: "body" },
        candidates,
        "user-1"
      );
      const response = { t0: { noul: 0.2 }, t1: { noul: 0.9 } };

      expect(rankTagSuggestions(requests, [response])).toEqual([
        { tag: "beta", score: 0.9 },
        { tag: "alpha", score: 0.2 },
      ]);
    });
  });

  describe("addTagToFrontmatter()", () => {
    it.each([
      ["no frontmatter", {}, ["suggested"]],
      ["empty tags", { tags: [] }, ["suggested"]],
      ["populated tags", { tags: ["existing"], owner: "Ada" }, ["existing", "suggested"]],
      ["mixed-value tags", { tags: [2024, "book"] }, [2024, "book", "suggested"]],
    ])("adds a tag for %s without changing other properties", async (_label, frontmatter, tags) => {
      const originalOwner = (frontmatter as { owner?: string }).owner;
      const processFrontMatter = jest.fn(
        async (_file: TFile, update: (value: Record<string, unknown>) => void) =>
          update(frontmatter)
      );
      const app = { fileManager: { processFrontMatter } } as unknown as App;
      const active = file("Active.md");

      await addTagToFrontmatter(app, active, "#suggested");

      expect(processFrontMatter).toHaveBeenCalledWith(active, expect.any(Function));
      expect(frontmatter).toMatchObject({ tags });
      expect((frontmatter as { owner?: string }).owner).toBe(originalOwner);
    });

    it("does not duplicate a case-insensitive existing tag", async () => {
      const frontmatter = { tags: ["Suggested"] };
      const app = {
        fileManager: {
          processFrontMatter: jest.fn(
            async (_file: TFile, update: (value: Record<string, unknown>) => void) =>
              update(frontmatter)
          ),
        },
      } as unknown as App;

      await addTagToFrontmatter(app, file("Active.md"), "suggested");

      expect(frontmatter.tags).toEqual(["Suggested"]);
    });
  });

  describe("tagSuggestionErrorNotice()", () => {
    it.each([
      [403, "A valid Copilot Plus license is required to suggest tags."],
      [413, "This vault has too much tag data to suggest tags."],
      [429, "Tag suggestions are rate limited. Try again later."],
      [504, "Tag suggestions timed out. Try again."],
    ])("maps HTTP %i to a short recovery notice", (status, expected) => {
      expect(tagSuggestionErrorNotice(new BrevilabsApiError("failed", status))).toBe(expected);
    });

    it("maps a network failure to a short retry notice", () => {
      expect(tagSuggestionErrorNotice(new Error("offline"))).toBe(
        "Couldn’t suggest tags. Check your connection and try again."
      );
    });
  });
});
