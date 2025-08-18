import { App } from "obsidian";
import { NoteIdRank } from "../interfaces";
import { FolderBoostCalculator } from "./FolderBoostCalculator";
import { GraphBoostCalculator } from "./GraphBoostCalculator";

// Mock logger
jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

// Mock Obsidian app
function createMockApp(files: string[], links: Record<string, Record<string, number>> = {}): App {
  return {
    vault: {
      getMarkdownFiles: () =>
        files.map((path) => ({
          path,
          basename: path.split("/").pop()?.replace(".md", "") || "",
          extension: "md",
        })),
    },
    metadataCache: {
      resolvedLinks: links,
      getBacklinksForFile: jest.fn((file) => ({
        data: new Map(
          Object.keys(links).reduce(
            (acc, source) => {
              if (links[source][file.path]) {
                acc.push([source, links[source][file.path]]);
              }
              return acc;
            },
            [] as Array<[string, number]>
          )
        ),
      })),
      getFirstLinkpathDest: jest.fn((noteId: string) => {
        // Return a mock file object for any noteId
        if (files.some((f) => f.includes(noteId) || noteId.includes(f.replace(".md", "")))) {
          return {
            path:
              files.find((f) => f.includes(noteId) || noteId.includes(f.replace(".md", ""))) ||
              `${noteId}.md`,
            basename: noteId.replace(".md", ""),
          };
        }
        return null;
      }),
      getFileCache: jest.fn((file) => ({
        tags: [
          {
            tag: "auth",
            position: {
              start: { line: 0, col: 0, offset: 0 },
              end: { line: 0, col: 5, offset: 5 },
            },
          },
          {
            tag: "security",
            position: {
              start: { line: 1, col: 0, offset: 10 },
              end: { line: 1, col: 9, offset: 19 },
            },
          },
        ],
        frontmatter: { tags: ["auth", "security"] },
      })),
    },
  } as any;
}

describe("Chunk Boost Aggregation", () => {
  let folderCalculator: FolderBoostCalculator;
  let graphCalculator: GraphBoostCalculator;
  let mockApp: App;

  beforeEach(() => {
    // Mock app with test files
    mockApp = createMockApp(
      [
        "auth/setup.md",
        "auth/config.md",
        "auth/jwt.md",
        "nextjs/guide.md",
        "nextjs/auth.md",
        "utils/helpers.md",
      ],
      {
        "auth/setup.md": { "auth/config.md": 1, "auth/jwt.md": 2 },
        "auth/config.md": { "auth/jwt.md": 1 },
        "nextjs/auth.md": { "auth/setup.md": 1 },
      }
    );

    folderCalculator = new FolderBoostCalculator(mockApp);
    graphCalculator = new GraphBoostCalculator(mockApp, {
      enabled: true,
      maxCandidates: 10,
      semanticSimilarityThreshold: 0.75,
      boostStrength: 0.1,
      maxBoostMultiplier: 1.15,
    });
  });

  describe("folder boost with chunks", () => {
    it("should aggregate folder boost across chunks from same note", () => {
      const chunkResults: NoteIdRank[] = [
        { id: "auth/setup.md#0", score: 0.9, engine: "fulltext" },
        { id: "auth/setup.md#1", score: 0.8, engine: "fulltext" },
        { id: "auth/config.md#0", score: 0.7, engine: "fulltext" },
        { id: "nextjs/guide.md#0", score: 0.6, engine: "fulltext" },
        { id: "utils/helpers.md#0", score: 0.5, engine: "fulltext" },
      ];

      const boosted = folderCalculator.applyBoosts(chunkResults);

      // auth/ folder has 3 unique notes (setup.md, config.md, jwt.md) out of 6 total
      // But only 2 are in results, so relevance ratio = 2/3 = 66.7% > 40% threshold
      // Should get folder boost
      const authChunks = boosted.filter((r) => r.id.startsWith("auth/"));
      const nonAuthChunks = boosted.filter((r) => !r.id.startsWith("auth/"));

      expect(authChunks.length).toBe(3);
      expect(nonAuthChunks.length).toBe(2);

      // Auth chunks should have higher scores due to folder boost
      authChunks.forEach((chunk) => {
        const originalChunk = chunkResults.find((c) => c.id === chunk.id);
        expect(chunk.score).toBeGreaterThan(originalChunk!.score);
      });

      // Non-auth chunks should have unchanged scores
      nonAuthChunks.forEach((chunk) => {
        const originalChunk = chunkResults.find((c) => c.id === chunk.id);
        expect(chunk.score).toBe(originalChunk!.score);
      });
    });

    it("should not apply folder boost when relevance ratio is too low", () => {
      const chunkResults: NoteIdRank[] = [
        { id: "auth/setup.md#0", score: 0.9, engine: "fulltext" },
        { id: "nextjs/guide.md#0", score: 0.8, engine: "fulltext" },
        { id: "utils/helpers.md#0", score: 0.7, engine: "fulltext" },
      ];

      const boosted = folderCalculator.applyBoosts(chunkResults);

      // auth/ has only 1 relevant note out of 3 total = 33% < 40% threshold
      // Should NOT get folder boost
      boosted.forEach((chunk) => {
        const originalChunk = chunkResults.find((c) => c.id === chunk.id);
        expect(chunk.score).toBe(originalChunk!.score);
      });
    });

    it("should apply same boost to all chunks from same note", () => {
      const chunkResults: NoteIdRank[] = [
        { id: "auth/setup.md#0", score: 0.9, engine: "fulltext" },
        { id: "auth/setup.md#1", score: 0.8, engine: "fulltext" },
        { id: "auth/setup.md#2", score: 0.7, engine: "fulltext" },
        { id: "auth/config.md#0", score: 0.6, engine: "fulltext" },
      ];

      const boosted = folderCalculator.applyBoosts(chunkResults);

      // All chunks from auth/setup.md should get the same boost multiplier
      const setupChunks = boosted.filter((r) => r.id.startsWith("auth/setup.md"));
      expect(setupChunks.length).toBe(3);

      const originalSetupChunks = chunkResults.filter((r) => r.id.startsWith("auth/setup.md"));
      const boostMultipliers = setupChunks.map(
        (chunk, i) => chunk.score / originalSetupChunks[i].score
      );

      // All boost multipliers should be the same (within floating point precision)
      expect(boostMultipliers[1]).toBeCloseTo(boostMultipliers[0], 5);
      expect(boostMultipliers[2]).toBeCloseTo(boostMultipliers[0], 5);
    });
  });

  describe("graph boost with chunks", () => {
    it("should aggregate graph connections at note level", () => {
      const chunkResults: NoteIdRank[] = [
        { id: "auth/setup.md#0", score: 0.9, engine: "fulltext" },
        { id: "auth/setup.md#1", score: 0.8, engine: "fulltext" },
        { id: "auth/config.md#0", score: 0.85, engine: "fulltext" }, // High semantic similarity
        { id: "auth/jwt.md#0", score: 0.82, engine: "fulltext" }, // High semantic similarity
        { id: "nextjs/guide.md#0", score: 0.6, engine: "fulltext" }, // Lower similarity
      ];

      // Add semantic similarity metadata to trigger graph boost
      chunkResults.forEach((result) => {
        if (result.score >= 0.8) {
          // Above 75% threshold
          result.explanation = {
            semanticScore: result.score,
            baseScore: result.score,
            finalScore: result.score,
          };
        }
      });

      const boosted = graphCalculator.applyBoost(chunkResults);

      // auth/setup.md has connections to auth/config.md and auth/jwt.md
      // auth/config.md has connection to auth/jwt.md
      // Should get graph boosts for highly similar results
      const setupChunks = boosted.filter((r) => r.id.startsWith("auth/setup.md"));
      const configChunk = boosted.find((r) => r.id === "auth/config.md#0");
      const jwtChunk = boosted.find((r) => r.id === "auth/jwt.md#0");

      expect(setupChunks.length).toBe(2);

      // All chunks from connected notes should get graph boost
      setupChunks.forEach((chunk) => {
        const originalChunk = chunkResults.find((c) => c.id === chunk.id);
        if (originalChunk!.score >= 0.8) {
          // Above similarity threshold
          expect(chunk.score).toBeGreaterThan(originalChunk!.score);
        }
      });

      // Connected notes should also get boosts
      const originalConfig = chunkResults.find((c) => c.id === "auth/config.md#0");
      const originalJwt = chunkResults.find((c) => c.id === "auth/jwt.md#0");

      expect(configChunk!.score).toBeGreaterThan(originalConfig!.score);
      expect(jwtChunk!.score).toBeGreaterThan(originalJwt!.score);
    });

    it("should only boost chunks above semantic similarity threshold", () => {
      const chunkResults: NoteIdRank[] = [
        { id: "auth/setup.md#0", score: 0.9, engine: "fulltext" }, // Above threshold
        { id: "auth/setup.md#1", score: 0.7, engine: "fulltext" }, // Below threshold
        { id: "auth/config.md#0", score: 0.6, engine: "fulltext" }, // Below threshold
      ];

      // Only add semantic similarity for high-scoring chunk
      chunkResults[0].explanation = {
        semanticScore: 0.9,
        baseScore: 0.9,
        finalScore: 0.9,
      };

      const boosted = graphCalculator.applyBoost(chunkResults);

      // Only the high-similarity chunk should get graph boost
      const highSimilarityChunk = boosted.find((r) => r.id === "auth/setup.md#0");
      const lowSimilarityChunks = boosted.filter((r) => r.id !== "auth/setup.md#0");

      const originalHigh = chunkResults.find((c) => c.id === "auth/setup.md#0");
      expect(highSimilarityChunk!.score).toBeGreaterThanOrEqual(originalHigh!.score);

      // Low similarity chunks should be unchanged
      lowSimilarityChunks.forEach((chunk) => {
        const originalChunk = chunkResults.find((c) => c.id === chunk.id);
        expect(chunk.score).toBe(originalChunk!.score);
      });
    });

    it("should apply same graph boost to all chunks from same connected note", () => {
      const chunkResults: NoteIdRank[] = [
        { id: "auth/setup.md#0", score: 0.9, engine: "fulltext" },
        { id: "auth/setup.md#1", score: 0.85, engine: "fulltext" },
        { id: "auth/setup.md#2", score: 0.8, engine: "fulltext" },
        { id: "auth/config.md#0", score: 0.82, engine: "fulltext" },
      ];

      // Add semantic similarity metadata for all chunks
      chunkResults.forEach((result) => {
        result.explanation = {
          semanticScore: result.score,
          baseScore: result.score,
          finalScore: result.score,
        };
      });

      const boosted = graphCalculator.applyBoost(chunkResults);

      // All chunks from auth/setup.md should get the same graph boost multiplier
      const setupChunks = boosted.filter((r) => r.id.startsWith("auth/setup.md"));
      const originalSetupChunks = chunkResults.filter((r) => r.id.startsWith("auth/setup.md"));

      const boostMultipliers = setupChunks.map(
        (chunk, i) => chunk.score / originalSetupChunks[i].score
      );

      // All boost multipliers should be the same
      expect(boostMultipliers[1]).toBeCloseTo(boostMultipliers[0], 5);
      expect(boostMultipliers[2]).toBeCloseTo(boostMultipliers[0], 5);
    });
  });

  describe("combined boost effects on chunks", () => {
    it("should apply both folder and graph boosts to qualifying chunks", () => {
      const chunkResults: NoteIdRank[] = [
        { id: "auth/setup.md#0", score: 0.9, engine: "fulltext" },
        { id: "auth/setup.md#1", score: 0.85, engine: "fulltext" },
        { id: "auth/config.md#0", score: 0.8, engine: "fulltext" },
        { id: "nextjs/guide.md#0", score: 0.7, engine: "fulltext" },
      ];

      // Add semantic similarity metadata for auth chunks
      chunkResults.slice(0, 3).forEach((result) => {
        result.explanation = {
          semanticScore: result.score,
          baseScore: result.score,
          finalScore: result.score,
        };
      });

      // Apply folder boost first
      const folderBoosted = folderCalculator.applyBoosts(chunkResults);

      // Then apply graph boost
      const fullyBoosted = graphCalculator.applyBoost(folderBoosted);

      // Auth chunks should get both boosts (multiplicative)
      const authChunks = fullyBoosted.filter((r) => r.id.startsWith("auth/"));
      const originalAuthChunks = chunkResults.filter((r) => r.id.startsWith("auth/"));

      authChunks.forEach((chunk, i) => {
        const originalScore = originalAuthChunks[i].score;
        const totalBoost = chunk.score / originalScore;

        // Should have significant boost from both folder and graph effects
        expect(totalBoost).toBeGreaterThan(1.1); // At least 10% boost
        expect(totalBoost).toBeLessThanOrEqual(1.32); // Max ~1.15 * 1.15
      });

      // Non-auth chunks should have minimal or no boost
      const nextjsChunk = fullyBoosted.find((r) => r.id === "nextjs/guide.md#0");
      const originalNextjs = chunkResults.find((r) => r.id === "nextjs/guide.md#0");

      // Should have no boosts (no folder boost, no graph connections)
      expect(nextjsChunk!.score).toBe(originalNextjs!.score);
    });

    it("should maintain chunk order by boosted scores", () => {
      const chunkResults: NoteIdRank[] = [
        { id: "isolated.md#0", score: 0.95, engine: "fulltext" }, // High score, no boosts
        { id: "auth/setup.md#0", score: 0.85, engine: "fulltext" }, // Lower score, but gets boosts
        { id: "auth/config.md#0", score: 0.8, engine: "fulltext" }, // Gets boosts
        { id: "other.md#0", score: 0.75, engine: "fulltext" }, // No boosts
      ];

      // Add semantic similarity for auth chunks
      chunkResults.slice(1, 3).forEach((result) => {
        result.explanation = {
          semanticScore: result.score,
          baseScore: result.score,
          finalScore: result.score,
        };
      });

      // Apply both boosts
      const folderBoosted = folderCalculator.applyBoosts(chunkResults);
      const fullyBoosted = graphCalculator.applyBoost(folderBoosted);

      // Sort by final scores
      const sorted = fullyBoosted.sort((a, b) => b.score - a.score);

      // After boosts, auth chunks might outrank the originally higher isolated chunk
      // Verify that boosts can change ranking
      const authPositions = sorted
        .map((chunk, index) => (chunk.id.startsWith("auth/") ? index : -1))
        .filter((pos) => pos >= 0);

      expect(authPositions.length).toBe(2);

      // At least one auth chunk should be highly ranked
      expect(Math.min(...authPositions)).toBeLessThan(3);
    });
  });

  describe("chunk boost consistency", () => {
    it("should produce consistent boost multipliers for chunks from same note", () => {
      const chunkResults: NoteIdRank[] = [
        { id: "auth/large.md#0", score: 0.9, engine: "fulltext" },
        { id: "auth/large.md#1", score: 0.7, engine: "fulltext" },
        { id: "auth/large.md#2", score: 0.5, engine: "fulltext" },
        { id: "auth/other.md#0", score: 0.8, engine: "fulltext" },
      ];

      // Add semantic similarity for testing graph boost
      chunkResults.forEach((result) => {
        if (result.score >= 0.8) {
          result.explanation = {
            semanticScore: result.score,
            baseScore: result.score,
            finalScore: result.score,
          };
        }
      });

      const folderBoosted = folderCalculator.applyBoosts(chunkResults);
      const fullyBoosted = graphCalculator.applyBoost(folderBoosted);

      // Get chunks from the same note
      const largeNoteChunks = fullyBoosted.filter((r) => r.id.startsWith("auth/large.md"));
      const originalLargeChunks = chunkResults.filter((r) => r.id.startsWith("auth/large.md"));

      expect(largeNoteChunks.length).toBe(3);

      // Calculate boost multipliers for each chunk
      const folderMultipliers = largeNoteChunks.map((chunk, i) => {
        const originalScore = originalLargeChunks[i].score;
        return chunk.score / originalScore;
      });

      // All chunks from same note should have identical boost multipliers
      expect(folderMultipliers[1]).toBeCloseTo(folderMultipliers[0], 5);
      expect(folderMultipliers[2]).toBeCloseTo(folderMultipliers[0], 5);

      // Verify the boost is actually applied
      expect(folderMultipliers[0]).toBeGreaterThan(1.0);
    });
  });
});
