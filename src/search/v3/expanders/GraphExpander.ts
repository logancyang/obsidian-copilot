import { App, TFile } from "obsidian";
import { logInfo } from "@/logger";

/**
 * Expands search candidates using graph traversal (links and backlinks)
 */
export class GraphExpander {
  constructor(private app: App) {}

  /**
   * Expand from given note paths to find related notes via graph traversal
   * @param notePaths - Starting note paths
   * @param hops - Number of hops to traverse (1-3 recommended)
   * @returns Expanded set of note paths including all connected notes
   */
  async expandFromNotes(notePaths: string[], hops: number = 1): Promise<string[]> {
    const expanded = new Set<string>(notePaths);

    for (let hop = 0; hop < hops; hop++) {
      const frontier = [...expanded];
      const startSize = expanded.size;

      for (const path of frontier) {
        // Get outgoing links
        const outgoing = this.app.metadataCache.resolvedLinks[path] || {};
        Object.keys(outgoing).forEach((link) => expanded.add(link));

        // Get backlinks
        const file = this.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) {
          const backlinks = this.app.metadataCache.getBacklinksForFile(file);
          if (backlinks?.data) {
            Object.keys(backlinks.data).forEach((link) => expanded.add(link));
          }
        }
      }

      if (expanded.size > startSize) {
        logInfo(
          `  Graph hop ${hop + 1}: ${startSize} → ${expanded.size} notes (+${expanded.size - startSize})`
        );
      }
    }

    return Array.from(expanded);
  }

  /**
   * Get neighbors of the currently active note
   * @param hops - Number of hops from active note
   * @returns Array of neighbor note paths
   */
  async getActiveNoteNeighbors(hops: number = 1): Promise<string[]> {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      return [];
    }

    return this.expandFromNotes([activeFile.path], hops);
  }

  /**
   * Get co-citations - notes that link to the same targets as the given notes
   * @param notePaths - Source note paths
   * @returns Array of co-cited note paths
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
   * Combined graph expansion with multiple strategies
   * @param grepHits - Initial grep results
   * @param activeFile - Currently active file (if any)
   * @param hops - Number of hops for expansion
   * @returns Combined expanded note paths
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

    // Add co-citations for better recall
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
