import { App, MetadataCache, CachedMetadata } from "obsidian";
import { GraphBoostCalculator, DEFAULT_GRAPH_BOOST_CONFIG } from "./GraphBoostCalculator";

describe("GraphBoostCalculator", () => {
  let mockApp: App;
  let mockMetadataCache: MetadataCache;
  let calculator: GraphBoostCalculator;

  beforeEach(() => {
    // Create mock metadata cache
    mockMetadataCache = {
      getCache: jest.fn(),
      getFirstLinkpathDest: jest.fn(),
    } as any;

    // Create mock app
    mockApp = {
      metadataCache: mockMetadataCache,
    } as any;

    calculator = new GraphBoostCalculator(mockApp);
  });

  describe("calculateBoosts", () => {
    it("should return neutral boosts when disabled", () => {
      calculator.setConfig({ enabled: false });

      const candidates = ["note1.md", "note2.md", "note3.md"];
      const results = calculator.calculateBoosts(candidates);

      expect(results.size).toBe(3);
      for (const candidateId of candidates) {
        const result = results.get(candidateId);
        expect(result).toBeDefined();
        expect(result?.boostMultiplier).toBe(1.0);
        expect(result?.candidateConnections).toBe(0);
      }
    });

    it("should return neutral boosts for empty candidate list", () => {
      const results = calculator.calculateBoosts([]);
      expect(results.size).toBe(0);
    });

    it("should calculate boosts for notes with connections to other candidates", () => {
      const candidates = ["note1.md", "note2.md", "note3.md", "note4.md"];

      // Mock metadata for each note
      const mockCaches: Record<string, CachedMetadata> = {
        "note1.md": {
          links: [
            { link: "note2", original: "[[note2]]", position: null as any },
            { link: "note3", original: "[[note3]]", position: null as any },
            { link: "external", original: "[[external]]", position: null as any },
          ],
        } as CachedMetadata,
        "note2.md": {
          links: [{ link: "note1", original: "[[note1]]", position: null as any }],
        } as CachedMetadata,
        "note3.md": {
          links: [], // No links
        } as CachedMetadata,
        "note4.md": {
          links: null, // No cache
        } as any,
      };

      // Mock the cache retrieval
      (mockMetadataCache.getCache as jest.Mock).mockImplementation((path: string) => {
        return mockCaches[path] || null;
      });

      // Mock link resolution
      (mockMetadataCache.getFirstLinkpathDest as jest.Mock).mockImplementation((link: string) => {
        // Simple mock: just append .md to the link
        if (link === "external") return null; // External link not in vault
        return { path: `${link}.md` };
      });

      const results = calculator.calculateBoosts(candidates);

      // note1 has 2 connections to candidates (note2, note3)
      const note1Result = results.get("note1.md");
      expect(note1Result?.candidateConnections).toBe(2);
      expect(note1Result?.totalOutgoingLinks).toBe(2); // external link couldn't be resolved
      expect(note1Result?.boostMultiplier).toBeGreaterThan(1.0);

      // note2 has 1 connection to candidates (note1)
      const note2Result = results.get("note2.md");
      expect(note2Result?.candidateConnections).toBe(1);
      expect(note2Result?.boostMultiplier).toBeGreaterThan(1.0);
      expect(note2Result?.boostMultiplier).toBeLessThan(note1Result!.boostMultiplier);

      // note3 has no connections
      const note3Result = results.get("note3.md");
      expect(note3Result?.candidateConnections).toBe(0);
      expect(note3Result?.boostMultiplier).toBe(1.0);

      // note4 has no cache
      const note4Result = results.get("note4.md");
      expect(note4Result?.candidateConnections).toBe(0);
      expect(note4Result?.boostMultiplier).toBe(1.0);
    });

    it("should use logarithmic scaling when enabled", () => {
      calculator.setConfig({
        useLogScale: true,
        candidateConnectionWeight: 0.2,
      });

      // Create a note with many connections
      const candidates = Array.from({ length: 11 }, (_, i) => `note${i}.md`);

      (mockMetadataCache.getCache as jest.Mock).mockImplementation((path: string) => {
        if (path === "note0.md") {
          // note0 connects to all other candidates (10 connections)
          return {
            links: candidates.slice(1).map((c) => ({
              link: c.replace(".md", ""),
              original: `[[${c.replace(".md", "")}]]`,
              position: null as any,
            })),
          } as CachedMetadata;
        }
        return { links: [] } as CachedMetadata;
      });

      (mockMetadataCache.getFirstLinkpathDest as jest.Mock).mockImplementation((link: string) => {
        return { path: `${link}.md` };
      });

      const results = calculator.calculateBoosts(candidates);
      const note0Result = results.get("note0.md");

      // With log scaling: log(10 + 1) ≈ 2.4
      // Boost = 1 + (0.2 * 2.4) = 1.48
      expect(note0Result?.candidateConnections).toBe(10);
      expect(note0Result?.boostMultiplier).toBeCloseTo(1 + 0.2 * Math.log(11), 2);
    });

    it("should use linear scaling when log scale is disabled", () => {
      calculator.setConfig({
        useLogScale: false,
        candidateConnectionWeight: 0.1, // Lower weight for linear
      });

      const candidates = ["note1.md", "note2.md", "note3.md"];

      (mockMetadataCache.getCache as jest.Mock).mockImplementation((path: string) => {
        if (path === "note1.md") {
          return {
            links: [
              { link: "note2", original: "[[note2]]", position: null as any },
              { link: "note3", original: "[[note3]]", position: null as any },
            ],
          } as CachedMetadata;
        }
        return { links: [] } as CachedMetadata;
      });

      (mockMetadataCache.getFirstLinkpathDest as jest.Mock).mockImplementation((link: string) => {
        return { path: `${link}.md` };
      });

      const results = calculator.calculateBoosts(candidates);
      const note1Result = results.get("note1.md");

      // With linear scaling: 2 connections
      // Boost = 1 + (0.1 * 2) = 1.2
      expect(note1Result?.boostMultiplier).toBeCloseTo(1.2, 2);
    });

    it("should cap maximum boost at 2.0", () => {
      calculator.setConfig({
        useLogScale: false,
        candidateConnectionWeight: 1.0, // Very high weight
      });

      const candidates = ["note1.md", "note2.md", "note3.md"];

      (mockMetadataCache.getCache as jest.Mock).mockImplementation((path: string) => {
        if (path === "note1.md") {
          // Many connections that would result in boost > 2.0
          return {
            links: [
              { link: "note2", original: "[[note2]]", position: null as any },
              { link: "note3", original: "[[note3]]", position: null as any },
            ],
          } as CachedMetadata;
        }
        return { links: [] } as CachedMetadata;
      });

      (mockMetadataCache.getFirstLinkpathDest as jest.Mock).mockImplementation((link: string) => {
        return { path: `${link}.md` };
      });

      const results = calculator.calculateBoosts(candidates);
      const note1Result = results.get("note1.md");

      // Should be capped at 2.0
      expect(note1Result?.boostMultiplier).toBe(2.0);
    });
  });

  describe("applyBoosts", () => {
    it("should modify scores of items based on graph boost", () => {
      const items = [
        { id: "note1.md", score: 10 },
        { id: "note2.md", score: 8 },
        { id: "note3.md", score: 6 },
      ];

      // Mock connections
      (mockMetadataCache.getCache as jest.Mock).mockImplementation((path: string) => {
        if (path === "note1.md") {
          return {
            links: [{ link: "note2", original: "[[note2]]", position: null as any }],
          } as CachedMetadata;
        }
        return { links: [] } as CachedMetadata;
      });

      (mockMetadataCache.getFirstLinkpathDest as jest.Mock).mockImplementation((link: string) => {
        return { path: `${link}.md` };
      });

      const boostedItems = calculator.applyBoosts([...items]);

      // note1 should have boosted score
      expect(boostedItems[0].score).toBeGreaterThan(10);
      // note2 and note3 should have unchanged scores
      expect(boostedItems[1].score).toBe(8);
      expect(boostedItems[2].score).toBe(6);
    });

    it("should not modify scores when disabled", () => {
      calculator.setConfig({ enabled: false });

      const items = [
        { id: "note1.md", score: 10 },
        { id: "note2.md", score: 8 },
      ];

      const boostedItems = calculator.applyBoosts([...items]);

      expect(boostedItems[0].score).toBe(10);
      expect(boostedItems[1].score).toBe(8);
    });

    it("should handle empty item list", () => {
      const items: Array<{ id: string; score: number }> = [];
      const boostedItems = calculator.applyBoosts(items);
      expect(boostedItems).toEqual([]);
    });
  });

  describe("configuration", () => {
    it("should use default configuration", () => {
      const config = calculator.getConfig();
      expect(config).toEqual(DEFAULT_GRAPH_BOOST_CONFIG);
    });

    it("should allow partial config updates", () => {
      calculator.setConfig({ weight: 0.5 });
      const config = calculator.getConfig();

      expect(config.weight).toBe(0.5);
      expect(config.enabled).toBe(DEFAULT_GRAPH_BOOST_CONFIG.enabled);
      expect(config.candidateConnectionWeight).toBe(
        DEFAULT_GRAPH_BOOST_CONFIG.candidateConnectionWeight
      );
    });

    it("should accept config in constructor", () => {
      const customCalculator = new GraphBoostCalculator(mockApp, {
        enabled: false,
        weight: 0.7,
      });

      const config = customCalculator.getConfig();
      expect(config.enabled).toBe(false);
      expect(config.weight).toBe(0.7);
      expect(config.candidateConnectionWeight).toBe(
        DEFAULT_GRAPH_BOOST_CONFIG.candidateConnectionWeight
      );
    });
  });
});
