import { HybridRetriever } from "@/search/hybridRetriever";
import { RETURN_ALL_LIMIT } from "@/search/v3/SearchCore";
import { TieredLexicalRetriever } from "@/search/v3/TieredLexicalRetriever";
import { BaseCallbackConfig } from "@langchain/core/callbacks/manager";
import { Document } from "@langchain/core/documents";
import { BaseRetriever } from "@langchain/core/retrievers";
import { App } from "obsidian";

type RetrieverOptions = {
  minSimilarityScore?: number;
  maxK: number;
  salientTerms: string[];
  timeRange?: { startTime: number; endTime: number };
  textWeight?: number;
  returnAll?: boolean;
  useRerankerThreshold?: number;
  returnAllTags?: boolean;
  tagTerms?: string[];
};

type SourceKind = "lexical" | "semantic";

type SemanticRetrieverFactory = (options: RetrieverOptions) => BaseRetriever;

/**
 * Merges semantic (vector-based) and lexical (Search v3) retrieval results into a single ranked list.
 * When semantic search is enabled this retriever ensures keyword/tag matches from Search v3
 * are blended with semantic recall, while preserving the familiar BaseRetriever contract.
 */
export class MergedSemanticRetriever extends BaseRetriever {
  public lc_namespace = ["merged_semantic_retriever"];

  private lexicalRetriever: TieredLexicalRetriever;
  private semanticRetriever: BaseRetriever;
  private readonly originalMaxK: number;
  private readonly returnAll: boolean;

  private static readonly LEXICAL_WEIGHT = 1.0;
  private static readonly SEMANTIC_WEIGHT = 1.0;
  private static readonly TAG_MATCH_BOOST = 1.1;

  /**
   * Creates a merged retriever that executes both semantic and lexical searches.
   *
   * @param app - Obsidian application instance
   * @param options - Retrieval options shared between semantic and lexical engines
   */
  constructor(
    private app: App,
    private options: RetrieverOptions,
    private semanticRetrieverFactory?: SemanticRetrieverFactory
  ) {
    super();
    this.originalMaxK = Math.max(1, options.maxK);
    this.returnAll = Boolean(options.returnAll);

    const lexicalMax = this.returnAll
      ? RETURN_ALL_LIMIT
      : Math.min(this.originalMaxK * 2, RETURN_ALL_LIMIT);

    const lexicalOptions: RetrieverOptions = {
      ...options,
      maxK: lexicalMax,
      returnAll: this.returnAll,
      returnAllTags: options.returnAllTags,
      tagTerms: options.tagTerms,
    };

    this.lexicalRetriever = new TieredLexicalRetriever(app, lexicalOptions);

    const semanticMax = this.returnAll
      ? RETURN_ALL_LIMIT
      : Math.min(this.originalMaxK * 2, RETURN_ALL_LIMIT);

    const semanticOptions: RetrieverOptions = {
      ...options,
      maxK: semanticMax,
      returnAll: this.returnAll,
    };

    this.semanticRetriever = this.semanticRetrieverFactory
      ? this.semanticRetrieverFactory(semanticOptions)
      : new HybridRetriever({
          minSimilarityScore: options.minSimilarityScore ?? 0.1,
          maxK: semanticMax,
          salientTerms: options.salientTerms,
          timeRange: options.timeRange,
          textWeight: options.textWeight,
          returnAll: this.returnAll,
          useRerankerThreshold: options.useRerankerThreshold,
        });
  }

  /**
   * Retrieves relevant documents by combining semantic and lexical matches.
   *
   * @param query - User query string
   * @param config - Optional LangChain callback configuration
   * @returns Array of merged and ranked Documents
   */
  public async getRelevantDocuments(
    query: string,
    config?: BaseCallbackConfig
  ): Promise<Document[]> {
    const [lexicalDocs, semanticDocs] = await Promise.all([
      this.lexicalRetriever.getRelevantDocuments(query, config),
      this.semanticRetriever.invoke(query, config),
    ]);

    const merged = new Map<string, Document>();

    for (const doc of lexicalDocs) {
      this.insertResult(merged, doc, "lexical");
    }

    for (const doc of semanticDocs) {
      this.insertResult(merged, doc, "semantic");
    }

    const mergedResults = Array.from(merged.values()).sort(
      (a, b) => (b.metadata?.score ?? 0) - (a.metadata?.score ?? 0)
    );

    const limit = this.returnAll ? RETURN_ALL_LIMIT : this.originalMaxK;
    return mergedResults.slice(0, limit);
  }

  /**
   * Inserts a document into the result map, respecting source precedence and scoring rules.
   *
   * @param map - Target map keyed by unique identifiers
   * @param doc - Document to insert
   * @param source - Origin of the document
   */
  private insertResult(map: Map<string, Document>, doc: Document, source: SourceKind): void {
    const key = this.getDocumentKey(doc); // Map key = chunk-level identity for cross-engine dedupe
    const enriched = this.decorateDocument(doc, source);

    const existing = map.get(key);
    if (!existing) {
      map.set(key, enriched);
      return;
    }

    const existingSource = existing.metadata?.source as SourceKind | undefined;
    const existingScore = this.getDocumentScore(existing);
    const newScore = this.getDocumentScore(enriched);

    if (source === "lexical") {
      if (existingSource !== "lexical" || newScore > existingScore) {
        map.set(key, enriched);
      }
      return;
    }

    // Semantic result: only replace if the existing entry is also semantic and lower scoring
    if (existingSource !== "lexical" && newScore > existingScore) {
      map.set(key, enriched);
    }
  }

  /**
   * Computes a stable key for a document using chunk identifiers, paths, or fallback content hashes.
   *
   * @param doc - Document to derive a key for
   * @returns Stable identifier string
   */
  private getDocumentKey(doc: Document): string {
    const metadata = doc.metadata ?? {};
    return (
      metadata.chunkId ||
      metadata.path ||
      metadata.id ||
      metadata.title ||
      `${doc.pageContent.slice(0, 64)}::${doc.pageContent.length}`
    );
  }

  /**
   * Decorates a document with source metadata and blended scores.
   *
   * @param doc - Document to decorate
   * @param source - Origin of the document
   * @returns Decorated Document instance
   */
  private decorateDocument(doc: Document, source: SourceKind): Document {
    const metadata: Record<string, any> = {
      ...(doc.metadata ?? {}),
      source,
    };

    // Blend lexical + semantic scores; lexical and semantic weights are currently equal
    // Tag matches in lexical scoring receive a small boost to prioritize keyword hits
    const baseScore = this.extractBaseScore(metadata);
    const weight =
      source === "lexical"
        ? MergedSemanticRetriever.LEXICAL_WEIGHT
        : MergedSemanticRetriever.SEMANTIC_WEIGHT;
    let blendedScore = baseScore * weight;

    if (source === "lexical" && this.hasTagMatch(metadata)) {
      blendedScore *= MergedSemanticRetriever.TAG_MATCH_BOOST;
    }

    metadata.score = blendedScore;
    metadata.rerank_score = blendedScore;

    return new Document({
      pageContent: doc.pageContent,
      metadata,
    });
  }

  /**
   * Extracts the most relevant numeric score from document metadata.
   *
   * @param metadata - Document metadata bag
   * @returns Numeric score or zero when unavailable
   */
  private extractBaseScore(metadata: Record<string, any>): number {
    const candidates = [metadata?.rerank_score, metadata?.score];
    for (const value of candidates) {
      if (typeof value === "number" && !Number.isNaN(value)) {
        return value;
      }
    }
    return 0;
  }

  /**
   * Safely retrieves the blended score from a Document (falls back to 0 when absent).
   */
  private getDocumentScore(doc: Document): number {
    const score = doc.metadata?.score;
    return typeof score === "number" && !Number.isNaN(score) ? score : 0;
  }

  /**
   * Determines whether a document benefitted from a tag match in the lexical scorer.
   *
   * @param metadata - Document metadata bag
   * @returns True if tag matches were present in the explanation
   */
  private hasTagMatch(metadata: Record<string, any>): boolean {
    const explanation = metadata?.explanation;
    if (!explanation) {
      return false;
    }
    const matches = explanation.lexicalMatches;
    if (!Array.isArray(matches)) {
      return false;
    }
    return matches.some((match: any) => match?.field === "tags");
  }
}
