import { logError, logInfo } from "@/logger";
import { App, TFile } from "obsidian";
import { NoteIdRank } from "../interfaces";

/**
 * Semantic re-ranker for enhanced search results using embeddings
 */
export class SemanticReranker {
  constructor(
    private app: App,
    private embedText?: (text: string) => Promise<number[]>
  ) {}

  /**
   * Re-rank candidates using semantic similarity
   * @param candidates - Candidate notes to re-rank
   * @param queryEmbeddings - Embeddings for query variants
   * @returns Re-ranked results based on semantic similarity
   */
  async reRankBySimilarity(
    candidates: NoteIdRank[],
    queryEmbeddings: number[][]
  ): Promise<NoteIdRank[]> {
    if (!this.embedText) {
      logInfo("SemanticReranker: No embedding function provided, returning original order");
      return candidates;
    }

    const scores = new Map<string, number>();

    for (const candidate of candidates) {
      try {
        const file = this.app.vault.getAbstractFileByPath(candidate.id);
        if (file instanceof TFile) {
          // Read first 2000 characters for embedding
          const content = await this.app.vault.cachedRead(file);
          const snippet = content.slice(0, 2000);

          // Get embedding for the note content
          const noteEmbedding = await this.embedText(snippet);

          // Calculate max similarity across all query variants
          let maxSim = 0;
          for (const qEmbed of queryEmbeddings) {
            const sim = this.cosineSimilarity(qEmbed, noteEmbedding);
            maxSim = Math.max(maxSim, sim);
          }

          scores.set(candidate.id, maxSim);
        }
      } catch (error) {
        logError(`SemanticReranker: Failed to process ${candidate.id}`, error);
        scores.set(candidate.id, 0); // Give it a low score
      }
    }

    // Sort by semantic similarity
    const reranked = Array.from(scores.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([id, score]) => ({
        id,
        score,
        engine: "semantic",
      }));

    logInfo(`SemanticReranker: Re-ranked ${reranked.length} candidates`);
    return reranked;
  }

  /**
   * Perform semantic search from scratch
   * @param query - Search query
   * @param limit - Maximum results
   * @returns Semantically similar notes
   */
  async semanticSearch(query: string, limit: number = 200): Promise<NoteIdRank[]> {
    // Placeholder: a direct semantic search entry point can integrate MemoryIndexManager if needed

    logInfo("SemanticReranker: Direct semantic search not yet implemented");
    return [];
  }

  /**
   * Embed multiple query variants
   * @param queries - Array of query strings
   * @returns Array of embeddings
   */
  async embedQueries(queries: string[]): Promise<number[][]> {
    if (!this.embedText) {
      return [];
    }

    const embeddings: number[][] = [];

    for (const query of queries) {
      try {
        const embedding = await this.embedText(query);
        embeddings.push(embedding);
      } catch (error) {
        logError(`SemanticReranker: Failed to embed query "${query}"`, error);
      }
    }

    return embeddings;
  }

  /**
   * Calculate cosine similarity between two vectors
   * @param a - First vector
   * @param b - Second vector
   * @returns Cosine similarity score (0-1)
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      return 0;
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);

    if (normA === 0 || normB === 0) {
      return 0;
    }

    return dotProduct / (normA * normB);
  }

  /**
   * Combine lexical and semantic results before re-ranking
   * @param lexicalResults - Results from L1 search
   * @param semanticCandidates - Additional semantic candidates
   * @returns Combined unique set of candidates
   */
  combineResults(lexicalResults: NoteIdRank[], semanticCandidates: NoteIdRank[]): NoteIdRank[] {
    const seen = new Set<string>();
    const combined: NoteIdRank[] = [];

    // Add lexical results first (they have priority)
    for (const result of lexicalResults) {
      if (!seen.has(result.id)) {
        seen.add(result.id);
        combined.push(result);
      }
    }

    // Add semantic candidates
    for (const result of semanticCandidates) {
      if (!seen.has(result.id)) {
        seen.add(result.id);
        combined.push(result);
      }
    }

    logInfo(
      `SemanticReranker: Combined ${lexicalResults.length} lexical + ${semanticCandidates.length} semantic = ${combined.length} unique`
    );

    return combined;
  }
}
