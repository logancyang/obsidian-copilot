import { App, MetadataCache, TFile } from "obsidian";
import { NoteIdRank } from "../interfaces";
import { GraphBoostCalculator } from "./GraphBoostCalculator";

// Mock Obsidian API
const mockBacklinks = new Map<string, Set<string>>();
const mockTags = new Map<string, string[]>();
const mockFiles = new Map<string, TFile>();

const createMockFile = (path: string): TFile => {
  const file = {
    path,
    basename: path.split("/").pop()?.replace(".md", "") || "",
    extension: "md",
  } as TFile;
  mockFiles.set(path, file);
  return file;
};

const mockMetadataCache = {
  getFirstLinkpathDest: (linkpath: string) => {
    return mockFiles.get(linkpath) || null;
  },
  getBacklinksForFile: (file: TFile) => {
    const backlinks = mockBacklinks.get(file.path);
    if (!backlinks) return null;

    const data = new Map<string, any>();
    backlinks.forEach((link) => data.set(link, {}));
    return { data } as any;
  },
  getFileCache: (file: TFile) => {
    const tags = mockTags.get(file.path);
    if (!tags || tags.length === 0) return null;

    return {
      tags: tags.map((tag) => ({ tag })),
    } as any;
  },
} as unknown as MetadataCache;

const mockApp = {
  metadataCache: mockMetadataCache,
} as App;

describe("GraphBoostCalculator", () => {
  beforeEach(() => {
    // Clear all mocks
    mockBacklinks.clear();
    mockTags.clear();
    mockFiles.clear();
  });

  describe("basic functionality", () => {
    it("should return results unchanged when disabled", () => {
      const boost = new GraphBoostCalculator(mockApp, { enabled: false });
      const results: NoteIdRank[] = [
        { id: "note1.md", score: 1.0, engine: "rrf" },
        { id: "note2.md", score: 0.8, engine: "rrf" },
      ];

      const boosted = boost.applyBoost(results);
      expect(boosted).toEqual(results);
    });

    it("should return results unchanged when no connections exist", () => {
      const boost = new GraphBoostCalculator(mockApp);

      // Create files but no connections
      createMockFile("note1.md");
      createMockFile("note2.md");

      const results: NoteIdRank[] = [
        { id: "note1.md", score: 1.0, engine: "rrf" },
        { id: "note2.md", score: 0.8, engine: "rrf" },
      ];

      const boosted = boost.applyBoost(results);
      expect(boosted[0].score).toBe(1.0);
      expect(boosted[1].score).toBe(0.8);
    });
  });

  describe("backlink boost", () => {
    it("should boost notes with backlinks from other top results", () => {
      const boost = new GraphBoostCalculator(mockApp, {
        backlinkWeight: 1.0,
        coCitationWeight: 0,
        sharedTagWeight: 0,
        boostStrength: 0.1,
      });

      // Setup: note2 and note3 link to note1
      createMockFile("note1.md");
      createMockFile("note2.md");
      createMockFile("note3.md");

      mockBacklinks.set("note1.md", new Set(["note2.md", "note3.md"]));

      const results: NoteIdRank[] = [
        { id: "note1.md", score: 1.0, engine: "rrf" },
        { id: "note2.md", score: 0.9, engine: "rrf" },
        { id: "note3.md", score: 0.8, engine: "rrf" },
      ];

      const boosted = boost.applyBoost(results);

      // note1 should be boosted (2 backlinks from other results)
      expect(boosted[0].score).toBeGreaterThan(1.0);
      expect(boosted[0].score).toBeLessThan(1.2); // Max cap

      // note2 and note3 should not be boosted
      expect(boosted[1].score).toBe(0.9);
      expect(boosted[2].score).toBe(0.8);
    });

    it("should not count self-links", () => {
      const boost = new GraphBoostCalculator(mockApp);

      createMockFile("note1.md");

      // note1 links to itself (should be ignored)
      mockBacklinks.set("note1.md", new Set(["note1.md"]));

      const results: NoteIdRank[] = [{ id: "note1.md", score: 1.0, engine: "rrf" }];

      const boosted = boost.applyBoost(results);
      expect(boosted[0].score).toBe(1.0); // No boost
    });
  });

  describe("co-citation boost", () => {
    it("should boost notes that share citing sources", () => {
      const boost = new GraphBoostCalculator(mockApp, {
        backlinkWeight: 0,
        coCitationWeight: 0.5,
        sharedTagWeight: 0,
        boostStrength: 0.1,
      });

      createMockFile("note1.md");
      createMockFile("note2.md");
      createMockFile("source.md");

      // source.md links to both note1 and note2 (co-citation)
      mockBacklinks.set("note1.md", new Set(["source.md"]));
      mockBacklinks.set("note2.md", new Set(["source.md"]));

      const results: NoteIdRank[] = [
        { id: "note1.md", score: 1.0, engine: "rrf" },
        { id: "note2.md", score: 0.9, engine: "rrf" },
      ];

      const boosted = boost.applyBoost(results);

      // Both should be boosted due to co-citation
      expect(boosted[0].score).toBeGreaterThan(1.0);
      expect(boosted[1].score).toBeGreaterThan(0.9);
    });
  });

  describe("shared tags boost", () => {
    it("should boost notes with shared tags", () => {
      const boost = new GraphBoostCalculator(mockApp, {
        backlinkWeight: 0,
        coCitationWeight: 0,
        sharedTagWeight: 0.3,
        boostStrength: 0.1,
      });

      createMockFile("note1.md");
      createMockFile("note2.md");
      createMockFile("note3.md");

      // note1 and note2 share #tag1
      mockTags.set("note1.md", ["#tag1", "#tag2"]);
      mockTags.set("note2.md", ["#tag1", "#tag3"]);
      mockTags.set("note3.md", ["#tag4"]);

      const results: NoteIdRank[] = [
        { id: "note1.md", score: 1.0, engine: "rrf" },
        { id: "note2.md", score: 0.9, engine: "rrf" },
        { id: "note3.md", score: 0.8, engine: "rrf" },
      ];

      const boosted = boost.applyBoost(results);

      // note1 and note2 should be boosted (shared tag)
      expect(boosted[0].score).toBeGreaterThan(1.0);
      expect(boosted[1].score).toBeGreaterThan(0.9);

      // note3 should not be boosted (no shared tags)
      expect(boosted[2].score).toBe(0.8);
    });
  });

  describe("combined connections", () => {
    it("should combine all connection types with proper weights", () => {
      const boost = new GraphBoostCalculator(mockApp, {
        backlinkWeight: 1.0,
        coCitationWeight: 0.5,
        sharedTagWeight: 0.3,
        boostStrength: 0.1,
      });

      createMockFile("note1.md");
      createMockFile("note2.md");
      createMockFile("note3.md");
      createMockFile("source.md");

      // note1 has: 1 backlink from note2, co-citation with note3, shared tag with note2
      mockBacklinks.set("note1.md", new Set(["note2.md", "source.md"]));
      mockBacklinks.set("note3.md", new Set(["source.md"])); // co-citation
      mockTags.set("note1.md", ["#shared"]);
      mockTags.set("note2.md", ["#shared"]);

      const results: NoteIdRank[] = [
        {
          id: "note1.md",
          score: 1.0,
          engine: "rrf",
          explanation: { baseScore: 1.0, finalScore: 1.0 },
        },
        { id: "note2.md", score: 0.9, engine: "rrf" },
        { id: "note3.md", score: 0.8, engine: "rrf" },
      ];

      const boosted = boost.applyBoost(results);

      // note1 should have the highest boost (backlink + co-citation + shared tag)
      expect(boosted[0].score).toBeGreaterThan(1.0);

      // Check explanation
      const explanation = (boosted[0].explanation as any)?.graphConnections;
      expect(explanation).toBeDefined();
      expect(explanation?.backlinks).toBe(1);
      expect(explanation?.coCitations).toBe(1);
      expect(explanation?.sharedTags).toBe(1);
      expect(explanation?.score).toBeCloseTo(1.8); // 1.0 + 0.5 + 0.3
    });
  });

  describe("max candidates limit", () => {
    it("should only analyze top N candidates", () => {
      const boost = new GraphBoostCalculator(mockApp, {
        maxCandidates: 2,
        backlinkWeight: 1.0,
      });

      createMockFile("note1.md");
      createMockFile("note2.md");
      createMockFile("note3.md");

      // note3 links to note1 but is outside top 2
      mockBacklinks.set("note1.md", new Set(["note3.md"]));

      const results: NoteIdRank[] = [
        { id: "note1.md", score: 1.0, engine: "rrf" },
        { id: "note2.md", score: 0.9, engine: "rrf" },
        { id: "note3.md", score: 0.1, engine: "rrf" }, // Outside top 2
      ];

      const boosted = boost.applyBoost(results);

      // note1 should NOT be boosted (note3 is outside top 2 candidates)
      expect(boosted[0].score).toBe(1.0);
    });
  });

  describe("boost multiplier cap", () => {
    it("should respect max boost multiplier", () => {
      const boost = new GraphBoostCalculator(mockApp, {
        backlinkWeight: 10.0, // Very high weight
        boostStrength: 1.0, // Very high strength
        maxBoostMultiplier: 1.1, // But capped at 1.1x
      });

      createMockFile("note1.md");
      createMockFile("note2.md");

      // Many backlinks to trigger high boost
      mockBacklinks.set("note1.md", new Set(["note2.md", "note3.md", "note4.md"]));

      const results: NoteIdRank[] = [
        { id: "note1.md", score: 1.0, engine: "rrf" },
        { id: "note2.md", score: 0.9, engine: "rrf" },
      ];

      const boosted = boost.applyBoost(results);

      // Should be capped at 1.1x despite high connection score
      expect(boosted[0].score).toBe(1.1);
    });
  });
});
