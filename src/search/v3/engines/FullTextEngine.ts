import { logInfo, logWarn } from "@/logger";
import { CHUNK_SIZE } from "@/constants";
import FlexSearch from "flexsearch";
import { App, TFile, getAllTags } from "obsidian";
import { ChunkManager } from "../chunks";
import { NoteDoc, NoteIdRank, SearchExplanation } from "../interfaces";
import { MemoryManager } from "../utils/MemoryManager";

type ScoreAccumulator = {
  score: number;
  fieldMatches: Set<string>;
  queriesMatched: Set<string>;
  lexicalMatches: { field: string; query: string; weight: number }[];
  tagQueryMatches: Set<string>;
  tagFieldMatches: Set<string>;
};

/**
 * Full-text search engine using ephemeral FlexSearch index built per-query
 */
export class FullTextEngine {
  private index: any; // FlexSearch.Document
  private memoryManager: MemoryManager;
  private indexedChunks = new Set<string>();
  private chunkManager: ChunkManager;

  // Configuration constants
  private static readonly MAX_CONTENT_SIZE = 10 * 1024 * 1024; // 10MB security limit
  private static readonly BATCH_SIZE = 10; // Chunk indexing batch size for UI yielding
  private static readonly CHUNK_MEMORY_PERCENTAGE = 0.35; // 35% of memory budget for chunks
  private static readonly MAX_ARRAY_ITEMS = 10; // Max items to process from arrays
  private static readonly MAX_EXTRACTION_DEPTH = 2; // Max recursion depth for property extraction

  // Field weights for search scoring
  private static readonly FIELD_WEIGHTS = {
    title: 3,
    heading: 2.5,
    headings: 1.5,
    path: 1.5,
    tags: 4,
    props: 1.5,
    links: 1.5,
    body: 1,
  } as const;

  private static readonly TAG_PRIMARY_FIELD_BOOST = 6;
  private static readonly TAG_SECONDARY_FIELD_BOOST = 3;
  private static readonly TAG_BASE_MATCH_BONUS = 2;
  private static readonly TAG_METADATA_MATCH_BOOST = 2.5;
  private static readonly TAG_DIVERSITY_BONUS = 0.4;
  private static readonly TAG_METADATA_SCORE_BONUS = 5;

  constructor(
    private app: App,
    chunkManager?: ChunkManager
  ) {
    this.memoryManager = new MemoryManager();
    this.chunkManager = chunkManager || new ChunkManager(app);
    // Defer index creation to avoid blocking UI on initialization
    this.index = null as any;
  }

  /**
   * Create a new FlexSearch index with multilingual tokenization
   * Updated for chunk-based indexing
   */
  private createIndex(): any {
    const Document = (FlexSearch as any).Document;
    const tokenizer = this.tokenizeMixed.bind(this);
    return new Document({
      encode: false,
      tokenize: tokenizer,
      cache: false,
      document: {
        id: "id",
        index: [
          { field: "title", tokenize: tokenizer, weight: 3 }, // Note title
          { field: "heading", tokenize: tokenizer, weight: 2.5 }, // Section heading
          { field: "path", tokenize: tokenizer, weight: 2 }, // Path components
          { field: "tags", tokenize: tokenizer, weight: 4 }, // Note tags and hierarchies
          { field: "body", tokenize: tokenizer, weight: 1 }, // Chunk content
        ],
        store: ["id", "notePath", "title", "heading", "chunkIndex"], // Store metadata only, not body
      },
    });
  }

  /**
   * Hybrid tokenizer for ASCII words + CJK bigrams
   * @param str - String to tokenize
   * @returns Array of tokens
   */
  private tokenizeMixed(str: string): string[] {
    if (!str) {
      return [];
    }

    const tokens = new Set<string>();
    const lowered = str.toLowerCase();
    let asciiSource = lowered;

    // Extract tags (keep hash and generate hierarchy-aware tokens)
    let tagMatches: RegExpMatchArray | null = null;
    try {
      tagMatches = lowered.match(/#[\p{L}\p{N}_/-]+/gu);
    } catch {
      tagMatches = lowered.match(/#[a-z0-9_/-]+/g);
    }

    if (tagMatches) {
      for (const tag of tagMatches) {
        tokens.add(tag);

        const tagBody = tag.slice(1);
        if (!tagBody) {
          continue;
        }

        tokens.add(tagBody);

        const segments = tagBody.split("/").filter((segment) => segment.length > 0);
        if (segments.length > 0) {
          let prefix = "";
          for (const segment of segments) {
            prefix = prefix ? `${prefix}/${segment}` : segment;
            tokens.add(prefix);
            tokens.add(`#${prefix}`);
            tokens.add(segment);
          }
        }
        asciiSource = asciiSource.replace(tag, " ");
      }
    }

    // ASCII words (including alphanumeric and underscores)
    const asciiWords = asciiSource.match(/[a-z0-9_]+/g) || [];
    asciiWords.forEach((word) => tokens.add(word));

    // CJK pattern for Chinese, Japanese, Korean characters
    const cjkPattern = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]+/g;
    const cjkMatches = str.match(cjkPattern) || [];

    // Generate bigrams for CJK text
    for (const match of cjkMatches) {
      if (match.length === 1) {
        tokens.add(match);
      }
      for (let i = 0; i < match.length - 1; i++) {
        tokens.add(match.slice(i, i + 2));
      }
    }

    return Array.from(tokens);
  }

  /**
   * Build ephemeral index from candidate note paths by chunking them
   * @param candidatePaths - Array of note paths to index
   * @returns Number of chunks indexed
   */
  async buildFromCandidates(candidatePaths: string[]): Promise<number> {
    logInfo(`FullTextEngine: [CHUNKS] Starting with ${candidatePaths.length} candidate notes`);

    // Clear existing data
    this.indexedChunks.clear();
    this.memoryManager.reset();

    // Create new index
    if (!this.index) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      const startTime = Date.now();
      this.index = this.createIndex();
      const createTime = Date.now() - startTime;
      logInfo(`FullTextEngine: FlexSearch index created in ${createTime}ms`);
    }

    // Convert note paths to chunks
    const chunkOptions = {
      maxChars: CHUNK_SIZE,
      overlap: 0,
      maxBytesTotal: this.memoryManager.getMaxBytes() * FullTextEngine.CHUNK_MEMORY_PERCENTAGE,
    };

    const chunks = await this.chunkManager.getChunks(candidatePaths, chunkOptions);

    if (chunks.length === 0) {
      logInfo("FullTextEngine: No chunks generated");
      return 0;
    }

    logInfo(
      `FullTextEngine: Generated ${chunks.length} chunks from ${candidatePaths.length} notes`
    );

    // Index chunks
    let indexed = 0;
    const BATCH_SIZE = FullTextEngine.BATCH_SIZE;
    const processedNotes = new Map<string, { tags: string[]; links: string[]; props: string[] }>();

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];

      const contentSize = Buffer.byteLength(chunk.content, "utf8");
      if (!this.memoryManager.canAddContent(contentSize)) {
        logInfo(`FullTextEngine: Memory limit reached at ${indexed} chunks`);
        break;
      }

      // Extract path components for searchability
      const pathComponents = chunk.notePath.replace(/\.md$/, "").split("/").join(" ");

      // Extract note metadata (cache per note for efficiency)
      let noteMetadata = processedNotes.get(chunk.notePath);
      if (!noteMetadata) {
        const file = this.app.vault.getAbstractFileByPath(chunk.notePath);
        if (file instanceof TFile) {
          const cache = this.app.metadataCache.getFileCache(file);
          const frontmatter = cache?.frontmatter ?? {};
          const rawTags = cache ? (getAllTags(cache) ?? []) : [];
          const frontmatterTags = this.extractFrontmatterTags(frontmatter);
          const normalizedTags = this.normalizeTagList([...rawTags, ...frontmatterTags]);

          // Get links
          const outgoing = this.app.metadataCache.resolvedLinks[file.path] ?? {};
          const backlinks = this.app.metadataCache.getBacklinksForFile(file)?.data ?? {};
          const linksOut = Object.keys(outgoing);
          const linksIn = Object.keys(backlinks);
          const allLinks = [...linksOut, ...linksIn];

          // Extract frontmatter property values for search indexing
          const propValues = this.extractPropertyValues(frontmatter);

          noteMetadata = {
            tags: normalizedTags,
            links: allLinks,
            props: propValues,
          };
          processedNotes.set(chunk.notePath, noteMetadata);
        } else {
          noteMetadata = { tags: [], links: [], props: [] };
        }
      }

      // Add chunk to index (body indexed but not stored)
      // Include frontmatter properties in body for searchability
      const bodyWithProps = [chunk.content, ...noteMetadata.props].join(" ");

      this.index.add({
        id: chunk.id,
        title: chunk.title,
        heading: chunk.heading,
        path: pathComponents,
        body: bodyWithProps, // Include frontmatter values in searchable content
        tags: noteMetadata.tags,
        links: noteMetadata.links,
        props: noteMetadata.props.join(" "), // Keep props as string for potential future use
        notePath: chunk.notePath,
        chunkIndex: chunk.chunkIndex,
      });

      this.memoryManager.addBytes(contentSize);
      this.indexedChunks.add(chunk.id);
      indexed++;

      // Yield to UI thread periodically
      if (i > 0 && i % BATCH_SIZE === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    logInfo(
      `FullTextEngine: [CHUNKS] Indexed ${indexed}/${chunks.length} chunks (${this.memoryManager.getUsagePercent()}% memory)`
    );
    return indexed;
  }

  /**
   * Create NoteDoc from TFile using metadata cache
   * @param file - Obsidian TFile
   * @returns NoteDoc or null if file can't be processed
   */
  private async createNoteDoc(file: TFile): Promise<NoteDoc | null> {
    try {
      const cache = this.app.metadataCache.getFileCache(file);
      let content = await this.app.vault.cachedRead(file);

      // Security: Limit content size to prevent memory exhaustion
      if (content.length > FullTextEngine.MAX_CONTENT_SIZE) {
        logInfo(
          `FullText: File ${file.path} exceeds size limit (${content.length} bytes), truncating`
        );
        content = content.substring(0, FullTextEngine.MAX_CONTENT_SIZE);
      }

      // Extract metadata
      const allTags = cache ? (getAllTags(cache) ?? []) : [];
      const headings = cache?.headings?.map((h) => h.heading) ?? [];
      const props = cache?.frontmatter ?? {};

      // Get links (using full paths for accuracy)
      const outgoing = this.app.metadataCache.resolvedLinks[file.path] ?? {};
      const backlinks = this.app.metadataCache.getBacklinksForFile(file)?.data ?? {};

      // Store full paths for link information
      const linksOut = Object.keys(outgoing);
      const linksIn = Object.keys(backlinks);

      // Get title from frontmatter or filename
      const frontmatter = props as Record<string, any>;
      const title = frontmatter?.title || frontmatter?.name || file.basename;

      return {
        id: file.path,
        title,
        headings,
        tags: allTags,
        props,
        linksOut,
        linksIn,
        body: content,
      };
    } catch (error) {
      logInfo(`FullText: Skipped ${file.path}: ${error}`);
      return null;
    }
  }

  /**
   * Extract frontmatter property values for search indexing.
   * Only indexes primitive values (strings, numbers, booleans) and arrays of primitives.
   * Skips objects and null/undefined values.
   *
   * @param props - Frontmatter properties object
   * @returns Array of string values for indexing
   */
  private extractPropertyValues(props: Record<string, unknown> | undefined): string[] {
    const propValues: string[] = [];
    if (props && typeof props === "object") {
      for (const value of Object.values(props)) {
        this.extractPrimitiveValues(value, propValues, FullTextEngine.MAX_EXTRACTION_DEPTH);
      }
    }
    return propValues;
  }

  /**
   * Extracts tag strings from frontmatter definitions, supporting both scalar and array formats.
   *
   * @param frontmatter - Frontmatter object retrieved from the metadata cache
   * @returns Array of raw tag strings (without normalization)
   */
  private extractFrontmatterTags(frontmatter: Record<string, unknown> | undefined): string[] {
    if (!frontmatter || typeof frontmatter !== "object") {
      return [];
    }

    const collected: string[] = [];
    const possibleKeys: Array<"tags" | "tag"> = ["tags", "tag"];

    const addTag = (value: string) => {
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        collected.push(trimmed);
      }
    };

    for (const key of possibleKeys) {
      const rawValue = (frontmatter as Record<string, unknown>)[key];
      if (!rawValue) {
        continue;
      }

      if (Array.isArray(rawValue)) {
        for (const item of rawValue) {
          if (typeof item === "string") {
            addTag(item);
          }
        }
      } else if (typeof rawValue === "string") {
        rawValue
          .split(/[,\s]+/g)
          .map((segment) => segment.trim())
          .filter((segment) => segment.length > 0)
          .forEach(addTag);
      }
    }

    return collected;
  }

  /**
   * Normalizes tag strings so both hashed and plain variants (including hierarchical parents) are indexed.
   *
   * @param tags - Raw tag values gathered from note content and frontmatter
   * @returns Array of normalized tags with hashes and plain equivalents
   */
  private normalizeTagList(tags: string[]): string[] {
    const normalized = new Set<string>();

    for (const rawTag of tags) {
      if (typeof rawTag !== "string") {
        continue;
      }

      const trimmed = rawTag.trim();
      if (trimmed.length === 0) {
        continue;
      }

      const withoutHashes = trimmed.replace(/^#+/, "");
      if (withoutHashes.length === 0) {
        continue;
      }

      const base = withoutHashes.toLowerCase();
      normalized.add(`#${base}`);
      normalized.add(base);

      const segments = base.split("/").filter((segment) => segment.length > 0);
      if (segments.length > 1) {
        let prefix = "";
        for (const segment of segments) {
          prefix = prefix ? `${prefix}/${segment}` : segment;
          normalized.add(`#${prefix}`);
          normalized.add(prefix);
          normalized.add(segment);
        }
      } else if (segments.length === 1) {
        normalized.add(`#${segments[0]}`);
        normalized.add(segments[0]);
      }
    }

    return Array.from(normalized);
  }

  /**
   * Extract primitive values with depth limit to prevent infinite recursion.
   * Simpler approach using depth limit instead of circular reference tracking.
   *
   * @param value - The value to extract from
   * @param output - Array to collect extracted string values
   * @param maxDepth - Maximum recursion depth
   */
  private extractPrimitiveValues(value: unknown, output: string[], maxDepth: number): void {
    if (maxDepth <= 0 || value == null) return;

    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) output.push(trimmed);
    } else if (typeof value === "number" || typeof value === "boolean") {
      output.push(String(value));
    } else if (value instanceof Date) {
      output.push(value.toISOString());
    } else if (Array.isArray(value)) {
      // Limit array processing to first MAX_ARRAY_ITEMS items for performance
      value.slice(0, FullTextEngine.MAX_ARRAY_ITEMS).forEach((item) => {
        if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
          const str = typeof item === "string" ? item.trim() : String(item);
          if (str) output.push(str);
        }
      });
    }
    // Skip objects entirely - simpler and safer
  }

  /**
   * Search the ephemeral index with multiple query variants
   *
   * IMPORTANT: Expanded queries are used ONLY for recall (finding documents).
   * Only the original query AND salient terms contribute to ranking/scoring.
   *
   * @param queries - Array of query strings (original + expanded for recall)
   * @param limit - Maximum results per query
   * @param salientTerms - Salient terms extracted from original query (used for scoring)
   * @param originalQuery - The original user query (used for scoring)
   * @returns Array of NoteIdRank results
   */
  search(
    queries: string[],
    limit: number = 30,
    salientTerms: string[] = [],
    originalQuery?: string
  ): NoteIdRank[] {
    // Return empty results if index hasn't been created yet
    if (!this.index) {
      return [];
    }

    // First, use ALL queries to find documents (recall phase)
    const candidateDocs = new Set<string>();

    for (const query of queries) {
      try {
        const results = this.index.search(query, { limit: limit * 3, enrich: true });
        if (Array.isArray(results)) {
          for (const fieldResult of results) {
            if (!fieldResult?.result) continue;
            for (const item of fieldResult.result) {
              const id = typeof item === "string" ? item : item?.id;
              if (id) candidateDocs.add(id);
            }
          }
        }
      } catch (error) {
        logInfo(`FullText: Search failed for "${query}": ${error}`);
      }
    }

    logInfo(
      `FullText: Found ${candidateDocs.size} unique documents from all queries (recall phase)`
    );

    // Now, score using ONLY original query AND salient terms (not expanded queries)
    const scoreMap = new Map<string, ScoreAccumulator>();

    // Build list of scoring queries: ONLY salient terms (original query contains stopwords)
    // If no salient terms provided, fallback to original query for backward compatibility
    const scoringQueries: string[] =
      salientTerms.length > 0 ? [...salientTerms] : originalQuery ? [originalQuery] : [];

    // Score documents that were found in recall phase
    if (scoringQueries.length > 0 && candidateDocs.size > 0) {
      for (const query of scoringQueries) {
        this.scoreWithQuery(query, candidateDocs, scoreMap, limit);
      }
      logInfo(
        `FullText: Scored with ${scoringQueries.length} terms (${salientTerms.length > 0 ? "salient terms" : "original query fallback"})`
      );
    }

    // Convert score map to final results with bonuses applied
    return this.buildFinalResults(scoreMap, limit);
  }

  /**
   * Score documents using a salient term query
   * This ensures expanded queries and stopwords don't affect ranking, only recall
   */
  private scoreWithQuery(
    query: string,
    candidateDocs: Set<string>,
    scoreMap: Map<string, ScoreAccumulator>,
    limit: number
  ): void {
    try {
      const results = this.index.search(query, { limit: limit * 3, enrich: true });

      if (!Array.isArray(results)) {
        return;
      }

      const trimmedQuery = query.trim();
      const isPhrase = trimmedQuery.includes(" ");
      const isTagQuery = trimmedQuery.startsWith("#");
      const normalizedTag = isTagQuery ? trimmedQuery.toLowerCase() : null;
      const queryWeight = isPhrase ? 1.5 : 1.0;

      const docMatchesForQuery = new Set<string>();
      for (const fieldResult of results) {
        if (!fieldResult?.result || !fieldResult?.field) {
          continue;
        }
        for (const item of fieldResult.result) {
          const id = typeof item === "string" ? item : item?.id;
          if (id && candidateDocs.has(id)) {
            docMatchesForQuery.add(id);
          }
        }
      }

      const docMatchRatio =
        docMatchesForQuery.size === 0 || candidateDocs.size === 0
          ? 0
          : docMatchesForQuery.size / candidateDocs.size;
      const rarityWeight = isTagQuery ? 1 : 1 - Math.min(0.6, docMatchRatio * 0.6);
      const weightedQueryFactor = queryWeight * rarityWeight;

      for (const fieldResult of results) {
        if (!fieldResult?.result || !fieldResult?.field) {
          continue;
        }

        const fieldName = fieldResult.field;
        const fieldWeight = this.getFieldWeight(fieldName);

        for (let idx = 0; idx < fieldResult.result.length; idx++) {
          const item = fieldResult.result[idx];
          const id = typeof item === "string" ? item : item?.id;

          if (!id || !candidateDocs.has(id)) {
            continue;
          }

          const positionScore = 1 / (idx + 1);
          let adjustedScore = positionScore * fieldWeight * weightedQueryFactor;

          const existing: ScoreAccumulator = scoreMap.get(id) ?? {
            score: 0,
            fieldMatches: new Set<string>(),
            queriesMatched: new Set<string>(),
            lexicalMatches: [],
            tagQueryMatches: new Set<string>(),
            tagFieldMatches: new Set<string>(),
          };

          const fieldMatches = new Set(existing.fieldMatches);
          fieldMatches.add(fieldName);

          const queriesMatched = new Set(existing.queriesMatched);
          queriesMatched.add(query);

          const lexicalMatches = [
            ...existing.lexicalMatches,
            {
              field: fieldName,
              query,
              weight: fieldWeight,
            },
          ];

          const tagQueryMatches = new Set(existing.tagQueryMatches);
          const tagFieldMatches = new Set(existing.tagFieldMatches);

          if (isTagQuery && normalizedTag) {
            tagQueryMatches.add(normalizedTag);
            const matchedField = fieldName === "tags" ? "metadata" : fieldName;
            tagFieldMatches.add(matchedField);
            adjustedScore *=
              fieldName === "tags"
                ? FullTextEngine.TAG_PRIMARY_FIELD_BOOST
                : FullTextEngine.TAG_SECONDARY_FIELD_BOOST;
            if (fieldName === "tags") {
              adjustedScore += FullTextEngine.TAG_METADATA_SCORE_BONUS;
            }
          }

          const updated: ScoreAccumulator = {
            score: existing.score + adjustedScore,
            fieldMatches,
            queriesMatched,
            lexicalMatches,
            tagQueryMatches,
            tagFieldMatches,
          };

          scoreMap.set(id, updated);
        }
      }
    } catch (error) {
      logInfo(`FullText: Scoring failed for query "${query}": ${error}`);
    }
  }

  /**
   * Build final results with bonuses applied
   */
  private buildFinalResults(scoreMap: Map<string, any>, limit: number): NoteIdRank[] {
    const finalResults: NoteIdRank[] = [];

    for (const [id, data] of scoreMap.entries()) {
      // Calculate bonuses
      const multiFieldBonus = 1 + (data.fieldMatches.size - 1) * 0.2;
      const coverageBonus = 1 + Math.max(0, data.queriesMatched.size - 1) * 0.1;
      const tagBonus = this.calculateTagBonus(data.tagQueryMatches, data.tagFieldMatches);
      let finalScore = data.score * multiFieldBonus * coverageBonus * tagBonus;

      // Apply phrase-in-path bonus
      finalScore = this.applyPhraseInPathBonus(id, data.queriesMatched, finalScore);

      const explanation: SearchExplanation = {
        lexicalMatches: data.lexicalMatches,
        baseScore: data.score,
        finalScore,
      };

      finalResults.push({
        id,
        score: finalScore,
        engine: "fulltext",
        explanation,
      });
    }

    // Sort and return top results
    finalResults.sort((a, b) => b.score - a.score);
    return finalResults.slice(0, limit);
  }

  /**
   * Computes a final score multiplier when tag queries are matched.
   * Rewards documents that satisfy multiple tag queries and surface metadata tag hits preferentially.
   *
   * @param tagQueryMatches - Set of matched tag queries (lowercase, hash-prefixed)
   * @param tagFieldMatches - Fields that satisfied the tag query (metadata vs. content/path)
   * @returns Multiplicative boost applied to the final score (>= 1)
   */
  private calculateTagBonus(tagQueryMatches?: Set<string>, tagFieldMatches?: Set<string>): number {
    if (!tagQueryMatches || tagQueryMatches.size === 0) {
      return 1;
    }

    const baseBoost = 1 + tagQueryMatches.size * FullTextEngine.TAG_BASE_MATCH_BONUS;

    const diversityCount = tagFieldMatches ? tagFieldMatches.size : 0;
    const diversityBoost =
      diversityCount > 1 ? 1 + (diversityCount - 1) * FullTextEngine.TAG_DIVERSITY_BONUS : 1;

    const metadataBoost = tagFieldMatches?.has("metadata")
      ? FullTextEngine.TAG_METADATA_MATCH_BOOST
      : 1;

    return baseBoost * diversityBoost * metadataBoost;
  }

  /**
   * Apply bonus if phrase query matches in path
   */
  private applyPhraseInPathBonus(id: string, queriesMatched: Set<string>, score: number): number {
    const pathIndexString = id.replace(/\.md$/, "").split("/").join(" ").toLowerCase();

    for (const q of queriesMatched) {
      if (q.includes(" ")) {
        const ql = q.toLowerCase();
        if (pathIndexString.includes(ql)) {
          return score * 1.5;
        }
      }
    }

    return score;
  }

  /**
   * Get field weight for scoring
   */
  private getFieldWeight(fieldName: string): number {
    return (
      FullTextEngine.FIELD_WEIGHTS[fieldName as keyof typeof FullTextEngine.FIELD_WEIGHTS] || 1
    );
  }

  /**
   * Clear the ephemeral index and reset memory tracking
   */
  clear(): void {
    try {
      // Simple: destroy index if it exists
      if (this.index) {
        try {
          // Ultra-defensive cleanup: handle all possible index states
          const indexValue = this.index;

          if (indexValue != null && typeof indexValue === "object") {
            try {
              // Check for methods in prototype chain (not just own properties)
              if ("destroy" in indexValue && typeof indexValue.destroy === "function") {
                indexValue.destroy();
              } else if ("clear" in indexValue && typeof indexValue.clear === "function") {
                indexValue.clear();
              }
            } catch (methodError) {
              // Even method calls can fail, so handle that too
              logWarn(`FullTextEngine: Index method call error: ${methodError}`);
            }
          }
        } catch (error) {
          // Log index cleanup error but continue with state reset
          logWarn(`FullTextEngine: Index cleanup error (type: ${typeof this.index}): ${error}`);
        }
        this.index = null;
      }
      // Clear collections
      this.indexedChunks.clear();
      this.memoryManager.reset();
      logInfo("FullTextEngine: Cleanup completed successfully");
    } catch (error) {
      // Log but don't fail - cleanup is best effort
      logWarn(`FullTextEngine: Cleanup error: ${error}`);
    }
  }

  /**
   * Get statistics about the current index
   */
  getStats(): {
    documentsIndexed: number;
    memoryUsed: number;
    memoryPercent: number;
  } {
    return {
      documentsIndexed: this.indexedChunks.size,
      memoryUsed: this.memoryManager.getBytesUsed(),
      memoryPercent: this.memoryManager.getUsagePercent(),
    };
  }
}
