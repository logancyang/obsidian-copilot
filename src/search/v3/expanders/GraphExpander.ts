import { App, TFile } from "obsidian";
import { logInfo } from "@/logger";

/**
 * GraphExpander increases search recall by finding related notes through link analysis.
 *
 * It uses three strategies to expand the initial search results:
 * 1. **Link Traversal**: Follows outgoing links and backlinks from found notes
 * 2. **Active Context**: Includes neighbors of the currently open note
 * 3. **Co-citation**: Finds notes that link to the same targets (similar topics)
 *
 * This helps discover relevant notes that don't contain the search terms directly
 * but are conceptually related through the knowledge graph structure.
 */
export class GraphExpander {
  constructor(private app: App) {}

  /**
   * Performs breadth-first search (BFS) traversal of the link graph.
   *
   * Algorithm:
   * - Level 0: Starting notes
   * - Level 1: Direct links from level 0 (not yet visited)
   * - Level 2: Direct links from level 1 (not yet visited)
   * - Etc...
   *
   * Each note is visited exactly once. Early termination if no new notes found.
   *
   * @param notePaths - Starting note paths to expand from
   * @param hops - Maximum BFS depth (1 = direct links only, 2 = links of links, etc.)
   * @returns All discovered note paths including the starting notes
   *
   * @example
   * // Starting from ["A.md"] with 2 hops:
   * // Level 0: ["A.md"]
   * // Level 1: ["B.md", "C.md"] (A's neighbors)
   * // Level 2: ["D.md", "E.md"] (B and C's neighbors, excluding already visited)
   * // Returns: ["A.md", "B.md", "C.md", "D.md", "E.md"]
   */
  async expandFromNotes(notePaths: string[], hops: number = 1): Promise<string[]> {
    const visited = new Set<string>(notePaths);
    let currentLevel = new Set<string>(notePaths);

    for (let hop = 0; hop < hops; hop++) {
      const nextLevel = new Set<string>();
      const startSize = visited.size;

      // Only expand nodes from the current level (true BFS)
      for (const path of currentLevel) {
        // Get outgoing links
        const outgoing = this.app.metadataCache.resolvedLinks[path] || {};
        for (const link of Object.keys(outgoing)) {
          if (!visited.has(link)) {
            visited.add(link);
            nextLevel.add(link);
          }
        }

        // Get backlinks
        const file = this.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) {
          const backlinks = this.app.metadataCache.getBacklinksForFile(file);
          if (backlinks?.data) {
            for (const link of Object.keys(backlinks.data)) {
              if (!visited.has(link)) {
                visited.add(link);
                nextLevel.add(link);
              }
            }
          }
        }
      }

      if (visited.size > startSize) {
        logInfo(
          `  Graph hop ${hop + 1}: ${startSize} → ${visited.size} notes (+${visited.size - startSize})`
        );
      }

      // Move to next level for next iteration
      currentLevel = nextLevel;

      // Stop early if no new nodes were discovered
      if (nextLevel.size === 0) {
        break;
      }
    }

    return Array.from(visited);
  }

  /**
   * Gets all notes connected to the currently active/open note.
   * Useful for adding context about what the user is currently working on.
   *
   * @param hops - Link distance from active note (default: 1)
   * @returns Connected note paths, or empty if no note is active
   */
  async getActiveNoteNeighbors(hops: number = 1): Promise<string[]> {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      return [];
    }

    return this.expandFromNotes([activeFile.path], hops);
  }

  /**
   * Finds co-cited notes - notes that share common outgoing links.
   *
   * If Note A links to X,Y,Z and Note B also links to X,Y,Z,
   * they're likely about similar topics even if they don't link to each other.
   *
   * @param notePaths - Notes to find co-citations for
   * @returns Notes that link to the same targets (excluding input notes)
   */
  async getCoCitations(notePaths: string[]): Promise<string[]> {
    const coCited = new Set<string>();

    for (const path of notePaths) {
      const outgoing = this.app.metadataCache.resolvedLinks[path] || {};

      // For each outgoing link, find other notes that also link to it
      for (const target of Object.keys(outgoing)) {
        const targetFile = this.app.vault.getAbstractFileByPath(target);
        if (targetFile instanceof TFile) {
          const backlinks = this.app.metadataCache.getBacklinksForFile(targetFile);
          if (backlinks?.data) {
            Object.keys(backlinks.data).forEach((link) => {
              if (!notePaths.includes(link)) {
                coCited.add(link);
              }
            });
          }
        }
      }
    }

    return Array.from(coCited);
  }

  /**
   * Main expansion method combining all three strategies.
   *
   * 1. Expands from grep hits via links (primary expansion)
   * 2. Adds active note context (user's current focus)
   * 3. Adds co-citations for small result sets (topic similarity)
   *
   * @param grepHits - Initial notes found by text search
   * @param activeFile - Currently open note (for context)
   * @param hops - Link traversal depth (default: 1)
   * @returns Union of all discovered notes
   */
  async expandCandidates(
    grepHits: string[],
    activeFile: TFile | null,
    hops: number = 1
  ): Promise<string[]> {
    const allCandidates = new Set<string>(grepHits);
    let expandedFromGrep: string[] = [];
    let activeNeighbors: string[] = [];
    let coCitations: string[] = [];

    // Expand from grep hits
    if (grepHits.length > 0) {
      expandedFromGrep = await this.expandFromNotes(grepHits, hops);
      expandedFromGrep.forEach((path) => allCandidates.add(path));
    }

    // Add active note neighbors
    if (activeFile) {
      activeNeighbors = await this.expandFromNotes([activeFile.path], hops);
      activeNeighbors.forEach((path) => allCandidates.add(path));
    }

    // Add co-citations for better recall (only for small result sets to avoid explosion)
    // Co-citation finds notes about similar topics based on shared outgoing links
    if (grepHits.length > 0 && grepHits.length < 20) {
      coCitations = await this.getCoCitations(grepHits);
      coCitations.forEach((path) => allCandidates.add(path));
    }

    const expansionSummary = [];
    if (expandedFromGrep.length > grepHits.length) {
      expansionSummary.push(`grep: ${grepHits.length}→${expandedFromGrep.length}`);
    }
    if (activeFile && activeNeighbors.length > 1) {
      expansionSummary.push(`active: ${activeNeighbors.length}`);
    }
    if (coCitations.length > 0) {
      expansionSummary.push(`co-cited: ${coCitations.length}`);
    }

    if (expansionSummary.length > 0) {
      logInfo(`  Graph expansion: ${expansionSummary.join(", ")} → ${allCandidates.size} total`);
    }

    return Array.from(allCandidates);
  }
}
