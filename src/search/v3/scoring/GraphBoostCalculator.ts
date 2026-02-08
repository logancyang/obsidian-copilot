import { logInfo } from "@/logger";
import { App, MetadataCache, TFile } from "obsidian";
import { NoteIdRank } from "../interfaces";
import { extractNotePathFromChunkId } from "../utils/chunkIdUtils";

/**
 * Connection types for graph boost calculation
 */
interface GraphConnections {
  backlinks: string[]; // Notes from top results that link TO this note
  coCitations: string[]; // Notes from top results cited by same sources
  sharedTags: string[]; // Notes from top results with common tags
  connectionScore: number; // Weighted sum of connections
  boostMultiplier: number; // Final boost multiplier
}

/**
 * Configuration for graph boost
 */
export interface GraphBoostConfig {
  enabled: boolean;
  maxCandidates: number; // Absolute max results to analyze (default: 10)
  backlinkWeight: number; // Weight for backlinks (default: 1.0)
  coCitationWeight: number; // Weight for co-citations (default: 0.5)
  sharedTagWeight: number; // Weight for shared tags (default: 0.3)
  boostStrength: number; // Overall boost strength (default: 0.1)
  maxBoostMultiplier: number; // Cap on boost (default: 1.2)
}

/**
 * Default configuration
 */
export const DEFAULT_CONFIG: GraphBoostConfig = {
  enabled: true,
  maxCandidates: 10,
  backlinkWeight: 1.0,
  coCitationWeight: 0.5,
  sharedTagWeight: 0.3,
  boostStrength: 0.1,
  maxBoostMultiplier: 1.2,
};

/**
 * Graph boost calculator that rewards notes connected to other relevant results
 * through backlinks, co-citations, and shared tags.
 */
export class GraphBoostCalculator {
  private metadataCache: MetadataCache;
  private config: GraphBoostConfig;

  constructor(app: App, config: Partial<GraphBoostConfig> = {}) {
    this.metadataCache = app.metadataCache;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Apply query-aware graph boost to search results
   */
  applyBoost(results: NoteIdRank[]): NoteIdRank[] {
    if (!this.config.enabled || results.length === 0) {
      return results;
    }

    // Filter candidates (deduplicated to note level)
    const candidates = this.filterCandidates(results);

    // Early exit if no candidates or too few for meaningful connections
    if (candidates.length < 2) {
      return results;
    }

    // Build candidate set at note level for metadata lookups
    const candidateNotePaths = new Set(candidates.map((r) => extractNotePathFromChunkId(r.id)));

    // Calculate connections for each unique note
    const noteConnectionsMap = new Map<string, GraphConnections>();

    for (const notePath of candidateNotePaths) {
      const connections = this.calculateConnections(notePath, candidateNotePaths);
      noteConnectionsMap.set(notePath, connections);
    }

    // Apply boost to all results — all chunks of a boosted note get the same multiplier
    const boostedResults = results.map((result) => {
      const notePath = extractNotePathFromChunkId(result.id);
      const connections = noteConnectionsMap.get(notePath);

      if (!connections || connections.boostMultiplier === 1.0) {
        return result;
      }

      return {
        ...result,
        score: result.score * connections.boostMultiplier,
        explanation: result.explanation
          ? {
              ...result.explanation,
              graphConnections: {
                backlinks: connections.backlinks.length,
                coCitations: connections.coCitations.length,
                sharedTags: connections.sharedTags.length,
                score: connections.connectionScore,
                boostMultiplier: connections.boostMultiplier,
              },
            }
          : undefined,
      };
    });

    // Log summary
    const boosted = boostedResults.filter((r) => {
      const notePath = extractNotePathFromChunkId(r.id);
      const conn = noteConnectionsMap.get(notePath);
      return conn && conn.boostMultiplier > 1.0;
    });

    if (boosted.length > 0) {
      logInfo(`GraphBoostCalculator: Boosted ${boosted.length} notes based on connections`);
    }

    return boostedResults;
  }

  /**
   * Calculate all connections for a note within the candidate set
   */
  private calculateConnections(noteId: string, candidateSet: Set<string>): GraphConnections {
    const backlinks = this.findBacklinks(noteId, candidateSet);
    const coCitations = this.findCoCitations(noteId, candidateSet);
    const sharedTags = this.findSharedTags(noteId, candidateSet);

    // Calculate weighted connection score
    const connectionScore =
      backlinks.length * this.config.backlinkWeight +
      coCitations.length * this.config.coCitationWeight +
      sharedTags.length * this.config.sharedTagWeight;

    // Calculate boost multiplier with logarithmic scaling
    let boostMultiplier = 1.0;
    if (connectionScore > 0) {
      boostMultiplier = 1 + this.config.boostStrength * Math.log(1 + connectionScore);
      boostMultiplier = Math.min(boostMultiplier, this.config.maxBoostMultiplier);
    }

    return {
      backlinks,
      coCitations,
      sharedTags,
      connectionScore,
      boostMultiplier,
    };
  }

  /**
   * Resolve a note ID to a TFile object
   */
  private resolveFile(noteId: string): TFile | null {
    const file = this.metadataCache.getFirstLinkpathDest(noteId, "");
    // In tests, the file might be a plain object with the right shape
    // Check for the required properties instead of instanceof
    return file && typeof file === "object" && "path" in file ? (file as TFile) : null;
  }

  /**
   * Find which candidates link TO this note
   */
  private findBacklinks(noteId: string, candidateSet: Set<string>): string[] {
    const backlinks: string[] = [];

    const file = this.resolveFile(noteId);
    if (!file) {
      return backlinks;
    }

    const linksTo = this.metadataCache.getBacklinksForFile(file);
    if (!linksTo) {
      return backlinks;
    }

    // Check which backlinks are in our candidate set
    for (const [linkPath] of linksTo.data) {
      if (candidateSet.has(linkPath) && linkPath !== noteId) {
        backlinks.push(linkPath);
      }
    }

    return backlinks;
  }

  /**
   * Find candidates that share citing sources with this note
   */
  private findCoCitations(noteId: string, candidateSet: Set<string>): string[] {
    const coCitations: string[] = [];
    const citingSources = new Set<string>();

    // Find all notes that link to this note
    const file = this.resolveFile(noteId);
    if (!file) {
      return coCitations;
    }

    const linksTo = this.metadataCache.getBacklinksForFile(file);
    if (!linksTo) {
      return coCitations;
    }

    // Collect all citing sources
    for (const [sourcePath] of linksTo.data) {
      citingSources.add(sourcePath);
    }

    if (citingSources.size === 0) {
      return coCitations;
    }

    // Check other candidates for shared citing sources
    for (const candidateId of candidateSet) {
      if (candidateId === noteId) continue;

      const candidateFile = this.resolveFile(candidateId);
      if (!candidateFile) continue;

      const candidateLinksTo = this.metadataCache.getBacklinksForFile(candidateFile);
      if (!candidateLinksTo) continue;

      // Check if they share any citing sources
      for (const [sourcePath] of candidateLinksTo.data) {
        if (citingSources.has(sourcePath)) {
          coCitations.push(candidateId);
          break; // Only count once per candidate
        }
      }
    }

    return coCitations;
  }

  /**
   * Find candidates that share tags with this note
   */
  private findSharedTags(noteId: string, candidateSet: Set<string>): string[] {
    const sharedTags: string[] = [];

    const file = this.resolveFile(noteId);
    if (!file) {
      return sharedTags;
    }

    const cache = this.metadataCache.getFileCache(file);
    if (!cache || !cache.tags || cache.tags.length === 0) {
      return sharedTags;
    }

    const noteTags = new Set(cache.tags.map((t) => t.tag));

    // Check other candidates for shared tags
    for (const candidateId of candidateSet) {
      if (candidateId === noteId) continue;

      const candidateFile = this.resolveFile(candidateId);
      if (!candidateFile) continue;

      const candidateCache = this.metadataCache.getFileCache(candidateFile);
      if (!candidateCache || !candidateCache.tags) continue;

      // Check if they share any tags
      const hasSharedTag = candidateCache.tags.some((t) => noteTags.has(t.tag));
      if (hasSharedTag) {
        sharedTags.push(candidateId);
      }
    }

    return sharedTags;
  }

  /**
   * Filter candidates by deduplicating to unique notes, then applying the max limit.
   * Keeps the best-scoring chunk per note so that the limit applies to note count, not chunk count.
   */
  private filterCandidates(results: NoteIdRank[]): NoteIdRank[] {
    // Deduplicate: keep the best chunk per unique note (results are score-sorted)
    const bestPerNote = new Map<string, NoteIdRank>();
    for (const result of results) {
      const notePath = extractNotePathFromChunkId(result.id);
      if (!bestPerNote.has(notePath)) {
        bestPerNote.set(notePath, result);
      }
    }

    let candidates = Array.from(bestPerNote.values());

    // Apply max candidates limit at note level
    const beforeLimit = candidates.length;
    candidates = candidates.slice(0, this.config.maxCandidates);

    if (beforeLimit > this.config.maxCandidates) {
      logInfo(
        `GraphBoost: Limited to top ${this.config.maxCandidates} note candidates (from ${beforeLimit} unique notes)`
      );
    }

    return candidates;
  }

  /**
   * Update configuration
   */
  setConfig(config: Partial<GraphBoostConfig>): void {
    this.config = { ...this.config, ...config };
  }
}
