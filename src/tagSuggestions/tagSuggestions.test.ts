import { BrevilabsApiError } from "@/LLMProviders/brevilabsClient";
import {
  addTagToFrontmatter,
  buildEvidenceQuestion,
  buildTagSuggestionState,
  collectTagCandidates,
  frontmatterTags,
  noteTags,
  packTagSuggestionRequests,
  rankTagSuggestions,
  tagSuggestionErrorNotice,
  TagCandidate,
  TagSuggestionState,
} from "@/tagSuggestions/tagSuggestions";
import { App, CachedMetadata, TFile } from "obsidian";

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/492";

function file(path: string, mtime = 0, ctime = mtime): TFile {
  const TFileConstructor = TFile as unknown as new (path: string) => TFile;
  const value = new TFileConstructor(path);
  Object.assign(value, {
    parent: { path: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "" },
    stat: { mtime, ctime },
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
    firstUsed: "2025-01-01",
    lastUsed: "2026-01-01",
    sameFolder: 1,
    sharedTags: 2,
    examples: titles.map((title, index) => ({
      path: `Examples/${title}.md`,
      created: `2025-01-0${index + 1}`,
    })),
    prior: 0,
  };
}

function suggestionState(overrides: Partial<TagSuggestionState> = {}): TagSuggestionState {
  return {
    title: "Note",
    path: "Note.md",
    folder: "",
    created: "2026-01-01 10:00",
    modified: "2026-01-02 10:00",
    existing_tags: [],
    content: "body",
    ...overrides,
  };
}

describe("tagSuggestions", () => {
  it("ignores empty strings when reading a note's tags", () => {
    const cache = metadata([""], { tags: ["", " ", "#", "book"] });

    expect(frontmatterTags(cache)).toEqual(["book"]);
    expect(noteTags(cache)).toEqual(["book"]);
  });

  describe("buildTagSuggestionState()", () => {
    it("uses file metadata and cached vault context for a short note whose title contains a date (https://github.com/Brevilabs/obsidian-copilot-private/issues/492)", () => {
      const created = new Date(2026, 8, 18, 14, 30).getTime();
      const modified = new Date(2026, 8, 19, 9, 5).getTime();
      const active = file("Projects/2099-Launch.md", modified, created);
      const linked = file("References/Roadmap.md", created, created);
      const linking = file("Projects/Overview.md", created, created);
      const caches = new Map<TFile, CachedMetadata>([
        [
          active,
          metadata(["inline"], {
            tag: "work",
            aliases: "Launch plan",
            owner: "Ada",
            priority: ["high", 2],
            api_key: "must-not-leave-the-vault",
            password: "also-private",
            nested: { ignored: true },
            position: { start: 0 },
          }),
        ],
        [linked, metadata(["research", "inline"])],
        [linking, metadata(["research", "planning"])],
      ]);
      const app = {
        vault: { getMarkdownFiles: () => [active, linked, linking] },
        metadataCache: {
          getFileCache: (note: TFile) => caches.get(note) ?? null,
          resolvedLinks: {
            [active.path]: { [linked.path]: 1 },
            [linking.path]: { [active.path]: 1 },
          },
        },
      } as unknown as App;
      const state = buildTagSuggestionState(
        app,
        active,
        "---\ntag: work\naliases: Launch plan\n---\nShort body",
        caches.get(active) ?? null
      );

      expect(state).toEqual({
        title: "2099-Launch",
        path: "Projects/2099-Launch.md",
        folder: "Projects",
        created: "2026-09-18 14:30",
        modified: "2026-09-19 09:05",
        existing_tags: ["work", "inline"],
        aliases: ["Launch plan"],
        properties: { owner: "Ada", priority: ["high", 2] },
        links_out: ["Roadmap"],
        links_in: ["Overview"],
        neighbor_tags: [
          { tag: "research", count: 2 },
          { tag: "planning", count: 1 },
        ],
        content: "Short body",
      });
    });

    it("builds the excerpt, headings, and first section lines for a long note", () => {
      const body = `# First\nFirst lead\n${"x".repeat(1600)}\n## Second\nSecond lead`;
      const active = file("Long.md");
      const app = {
        vault: { getMarkdownFiles: () => [active] },
        metadataCache: { getFileCache: () => metadata([]), resolvedLinks: {} },
      } as unknown as App;
      const state = buildTagSuggestionState(app, active, body, metadata([]));

      expect(state.content).toBeUndefined();
      expect(state.headings).toEqual(["First", "Second"]);
      expect(state.section_leads).toEqual(["First lead", "Second lead"]);
      expect(state.excerpt?.length).toBe(1500);
    });

    it.each([
      "authorization",
      "credential",
      "private_key",
      "passphrase",
      "passwd",
      "aws_secret_access_key",
      "aws_session_token",
    ])(`excludes the credential-shaped frontmatter property %s (${ISSUE})`, (sensitiveKey) => {
      const active = file("Private.md");
      const cache = metadata([], { [sensitiveKey]: "must-not-leave", owner: "Ada" });
      const app = {
        vault: { getMarkdownFiles: () => [active] },
        metadataCache: { getFileCache: () => cache, resolvedLinks: {} },
      } as unknown as App;

      const state = buildTagSuggestionState(app, active, "body", cache);

      expect(state.properties).toEqual({ owner: "Ada" });
    });

    it(`strips frontmatter only at a standalone closing fence (${ISSUE})`, () => {
      const active = file("Private.md");
      const cache = metadata([], {
        description: "alpha---beta",
        password: "top-secret",
      });
      const app = {
        vault: { getMarkdownFiles: () => [active] },
        metadataCache: { getFileCache: () => cache, resolvedLinks: {} },
      } as unknown as App;

      const state = buildTagSuggestionState(
        app,
        active,
        '---\ndescription: "alpha---beta"\npassword: top-secret\n---\nSafe body',
        cache
      );

      expect(state.content).toBe("Safe body");
      expect(JSON.stringify(state)).not.toContain("top-secret");
    });

    it("caps properties, link titles, and neighbor tags from metadata only (https://github.com/Brevilabs/obsidian-copilot-private/issues/492)", () => {
      const active = file("Active.md");
      const neighbors = Array.from({ length: 25 }, (_, index) =>
        file(`Folder/Neighbor ${String(index).padStart(2, "0")}.md`)
      );
      const activeFrontmatter = Object.fromEntries(
        Array.from({ length: 25 }, (_, index) => [`property-${index}`, "x".repeat(100)])
      );
      const caches = new Map<TFile, CachedMetadata>([
        [active, metadata([], activeFrontmatter)],
        ...neighbors.map((neighbor, index) => [neighbor, metadata([`neighbor-${index}`])] as const),
      ]);
      const app = {
        vault: { getMarkdownFiles: () => [active, ...neighbors] },
        metadataCache: {
          getFileCache: (note: TFile) => caches.get(note) ?? null,
          resolvedLinks: {
            [active.path]: Object.fromEntries(neighbors.map((neighbor) => [neighbor.path, 1])),
            ...Object.fromEntries(
              neighbors.map((neighbor) => [neighbor.path, { [active.path]: 1 }])
            ),
          },
        },
      } as unknown as App;

      const state = buildTagSuggestionState(app, active, "body", caches.get(active) ?? null);

      expect(Object.keys(state.properties ?? {})).toHaveLength(20);
      expect(
        Object.values(state.properties ?? {}).every((value) => String(value).length <= 80)
      ).toBe(true);
      expect(state.links_out).toHaveLength(10);
      expect(state.links_in).toHaveLength(10);
      expect(state.neighbor_tags).toHaveLength(20);
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

    it("selects same-folder examples before nearest-created examples and reports candidate evidence (https://github.com/Brevilabs/obsidian-copilot-private/issues/492)", () => {
      const activeCreated = new Date(2026, 8, 10).getTime();
      const active = file("Projects/Active.md", activeCreated, activeCreated);
      const notes = [
        file("Projects/Near.md", 0, new Date(2026, 8, 9).getTime()),
        file("Projects/Far.md", 0, new Date(2024, 0, 1).getTime()),
        file("Other/Closest.md", 0, new Date(2026, 8, 11).getTime()),
        file("Other/Later.md", 0, new Date(2026, 8, 20).getTime()),
        file("Other/Ignored.md", 0, new Date(2025, 0, 1).getTime()),
      ];
      const caches = new Map<TFile, CachedMetadata>([
        [active, metadata(["shared"])],
        [notes[0], metadata(["candidate", "shared"])],
        [notes[1], metadata(["candidate"])],
        [notes[2], metadata(["candidate", "shared"])],
        [notes[3], metadata(["candidate"])],
        [notes[4], metadata(["candidate"])],
      ]);
      const app = {
        vault: { getMarkdownFiles: () => [active, ...notes] },
        metadataCache: { getFileCache: (note: TFile) => caches.get(note) ?? null },
      } as unknown as App;

      const [result] = collectTagCandidates(app, active, "body");

      expect(result).toMatchObject({
        tag: "candidate",
        count: 5,
        firstUsed: "2024-01-01",
        lastUsed: "2026-09-20",
        sameFolder: 2,
        sharedTags: 2,
        examples: [
          { path: "Projects/Near.md", created: "2026-09-09" },
          { path: "Projects/Far.md", created: "2024-01-01" },
          { path: "Other/Closest.md", created: "2026-09-11" },
          { path: "Other/Later.md", created: "2026-09-20" },
        ],
      });
    });
  });

  describe("buildEvidenceQuestion()", () => {
    it("includes dated usage, relationship counts, and clipped path examples in the version-2 wording (https://github.com/Brevilabs/obsidian-copilot-private/issues/492)", () => {
      const question = buildEvidenceQuestion(
        candidate("research", ["A".repeat(80), "Second", "Third", "Fourth", "Ignored"])
      );

      expect(question).toEqual({
        type: "noul",
        instructions:
          'Should this note be tagged "#research"? In this vault "#research" is used on 5 notes, first on 2025-01-01 and most recently on 2026-01-01. ' +
          "1 of them is in this note's folder and 2 share a tag with this note. Examples: " +
          `Examples/${"A".repeat(70)}… (created 2025-01-01); Examples/Second.md (created 2025-01-02); Examples/Third.md (created 2025-01-03); Examples/Fourth.md (created 2025-01-04).`,
      });
    });

    it("omits relationship clauses whose count is zero (https://github.com/Brevilabs/obsidian-copilot-private/issues/492)", () => {
      const question = buildEvidenceQuestion({
        ...candidate("research", ["Example"]),
        sameFolder: 0,
        sharedTags: 0,
      });

      expect(question.instructions).not.toContain("folder");
      expect(question.instructions).not.toContain("share a tag");
    });
  });

  describe("packTagSuggestionRequests()", () => {
    it("splits evidence questions before the 28k token budget and keeps every body under 256 KB", () => {
      const candidates = Array.from({ length: 600 }, (_, index) =>
        candidate(`tag-${index}-${"x".repeat(120)}`, ["A".repeat(60), "B", "C", "D"])
      );

      const requests = packTagSuggestionRequests(suggestionState(), candidates, "user-1");

      expect(requests.length).toBeGreaterThanOrEqual(4);
      expect(requests.length).toBeLessThanOrEqual(6);
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

    it("keeps the 1.3 evidence margin with the longer version-2 question wording (https://github.com/Brevilabs/obsidian-copilot-private/issues/492)", () => {
      const state = suggestionState({ content: undefined });
      const [request] = packTagSuggestionRequests(state, [candidate("research")], "user-1");
      const instruction = request.questions.t0.instructions;
      const stateTokens = Math.ceil(JSON.stringify(state).length / 4);
      const questionTokens = Math.ceil((Math.ceil(instruction.length / 4) + 8) * 1.3);

      expect(request.estimatedTokens).toBe(stateTokens + questionTokens);
    });

    it("splits on encoded body size when unusual tag text grows faster than the token estimate", () => {
      const candidates = Array.from({ length: 600 }, (_, index) =>
        candidate(`${index}-${"\ud800".repeat(300)}`, ["Evidence"])
      );

      const requests = packTagSuggestionRequests(suggestionState(), candidates, "user-1");

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
      const requests = packTagSuggestionRequests(suggestionState(), candidates, "user-1");
      const response = { t0: { noul: 0.2 }, t1: { noul: 0.9 } };

      expect(rankTagSuggestions(requests, [response])).toEqual([
        { tag: "beta", score: 0.9 },
        { tag: "alpha", score: 0.2 },
      ]);
    });
  });

  describe("addTagToFrontmatter()", () => {
    it.each([
      ["no frontmatter", {}, { tags: ["suggested"] }],
      ["empty tags", { tags: [] }, { tags: ["suggested"] }],
      ["empty tags property", { tags: null }, { tags: ["suggested"] }],
      ["empty tag property", { tag: null }, { tag: ["suggested"] }],
      ["empty-string tags", { tags: [""] }, { tags: ["suggested"] }],
      ["empty-string tag", { tag: [" ", "#"] }, { tag: ["suggested"] }],
      ["populated tags", { tags: ["existing"], owner: "Ada" }, { tags: ["existing", "suggested"] }],
      ["mixed-value tags", { tags: [2024, "book"] }, { tags: [2024, "book", "suggested"] }],
      ["singular tag scalar", { tag: "book" }, { tag: ["book", "suggested"] }],
      ["numeric tags scalar", { tags: 2024 }, { tags: [2024, "suggested"] }],
      ["boolean tag scalar", { tag: true }, { tag: [true, "suggested"] }],
      [
        "singular mixed-value tag array",
        { tag: [2024, "book"] },
        { tag: [2024, "book", "suggested"] },
      ],
    ])(
      "adds a tag for %s without changing other properties",
      async (_label, frontmatter, expected) => {
        const originalOwner = (frontmatter as { owner?: string }).owner;
        const processFrontMatter = jest.fn(
          async (_file: TFile, update: (value: Record<string, unknown>) => void) =>
            update(frontmatter)
        );
        const app = { fileManager: { processFrontMatter } } as unknown as App;
        const active = file("Active.md");

        await addTagToFrontmatter(app, active, ["#suggested"]);

        expect(processFrontMatter).toHaveBeenCalledWith(active, expect.any(Function));
        expect(frontmatter).toMatchObject(expected);
        expect("tag" in frontmatter && "tags" in frontmatter).toBe(false);
        expect((frontmatter as { owner?: string }).owner).toBe(originalOwner);
      }
    );

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

      await addTagToFrontmatter(app, file("Active.md"), ["suggested"]);

      expect(frontmatter.tags).toEqual(["Suggested"]);
    });

    it("strips empty strings from an existing list even when no tag changes", async () => {
      const frontmatter = { tags: ["", " ", "#", 2024, "book"] };
      const app = {
        fileManager: {
          processFrontMatter: jest.fn(
            async (_file: TFile, update: (value: Record<string, unknown>) => void) =>
              update(frontmatter)
          ),
        },
      } as unknown as App;

      await addTagToFrontmatter(app, file("Active.md"), []);

      expect(frontmatter.tags).toEqual([2024, "book"]);
    });

    it(`adds several tags in one frontmatter write without duplicating existing values (${ISSUE})`, async () => {
      const frontmatter = { tags: [2024, "Existing"] };
      const processFrontMatter = jest.fn(
        async (_file: TFile, update: (value: Record<string, unknown>) => void) =>
          update(frontmatter)
      );
      const app = { fileManager: { processFrontMatter } } as unknown as App;

      await addTagToFrontmatter(app, file("Active.md"), ["existing", "first", "#second"]);

      expect(processFrontMatter).toHaveBeenCalledTimes(1);
      expect(frontmatter.tags).toEqual([2024, "Existing", "first", "second"]);
    });

    it.each([
      ["mixed tags array", { tags: [2024, "book", "draft"] }, { tags: [2024, "draft"] }],
      ["tags scalar", { tags: "book" }, { tags: [] }],
      ["singular tag scalar", { tag: "book" }, { tag: [] }],
      ["null tags", { tags: null }, { tags: null }],
      ["null singular tag", { tag: null }, { tag: null }],
      ["numeric scalar", { tags: 2024 }, { tags: 2024 }],
    ])("removes from %s without losing preserved values", async (_label, frontmatter, expected) => {
      const app = {
        fileManager: {
          processFrontMatter: jest.fn(
            async (_file: TFile, update: (value: Record<string, unknown>) => void) =>
              update(frontmatter)
          ),
        },
      } as unknown as App;

      await addTagToFrontmatter(app, file("Active.md"), [], ["#book"]);

      expect(frontmatter).toEqual(expected);
    });

    it(`adds and removes in one frontmatter write (${ISSUE})`, async () => {
      const frontmatter = { tags: [2024, "old", "keep"] };
      const processFrontMatter = jest.fn(
        async (_file: TFile, update: (value: Record<string, unknown>) => void) =>
          update(frontmatter)
      );
      const app = { fileManager: { processFrontMatter } } as unknown as App;

      await addTagToFrontmatter(app, file("Active.md"), ["new"], ["old"]);

      expect(processFrontMatter).toHaveBeenCalledTimes(1);
      expect(frontmatter.tags).toEqual([2024, "keep", "new"]);
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
