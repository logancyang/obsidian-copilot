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
  getFirstLinkpathDest: (linkpath: string, sourcePath: string) => {
    // In our tests, the linkpath is the full path including .md
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
        boostStrength: 0.5, // Increased for testing
        maxBoostMultiplier: 1.5,
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
      expect(boosted[0].score).toBeLessThanOrEqual(1.5); // Max cap is 1.5

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
        boostStrength: 0.5,
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
        boostStrength: 0.5,
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
        boostStrength: 0.5,
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
      createMockFile("note3.md");
      createMockFile("note4.md");

      // Many backlinks to trigger high boost - all are in results
      mockBacklinks.set("note1.md", new Set(["note2.md", "note3.md", "note4.md"]));

      const results: NoteIdRank[] = [
        { id: "note1.md", score: 1.0, engine: "rrf" },
        { id: "note2.md", score: 0.9, engine: "rrf" },
        { id: "note3.md", score: 0.8, engine: "rrf" },
        { id: "note4.md", score: 0.7, engine: "rrf" },
      ];

      const boosted = boost.applyBoost(results);

      // Should be capped at 1.1x despite high connection score
      expect(boosted[0].score).toBe(1.1);
    });
  });

  describe("semantic similarity threshold", () => {
    it("should only boost candidates above semantic similarity threshold", () => {
      const boost = new GraphBoostCalculator(mockApp, {
        semanticSimilarityThreshold: 0.75,
        backlinkWeight: 1.0,
        boostStrength: 0.5,
      });

      createMockFile("note1.md");
      createMockFile("note2.md");
      createMockFile("note3.md");
      createMockFile("note4.md");

      // Setup backlinks: note2 and note3 link to note1
      mockBacklinks.set("note1.md", new Set(["note2.md", "note3.md"]));

      const results: NoteIdRank[] = [
        {
          id: "note1.md",
          score: 0.9,
          engine: "semantic",
          explanation: { semanticScore: 0.9, baseScore: 0.9, finalScore: 0.9 },
        },
        {
          id: "note2.md",
          score: 0.8,
          engine: "semantic",
          explanation: { semanticScore: 0.8, baseScore: 0.8, finalScore: 0.8 },
        },
        {
          id: "note3.md",
          score: 0.7,
          engine: "semantic",
          explanation: { semanticScore: 0.7, baseScore: 0.7, finalScore: 0.7 }, // Below threshold
        },
        {
          id: "note4.md",
          score: 0.6,
          engine: "semantic",
          explanation: { semanticScore: 0.6, baseScore: 0.6, finalScore: 0.6 }, // Below threshold
        },
      ];

      const boosted = boost.applyBoost(results);

      // Only note1 and note2 are above threshold (0.75)
      // note1 should be boosted (has backlink from note2 which is above threshold)
      expect(boosted[0].score).toBeGreaterThan(0.9);

      // note2 should not be boosted (no backlinks from other above-threshold results)
      expect(boosted[1].score).toBe(0.8);

      // note3 and note4 are below threshold, so they should not be boosted
      expect(boosted[2].score).toBe(0.7);
      expect(boosted[3].score).toBe(0.6);
    });

    it("should ignore results without semantic scores when threshold is set", () => {
      const boost = new GraphBoostCalculator(mockApp, {
        semanticSimilarityThreshold: 0.75,
        backlinkWeight: 1.0,
        boostStrength: 0.5,
      });

      createMockFile("note1.md");
      createMockFile("note2.md");
      createMockFile("note3.md");

      // Setup backlinks
      mockBacklinks.set("note1.md", new Set(["note2.md", "note3.md"]));

      const results: NoteIdRank[] = [
        {
          id: "note1.md",
          score: 0.9,
          engine: "semantic",
          explanation: { semanticScore: 0.9, baseScore: 0.9, finalScore: 0.9 },
        },
        {
          id: "note2.md",
          score: 0.8,
          engine: "lexical", // No semantic score
        },
        {
          id: "note3.md",
          score: 0.85,
          engine: "rrf", // Composite score, no semantic score
        },
      ];

      const boosted = boost.applyBoost(results);

      // Only note1 has semantic score above threshold
      // It should NOT be boosted because note2 and note3 don't have semantic scores
      expect(boosted[0].score).toBe(0.9);
      expect(boosted[1].score).toBe(0.8);
      expect(boosted[2].score).toBe(0.85);
    });

    it("should respect both semantic threshold and max candidates limit", () => {
      const boost = new GraphBoostCalculator(mockApp, {
        semanticSimilarityThreshold: 0.7,
        maxCandidates: 3,
        backlinkWeight: 1.0,
        boostStrength: 0.5,
      });

      createMockFile("note1.md");
      createMockFile("note2.md");
      createMockFile("note3.md");
      createMockFile("note4.md");
      createMockFile("note5.md");

      // Setup backlinks
      mockBacklinks.set("note1.md", new Set(["note2.md", "note4.md", "note5.md"]));

      const results: NoteIdRank[] = [
        {
          id: "note1.md",
          score: 0.95,
          engine: "semantic",
          explanation: { semanticScore: 0.95, baseScore: 0.95, finalScore: 0.95 },
        },
        {
          id: "note2.md",
          score: 0.85,
          engine: "semantic",
          explanation: { semanticScore: 0.85, baseScore: 0.85, finalScore: 0.85 },
        },
        {
          id: "note3.md",
          score: 0.75,
          engine: "semantic",
          explanation: { semanticScore: 0.75, baseScore: 0.75, finalScore: 0.75 },
        },
        {
          id: "note4.md",
          score: 0.72,
          engine: "semantic",
          explanation: { semanticScore: 0.72, baseScore: 0.72, finalScore: 0.72 },
        },
        {
          id: "note5.md",
          score: 0.71,
          engine: "semantic",
          explanation: { semanticScore: 0.71, baseScore: 0.71, finalScore: 0.71 },
        },
      ];

      const boosted = boost.applyBoost(results);

      // All 5 results are above threshold (0.7), but only top 3 should be analyzed
      // note1 should be boosted (has backlink from note2 which is in top 3)
      expect(boosted[0].score).toBeGreaterThan(0.95);

      // note4 and note5 are above threshold but outside top 3, so their backlinks don't count
      const explanation = (boosted[0].explanation as any)?.graphConnections;
      expect(explanation?.backlinks).toBe(1); // Only note2, not note4 or note5
    });

    it("should work without semantic threshold (backward compatibility)", () => {
      const boost = new GraphBoostCalculator(mockApp, {
        // No semanticSimilarityThreshold set
        maxCandidates: 2,
        backlinkWeight: 1.0,
        boostStrength: 0.5,
      });

      createMockFile("note1.md");
      createMockFile("note2.md");
      createMockFile("note3.md");

      mockBacklinks.set("note1.md", new Set(["note2.md"]));

      const results: NoteIdRank[] = [
        { id: "note1.md", score: 1.0, engine: "rrf" },
        { id: "note2.md", score: 0.9, engine: "rrf" },
        { id: "note3.md", score: 0.8, engine: "rrf" },
      ];

      const boosted = boost.applyBoost(results);

      // Should work as before, using only maxCandidates
      expect(boosted[0].score).toBeGreaterThan(1.0);
    });

    it("should return results unchanged when fewer than 2 candidates pass threshold", () => {
      const boost = new GraphBoostCalculator(mockApp, {
        semanticSimilarityThreshold: 0.9,
        backlinkWeight: 1.0,
        boostStrength: 0.5,
      });

      createMockFile("note1.md");
      createMockFile("note2.md");

      mockBacklinks.set("note1.md", new Set(["note2.md"]));

      const results: NoteIdRank[] = [
        {
          id: "note1.md",
          score: 0.95,
          engine: "semantic",
          explanation: { semanticScore: 0.95, baseScore: 0.95, finalScore: 0.95 },
        },
        {
          id: "note2.md",
          score: 0.85,
          engine: "semantic",
          explanation: { semanticScore: 0.85, baseScore: 0.85, finalScore: 0.85 }, // Below 0.9
        },
      ];

      const boosted = boost.applyBoost(results);

      // Only 1 candidate passes threshold, need at least 2 for connections
      // Results should be unchanged
      expect(boosted[0].score).toBe(0.95);
      expect(boosted[1].score).toBe(0.85);
    });
  });
});
