import { GraphExpander } from "./GraphExpander";
import { App, TFile } from "obsidian";

describe("GraphExpander", () => {
  let expander: GraphExpander;
  let mockApp: App;

  beforeEach(() => {
    // Create a mock graph structure for testing
    // Graph visualization:
    // A <-> B <-> C
    // |     |     |
    // v     v     v
    // D <-> E <-> F
    // |           |
    // v           v
    // G           H

    const mockResolvedLinks: Record<string, Record<string, number>> = {
      "A.md": { "B.md": 1, "D.md": 1 },
      "B.md": { "A.md": 1, "C.md": 1, "E.md": 1 },
      "C.md": { "B.md": 1, "F.md": 1 },
      "D.md": { "A.md": 1, "E.md": 1, "G.md": 1 },
      "E.md": { "B.md": 1, "D.md": 1, "F.md": 1 },
      "F.md": { "C.md": 1, "E.md": 1, "H.md": 1 },
      "G.md": { "D.md": 1 },
      "H.md": { "F.md": 1 },
      // Isolated node
      "I.md": {},
      // Self-referencing node
      "J.md": { "J.md": 1 },
    };

    // Create backlinks data structure (inverse of resolved links)
    const mockBacklinks: Record<string, Set<string>> = {};
    for (const [source, targets] of Object.entries(mockResolvedLinks)) {
      for (const target of Object.keys(targets)) {
        if (!mockBacklinks[target]) {
          mockBacklinks[target] = new Set();
        }
        mockBacklinks[target].add(source);
      }
    }

    mockApp = {
      metadataCache: {
        resolvedLinks: mockResolvedLinks,
        getBacklinksForFile: jest.fn((file: TFile) => {
          const backlinks = mockBacklinks[file.path];
          if (!backlinks) {
            return null;
          }
          const data: Record<string, any> = {};
          backlinks.forEach((link) => {
            data[link] = { link: 1 };
          });
          return { data };
        }),
      },
      vault: {
        getAbstractFileByPath: jest.fn((path: string) => {
          // Create a mock that passes instanceof TFile check
          const file = Object.create(TFile.prototype);
          file.path = path;
          file.basename = path.replace(".md", "");
          return file;
        }),
      },
      workspace: {
        getActiveFile: jest.fn(() => null),
      },
    } as any;

    expander = new GraphExpander(mockApp);
  });

  describe("expandFromNotes - BFS behavior", () => {
    it("should return starting notes with 0 hops", async () => {
      const result = await expander.expandFromNotes(["A.md"], 0);
      expect(result).toEqual(["A.md"]);
    });

    it("should expand 1 hop correctly (direct neighbors only)", async () => {
      const result = await expander.expandFromNotes(["A.md"], 1);
      const resultSet = new Set(result);

      // A.md links to B.md and D.md
      // B.md and D.md link back to A.md (already included)
      expect(resultSet.has("A.md")).toBe(true);
      expect(resultSet.has("B.md")).toBe(true);
      expect(resultSet.has("D.md")).toBe(true);
      expect(resultSet.size).toBe(3);
    });

    it("should expand 2 hops correctly (BFS level by level)", async () => {
      const result = await expander.expandFromNotes(["A.md"], 2);
      const resultSet = new Set(result);

      // Level 0: A
      // Level 1: B, D (from A)
      // Level 2: C, E, G (from B and D, excluding already visited A)
      expect(resultSet.has("A.md")).toBe(true);
      expect(resultSet.has("B.md")).toBe(true);
      expect(resultSet.has("D.md")).toBe(true);
      expect(resultSet.has("C.md")).toBe(true);
      expect(resultSet.has("E.md")).toBe(true);
      expect(resultSet.has("G.md")).toBe(true);
      expect(resultSet.size).toBe(6);

      // Should NOT include F or H (they're 3 hops away)
      expect(resultSet.has("F.md")).toBe(false);
      expect(resultSet.has("H.md")).toBe(false);
    });

    it("should expand 3 hops to reach entire connected component", async () => {
      const result = await expander.expandFromNotes(["A.md"], 3);
      const resultSet = new Set(result);

      // Debug: log what we found
      console.log("3-hop expansion from A found:", Array.from(resultSet).sort());

      // H is 4 hops from A: A -> B/D -> C/E -> F -> H
      // So with 3 hops we should get A,B,C,D,E,F,G (7 nodes)
      expect(resultSet.size).toBe(7); // A through G (H is 4 hops away)
      expect(resultSet.has("H.md")).toBe(false); // H is 4 hops from A
      expect(resultSet.has("I.md")).toBe(false); // Isolated
    });

    it("should handle multiple starting nodes", async () => {
      const result = await expander.expandFromNotes(["A.md", "F.md"], 1);
      const resultSet = new Set(result);

      // From A: B, D
      // From F: C, E, H
      // Total: A, F (starting) + B, D, C, E, H (neighbors)
      expect(resultSet.size).toBe(7);
    });

    it("should not revisit nodes (proper visited tracking)", async () => {
      // Track which paths are accessed for their links
      const accessedPaths: string[] = [];
      const originalResolvedLinks = mockApp.metadataCache.resolvedLinks;

      // Create a proxy to track accesses
      mockApp.metadataCache.resolvedLinks = new Proxy(originalResolvedLinks, {
        get(target, prop) {
          if (typeof prop === "string" && prop.endsWith(".md")) {
            accessedPaths.push(prop);
          }
          return target[prop as keyof typeof target];
        },
      });

      await expander.expandFromNotes(["A.md"], 2);

      // Count how many times each path was accessed
      const accessCounts = accessedPaths.reduce(
        (acc, path) => {
          acc[path] = (acc[path] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>
      );

      // Each node should be accessed at most once (BFS property)
      Object.values(accessCounts).forEach((count) => {
        expect(count).toBe(1);
      });

      // Specifically, A should only be accessed once (in level 0)
      expect(accessCounts["A.md"]).toBe(1);
    });

    it("should handle isolated nodes", async () => {
      const result = await expander.expandFromNotes(["I.md"], 5);
      expect(result).toEqual(["I.md"]); // No expansion possible
    });

    it("should handle self-referencing nodes", async () => {
      const result = await expander.expandFromNotes(["J.md"], 1);
      expect(result).toEqual(["J.md"]); // Self-links shouldn't cause issues
    });

    it("should terminate early when no new nodes found", async () => {
      const result = await expander.expandFromNotes(["G.md"], 10);
      const resultSet = new Set(result);

      // G -> D -> A,E -> B -> C -> F -> H (all reachable in 5 hops)
      // Should stop early even though we asked for 10 hops
      expect(resultSet.size).toBe(8); // All connected nodes
    });
  });

  describe("getCoCitations", () => {
    it("should find co-cited notes", async () => {
      // Debug: Let's trace exactly what getCoCitations does
      // It looks at B and D's outgoing links
      console.log("B links to:", Object.keys(mockApp.metadataCache.resolvedLinks["B.md"]));
      console.log("D links to:", Object.keys(mockApp.metadataCache.resolvedLinks["D.md"]));

      // For each target, it finds who else links there (via backlinks)
      const result = await expander.getCoCitations(["B.md", "D.md"]);
      console.log("Co-citations result:", result);

      // Based on our mock:
      // B links to: A, C, E
      // D links to: A, E, G
      // Common targets that both link to: A, E

      // For target E: who has backlinks from E?
      // E's backlinks should include B, D, and F
      // So F should be found as a co-citation

      // If result is empty, there might be an issue with how backlinks are set up
      if (result.length === 0) {
        // Let's check if the backlinks are working
        const eFile = mockApp.vault.getAbstractFileByPath("E.md");
        if (eFile) {
          const eBacklinks = mockApp.metadataCache.getBacklinksForFile(eFile as TFile);
          console.log("E's backlinks:", eBacklinks?.data ? Object.keys(eBacklinks.data) : "none");
        }
      }

      expect(result).toContain("F.md");
    });

    it("should exclude input notes from co-citations", async () => {
      const result = await expander.getCoCitations(["B.md"]);

      // Should not include B itself
      expect(result).not.toContain("B.md");
    });

    it("should return empty for notes without outgoing links", async () => {
      // G links to D, H links to F
      // So this test needs different inputs - use I (isolated) instead
      const result = await expander.getCoCitations(["I.md"]);
      expect(result).toEqual([]);
    });
  });

  describe("getActiveNoteNeighbors", () => {
    it("should return empty when no active file", async () => {
      const result = await expander.getActiveNoteNeighbors();
      expect(result).toEqual([]);
    });

    it("should expand from active file", async () => {
      mockApp.workspace.getActiveFile = jest.fn(
        () =>
          ({
            path: "C.md",
            basename: "C",
          }) as TFile
      );

      const result = await expander.getActiveNoteNeighbors(1);
      const resultSet = new Set(result);

      // C links to B and F
      expect(resultSet.has("C.md")).toBe(true);
      expect(resultSet.has("B.md")).toBe(true);
      expect(resultSet.has("F.md")).toBe(true);
      expect(resultSet.size).toBe(3);
    });
  });

  describe("expandCandidates - integration", () => {
    it("should combine all three strategies", async () => {
      mockApp.workspace.getActiveFile = jest.fn(
        () =>
          ({
            path: "H.md",
            basename: "H",
          }) as TFile
      );

      const grepHits = ["A.md", "B.md"];
      const result = await expander.expandCandidates(
        grepHits,
        mockApp.workspace.getActiveFile(),
        1
      );
      const resultSet = new Set(result);

      // From grep expansion: A, B, C, D, E
      // From active (H): F, H
      // From co-citations: F (A and B both connect to nodes that F connects to)

      expect(resultSet.has("A.md")).toBe(true);
      expect(resultSet.has("B.md")).toBe(true);
      expect(resultSet.has("C.md")).toBe(true);
      expect(resultSet.has("D.md")).toBe(true);
      expect(resultSet.has("E.md")).toBe(true);
      expect(resultSet.has("F.md")).toBe(true);
      expect(resultSet.has("H.md")).toBe(true);
    });

    it("should skip co-citations for large result sets", async () => {
      // Create 25 grep hits to exceed the co-citation threshold
      const grepHits = Array.from({ length: 25 }, (_, i) => `note${i}.md`);

      const getCoCitationsSpy = jest.spyOn(expander, "getCoCitations");

      await expander.expandCandidates(grepHits, null, 1);

      // Should not call getCoCitations when grepHits.length >= 20
      expect(getCoCitationsSpy).not.toHaveBeenCalled();
    });
  });

  describe("Performance characteristics", () => {
    it("should handle large graphs efficiently", async () => {
      // Create a larger graph for performance testing
      const largeGraph: Record<string, Record<string, number>> = {};
      const nodeCount = 100;

      // Create a chain of 100 nodes
      for (let i = 0; i < nodeCount; i++) {
        const current = `node${i}.md`;
        largeGraph[current] = {};

        // Link to previous and next
        if (i > 0) largeGraph[current][`node${i - 1}.md`] = 1;
        if (i < nodeCount - 1) largeGraph[current][`node${i + 1}.md`] = 1;
      }

      mockApp.metadataCache.resolvedLinks = largeGraph;

      const startTime = Date.now();
      const result = await expander.expandFromNotes(["node50.md"], 10);
      const duration = Date.now() - startTime;

      // Should complete quickly even with many nodes
      expect(duration).toBeLessThan(100); // 100ms max

      // Should find 21 nodes (10 in each direction + starting node)
      expect(result.length).toBe(21);
    });
  });
});
