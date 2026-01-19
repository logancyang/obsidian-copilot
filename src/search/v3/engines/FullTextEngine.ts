import { logInfo, logWarn } from "@/logger";
import { CHUNK_SIZE } from "@/constants";
import MiniSearch, { SearchResult } from "minisearch";
import { App, TFile, getAllTags } from "obsidian";
import { ChunkManager, getSharedChunkManager } from "../chunks";
import { NoteIdRank } from "../interfaces";
import { MemoryManager } from "../utils/MemoryManager";

/**
 * Full-text search engine using ephemeral MiniSearch index built per-query.
 * Uses BM25+ scoring for proper multi-term relevance ranking.
 */
export class FullTextEngine {
  private index: MiniSearch | null = null;
  private memoryManager: MemoryManager;
  private indexedChunks = new Set<string>();
  private chunkManager: ChunkManager;

  // Configuration constants
  private static readonly BATCH_SIZE = 10; // Chunk indexing batch size for UI yielding
  private static readonly CHUNK_MEMORY_PERCENTAGE = 0.35; // 35% of memory budget for chunks
  private static readonly MAX_ARRAY_ITEMS = 10; // Max items to process from arrays
  private static readonly MAX_EXTRACTION_DEPTH = 2; // Max recursion depth for property extraction

  // Weighted query expansion constants
  // Salient terms (from original query) dominate ranking, expanded terms provide small boost
  private static readonly SALIENT_WEIGHT = 0.9; // 90% weight for original query terms
  private static readonly EXPANDED_WEIGHT = 0.1; // 10% weight for expanded terms

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

  constructor(
    private app: App,
    chunkManager?: ChunkManager
  ) {
    this.memoryManager = new MemoryManager();
    this.chunkManager = chunkManager || getSharedChunkManager(app);
  }

  /**
   * Create a new MiniSearch index with multilingual tokenization and BM25 scoring
   */
  private createIndex(): MiniSearch {
    return new MiniSearch({
      fields: ["title", "heading", "path", "tags", "body"],
      storeFields: ["id", "notePath", "title", "heading", "chunkIndex"],
      tokenize: this.tokenizeMixed.bind(this),
      searchOptions: {
        boost: {
          title: FullTextEngine.FIELD_WEIGHTS.title,
          heading: FullTextEngine.FIELD_WEIGHTS.heading,
          path: FullTextEngine.FIELD_WEIGHTS.path,
          tags: FullTextEngine.FIELD_WEIGHTS.tags,
          body: FullTextEngine.FIELD_WEIGHTS.body,
        },
        prefix: true,
        fuzzy: false, // Disable fuzzy for CJK compatibility
        combineWith: "OR",
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
        const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        asciiSource = asciiSource.replace(new RegExp(escapedTag, "gu"), " ");
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
    await new Promise((resolve) => setTimeout(resolve, 0));
    const startTime = Date.now();
    this.index = this.createIndex();
    const createTime = Date.now() - startTime;
    logInfo(`FullTextEngine: MiniSearch index created in ${createTime}ms`);

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

      // Add chunk to index
      // Include frontmatter properties in body for searchability
      const bodyWithProps = [chunk.content, ...noteMetadata.props].join(" ");

      // MiniSearch expects string fields, so join tags array
      this.index.add({
        id: chunk.id,
        title: chunk.title,
        heading: chunk.heading,
        path: pathComponents,
        body: bodyWithProps,
        tags: noteMetadata.tags.join(" "), // MiniSearch expects strings
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
   * Search the ephemeral index using MiniSearch's native BM25+ scoring with weighted query expansion.
   *
   * Uses a two-phase scoring approach:
   * 1. Primary score from salient terms (90% weight) - reflects original query intent
   * 2. Secondary score from expanded terms (10% weight) - provides small recall boost
   *
   * @param queries - Array of query strings [original, ...expanded] (expanded queries used for secondary scoring)
   * @param limit - Maximum results to return
   * @param salientTerms - Salient terms extracted from original query (primary scoring)
   * @param originalQuery - The original user query (fallback for primary scoring)
   * @param expandedTerms - LLM-generated related terms (secondary scoring for recall boost)
   * @returns Array of NoteIdRank results sorted by weighted BM25 relevance
   */
  search(
    queries: string[],
    limit: number = 30,
    salientTerms: string[] = [],
    originalQuery?: string,
    expandedTerms: string[] = []
  ): NoteIdRank[] {
    // Return empty results if index hasn't been created yet
    if (!this.index) {
      return [];
    }

    // Build the primary scoring query from salient terms or original query
    const primaryQuery =
      salientTerms.length > 0 ? salientTerms.join(" ") : originalQuery || queries[0] || "";

    if (!primaryQuery.trim()) {
      return [];
    }

    // Build secondary scoring query from expanded terms and expanded queries
    const expandedQueries = queries.slice(1); // Skip original query
    const secondaryQueryParts = [...expandedTerms, ...expandedQueries];
    const secondaryQuery = secondaryQueryParts.join(" ").trim();

    const searchOptions = {
      boost: {
        title: FullTextEngine.FIELD_WEIGHTS.title,
        heading: FullTextEngine.FIELD_WEIGHTS.heading,
        path: FullTextEngine.FIELD_WEIGHTS.path,
        tags: FullTextEngine.FIELD_WEIGHTS.tags,
        body: FullTextEngine.FIELD_WEIGHTS.body,
      },
      prefix: true,
      fuzzy: false,
      combineWith: "OR" as const,
    };

    try {
      // Primary search with salient terms
      const primaryResults = this.index.search(primaryQuery, searchOptions);

      logInfo(
        `FullText: Primary search found ${primaryResults.length} results for "${primaryQuery.substring(0, 50)}..."`
      );

      // If no secondary query, return primary results directly
      if (!secondaryQuery) {
        return primaryResults.slice(0, limit).map((result) => ({
          id: result.id as string,
          score: result.score,
          engine: "fulltext",
          explanation: {
            lexicalMatches: this.extractLexicalMatches(result),
            baseScore: result.score,
            finalScore: result.score,
          },
        }));
      }

      // Secondary search with expanded terms for recall boost
      const secondaryResults = this.index.search(secondaryQuery, searchOptions);

      logInfo(
        `FullText: Secondary search found ${secondaryResults.length} results for expanded terms`
      );

      // Combine scores with weighted combination
      const combined = this.combineWeightedScores(primaryResults, secondaryResults);

      return combined.slice(0, limit);
    } catch (error) {
      logWarn(`FullText: Search failed for "${primaryQuery}": ${error}`);
      return [];
    }
  }

  /**
   * Combine primary and secondary search results with weighted scoring.
   * Primary results (salient terms) get 90% weight, secondary (expanded) get 10%.
   *
   * @param primaryResults - Results from salient term search
   * @param secondaryResults - Results from expanded term search
   * @returns Combined and sorted NoteIdRank results
   */
  private combineWeightedScores(
    primaryResults: SearchResult[],
    secondaryResults: SearchResult[]
  ): NoteIdRank[] {
    // Build a map of secondary scores for quick lookup
    const secondaryScoreMap = new Map<string, { score: number; result: SearchResult }>();
    for (const result of secondaryResults) {
      secondaryScoreMap.set(result.id as string, { score: result.score, result });
    }

    // Track all seen IDs to include secondary-only results
    const seenIds = new Set<string>();
    const combined: NoteIdRank[] = [];

    // Process primary results with weighted combination
    for (const primary of primaryResults) {
      const id = primary.id as string;
      seenIds.add(id);

      const secondary = secondaryScoreMap.get(id);
      const primaryScore = primary.score * FullTextEngine.SALIENT_WEIGHT;
      const secondaryScore = secondary ? secondary.score * FullTextEngine.EXPANDED_WEIGHT : 0;
      const combinedScore = primaryScore + secondaryScore;

      combined.push({
        id,
        score: combinedScore,
        engine: "fulltext",
        explanation: {
          lexicalMatches: this.extractLexicalMatches(primary),
          baseScore: primary.score,
          finalScore: combinedScore,
          expandedBoost: secondaryScore > 0 ? secondaryScore : undefined,
        },
      });
    }

    // Add secondary-only results (found via expansion but not salient terms)
    // These get only the 10% expanded weight
    for (const [id, { score, result }] of secondaryScoreMap) {
      if (!seenIds.has(id)) {
        const secondaryScore = score * FullTextEngine.EXPANDED_WEIGHT;
        combined.push({
          id,
          score: secondaryScore,
          engine: "fulltext",
          explanation: {
            lexicalMatches: this.extractLexicalMatches(result),
            baseScore: 0, // No primary match
            finalScore: secondaryScore,
            expandedBoost: secondaryScore,
          },
        });
      }
    }

    // Sort by combined score descending
    combined.sort((a, b) => b.score - a.score);

    return combined;
  }

  /**
   * Extract lexical match information from MiniSearch result for explanation
   */
  private extractLexicalMatches(
    result: SearchResult
  ): { field: string; query: string; weight: number }[] {
    const matches: { field: string; query: string; weight: number }[] = [];

    if (result.match) {
      for (const [field, terms] of Object.entries(result.match)) {
        for (const term of terms) {
          matches.push({
            field,
            query: term,
            weight: this.getFieldWeight(field),
          });
        }
      }
    }

    return matches;
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
      // MiniSearch doesn't have explicit cleanup methods
      // Just nullify the reference and let GC handle it
      this.index = null;
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
