import { logInfo } from "@/logger";
import { App, MetadataCache } from "obsidian";

/**
 * Configuration for graph boost scoring
 */
export interface GraphBoostConfig {
  /** Enable graph boost scoring (default: true) */
  enabled: boolean;
  /** Overall weight for graph boost in final score (0.0-1.0, default: 0.3) */
  weight: number;
  /** Weight for connections between candidates (default: 0.2) */
  candidateConnectionWeight: number;
  /** Use logarithmic scaling for connection counts (default: true) */
  useLogScale: boolean;
}

/**
 * Default configuration for graph boost
 */
export const DEFAULT_GRAPH_BOOST_CONFIG: GraphBoostConfig = {
  enabled: true,
  weight: 0.3,
  candidateConnectionWeight: 0.2,
  useLogScale: true,
};

/**
 * Result of graph boost calculation for a single note
 */
export interface GraphBoostResult {
  /** Note ID (path) */
  noteId: string;
  /** Number of connections to other candidates */
  candidateConnections: number;
  /** Total number of outgoing links from this note */
  totalOutgoingLinks: number;
  /** Calculated boost multiplier (1.0 = no boost) */
  boostMultiplier: number;
}

/**
 * Calculates graph-based boost scores for search candidates.
 *
 * This class implements a ranking signal based on link connections between
 * search result candidates. Notes that are connected to other relevant notes
 * receive a boost, similar to PageRank but computed only within the candidate set.
 *
 * Key principles:
 * - Graph connections are a SIGNAL not a retrieval mechanism
 * - Only analyzes connections within the candidate set (bounded complexity)
 * - Returns multiplicative boost factors (1.0 = no boost)
 */
export class GraphBoostCalculator {
  private metadataCache: MetadataCache;
  private config: GraphBoostConfig;

  constructor(app: App, config: Partial<GraphBoostConfig> = {}) {
    this.metadataCache = app.metadataCache;
    this.config = { ...DEFAULT_GRAPH_BOOST_CONFIG, ...config };
  }

  /**
   * Calculate graph boost scores for a set of candidate notes.
   *
   * @param candidateIds - Array of note paths that are search candidates
   * @returns Map of note ID to boost result
   */
  calculateBoosts(candidateIds: string[]): Map<string, GraphBoostResult> {
    const results = new Map<string, GraphBoostResult>();

    if (!this.config.enabled || candidateIds.length === 0) {
      // Return neutral boosts if disabled or no candidates
      candidateIds.forEach((id) => {
        results.set(id, {
          noteId: id,
          candidateConnections: 0,
          totalOutgoingLinks: 0,
          boostMultiplier: 1.0,
        });
      });
      return results;
    }

    // Create a set for O(1) lookup of candidates
    const candidateSet = new Set(candidateIds);

    // Calculate connections for each candidate
    for (const candidateId of candidateIds) {
      const connections = this.countCandidateConnections(candidateId, candidateSet);
      const boostMultiplier = this.calculateBoostMultiplier(connections);

      results.set(candidateId, {
        noteId: candidateId,
        candidateConnections: connections.candidateConnections,
        totalOutgoingLinks: connections.totalOutgoingLinks,
        boostMultiplier,
      });
    }

    // Log summary statistics in debug mode
    if (candidateIds.length > 0) {
      const boosts = Array.from(results.values());
      const avgConnections =
        boosts.reduce((sum, b) => sum + b.candidateConnections, 0) / boosts.length;
      const maxConnections = Math.max(...boosts.map((b) => b.candidateConnections));

      logInfo(
        `GraphBoost: Calculated for ${candidateIds.length} candidates. ` +
          `Avg connections: ${avgConnections.toFixed(1)}, Max: ${maxConnections}`
      );
    }

    return results;
  }

  /**
   * Count how many connections a note has to other candidates.
   *
   * @param noteId - The note to analyze
   * @param candidateSet - Set of candidate note IDs for O(1) lookup
   * @returns Connection counts
   */
  private countCandidateConnections(
    noteId: string,
    candidateSet: Set<string>
  ): { candidateConnections: number; totalOutgoingLinks: number } {
    const cache = this.metadataCache.getCache(noteId);

    if (!cache?.links) {
      return { candidateConnections: 0, totalOutgoingLinks: 0 };
    }

    // Extract unique link paths
    const outgoingLinks = new Set<string>();

    for (const link of cache.links) {
      // Resolve the link to get the actual file path
      const linkedFile = this.metadataCache.getFirstLinkpathDest(link.link, noteId);
      if (linkedFile) {
        outgoingLinks.add(linkedFile.path);
      }
    }

    // Count connections to other candidates
    let candidateConnections = 0;
    for (const linkPath of outgoingLinks) {
      if (candidateSet.has(linkPath)) {
        candidateConnections++;
      }
    }

    return {
      candidateConnections,
      totalOutgoingLinks: outgoingLinks.size,
    };
  }

  /**
   * Calculate the boost multiplier based on connection counts.
   *
   * @param connections - Connection counts
   * @returns Boost multiplier (1.0 = no boost)
   */
  private calculateBoostMultiplier(connections: {
    candidateConnections: number;
    totalOutgoingLinks: number;
  }): number {
    if (connections.candidateConnections === 0) {
      return 1.0; // No boost if no connections
    }

    const { candidateConnectionWeight, useLogScale } = this.config;

    // Calculate base boost from candidate connections
    let connectionBoost: number;
    if (useLogScale) {
      // Logarithmic scaling: diminishing returns for many connections
      // log(1) = 0, log(2) ≈ 0.69, log(5) ≈ 1.6, log(10) ≈ 2.3
      connectionBoost = Math.log(connections.candidateConnections + 1);
    } else {
      // Linear scaling
      connectionBoost = connections.candidateConnections;
    }

    // Apply weight and convert to multiplier
    // Formula: 1 + (weight * normalized_connections)
    // This ensures we always get a multiplier >= 1.0
    const boostMultiplier = 1 + candidateConnectionWeight * connectionBoost;

    // Cap the maximum boost to prevent over-influence
    const maxBoost = 2.0; // At most double the score
    return Math.min(boostMultiplier, maxBoost);
  }

  /**
   * Apply graph boosts to an array of scored items.
   *
   * @param items - Array of items with id and score
   * @returns Same array with scores modified by graph boost
   */
  applyBoosts<T extends { id: string; score: number }>(items: T[]): T[] {
    if (!this.config.enabled || items.length === 0) {
      return items;
    }

    const candidateIds = items.map((item) => item.id);
    const boosts = this.calculateBoosts(candidateIds);

    // Apply boosts to scores
    for (const item of items) {
      const boost = boosts.get(item.id);
      if (boost) {
        item.score *= boost.boostMultiplier;
      }
    }

    return items;
  }

  /**
   * Update configuration
   */
  setConfig(config: Partial<GraphBoostConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): GraphBoostConfig {
    return { ...this.config };
  }
}
