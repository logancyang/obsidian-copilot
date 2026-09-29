import { logInfo } from "@/logger";
import { App, MetadataCache, TFile } from "obsidian";
import { NoteIdRank } from "@/search/v3/interfaces";
import { extractNotePathFromChunkId } from "@/search/v3/utils/chunkIdUtils";

interface GraphConnections {
  backlinks: string[];
  coCitations: string[];
  sharedTags: string[];
  connectionScore: number;
  boostMultiplier: number;
}

export interface GraphBoostConfig {
  enabled: boolean;
  maxCandidates: number;
  backlinkWeight: number;
  coCitationWeight: number;
  sharedTagWeight: number;
  boostStrength: number;
  maxBoostMultiplier: number;
}

const DEFAULT_CONFIG: GraphBoostConfig = {
  enabled: true,
  maxCandidates: 10,
  backlinkWeight: 1.0,
  coCitationWeight: 0.5,
  sharedTagWeight: 0.3,
  boostStrength: 0.1,
  maxBoostMultiplier: 1.2,
};

export class GraphBoostCalculator {
  private metadataCache: MetadataCache;
  private config: GraphBoostConfig;

  constructor(app: App, config: Partial<GraphBoostConfig> = {}) {
    this.metadataCache = app.metadataCache;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  applyBoost(results: NoteIdRank[]): NoteIdRank[] {
    if (!this.config.enabled || results.length === 0) {
      return results;
    }

    const candidates = this.filterCandidates(results);

    if (candidates.length < 2) {
      return results;
    }

    const candidateNotePaths = new Set(candidates.map((r) => extractNotePathFromChunkId(r.id)));

    const noteConnectionsMap = new Map<string, GraphConnections>();

    for (const notePath of candidateNotePaths) {
      const connections = this.calculateConnections(notePath, candidateNotePaths);
      noteConnectionsMap.set(notePath, connections);
    }

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

  private calculateConnections(noteId: string, candidateSet: Set<string>): GraphConnections {
    const backlinks = this.findBacklinks(noteId, candidateSet);
    const coCitations = this.findCoCitations(noteId, candidateSet);
    const sharedTags = this.findSharedTags(noteId, candidateSet);

    const connectionScore =
      backlinks.length * this.config.backlinkWeight +
      coCitations.length * this.config.coCitationWeight +
      sharedTags.length * this.config.sharedTagWeight;

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

  private resolveFile(noteId: string): TFile | null {
    const file = this.metadataCache.getFirstLinkpathDest(noteId, "");
    return file instanceof TFile ? file : null;
  }

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

    for (const [linkPath] of linksTo.data) {
      if (candidateSet.has(linkPath) && linkPath !== noteId) {
        backlinks.push(linkPath);
      }
    }

    return backlinks;
  }

  private findCoCitations(noteId: string, candidateSet: Set<string>): string[] {
    const coCitations: string[] = [];
    const citingSources = new Set<string>();

    const file = this.resolveFile(noteId);
    if (!file) {
      return coCitations;
    }

    const linksTo = this.metadataCache.getBacklinksForFile(file);
    if (!linksTo) {
      return coCitations;
    }

    for (const [sourcePath] of linksTo.data) {
      citingSources.add(sourcePath);
    }

    if (citingSources.size === 0) {
      return coCitations;
    }

    for (const candidateId of candidateSet) {
      if (candidateId === noteId) continue;

      const candidateFile = this.resolveFile(candidateId);
      if (!candidateFile) continue;

      const candidateLinksTo = this.metadataCache.getBacklinksForFile(candidateFile);
      if (!candidateLinksTo) continue;

      for (const [sourcePath] of candidateLinksTo.data) {
        if (citingSources.has(sourcePath)) {
          coCitations.push(candidateId);
          break;
        }
      }
    }

    return coCitations;
  }

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

    for (const candidateId of candidateSet) {
      if (candidateId === noteId) continue;

      const candidateFile = this.resolveFile(candidateId);
      if (!candidateFile) continue;

      const candidateCache = this.metadataCache.getFileCache(candidateFile);
      if (!candidateCache || !candidateCache.tags) continue;

      const hasSharedTag = candidateCache.tags.some((t) => noteTags.has(t.tag));
      if (hasSharedTag) {
        sharedTags.push(candidateId);
      }
    }

    return sharedTags;
  }

  private filterCandidates(results: NoteIdRank[]): NoteIdRank[] {
    const bestPerNote = new Map<string, NoteIdRank>();
    for (const result of results) {
      const notePath = extractNotePathFromChunkId(result.id);
      if (!bestPerNote.has(notePath)) {
        bestPerNote.set(notePath, result);
      }
    }

    let candidates = Array.from(bestPerNote.values());

    const beforeLimit = candidates.length;
    candidates = candidates.slice(0, this.config.maxCandidates);

    if (beforeLimit > this.config.maxCandidates) {
      logInfo(
        `GraphBoost: Limited to top ${this.config.maxCandidates} note candidates (from ${beforeLimit} unique notes)`
      );
    }

    return candidates;
  }

  setConfig(config: Partial<GraphBoostConfig>): void {
    this.config = { ...this.config, ...config };
  }
}
