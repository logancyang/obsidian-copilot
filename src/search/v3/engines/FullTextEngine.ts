import { logInfo } from "@/logger";
import FlexSearch from "flexsearch";
import { App, TFile, getAllTags } from "obsidian";
import { NoteDoc, NoteIdRank, SearchExplanation } from "../interfaces";
import { MemoryManager } from "../utils/MemoryManager";
import { VaultPathValidator } from "../utils/VaultPathValidator";

/**
 * Full-text search engine using ephemeral FlexSearch index built per-query
 */
export class FullTextEngine {
  private index: any; // FlexSearch.Document
  private memoryManager: MemoryManager;
  private indexedDocs = new Set<string>();

  // Security: Maximum content size to prevent memory exhaustion (10MB)
  private static readonly MAX_CONTENT_SIZE = 10 * 1024 * 1024;

  constructor(private app: App) {
    this.memoryManager = new MemoryManager();
    this.index = this.createIndex();
  }

  /**
   * Create a new FlexSearch index with multilingual tokenization
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
          { field: "title", tokenize: tokenizer, weight: 3 },
          { field: "path", tokenize: tokenizer, weight: 2.5 }, // Path components are highly relevant
          { field: "headings", tokenize: tokenizer, weight: 2 },
          { field: "tags", tokenize: tokenizer, weight: 2 },
          { field: "props", tokenize: tokenizer, weight: 2 }, // Frontmatter property values
          { field: "links", tokenize: tokenizer, weight: 2 },
          { field: "body", tokenize: tokenizer, weight: 1 },
        ],
        store: false, // Don't store docs to save memory
      },
    });
  }

  /**
   * Hybrid tokenizer for ASCII words + CJK bigrams
   * @param str - String to tokenize
   * @returns Array of tokens
   */
  private tokenizeMixed(str: string): string[] {
    if (!str) return [];

    const tokens: string[] = [];

    // ASCII words (including alphanumeric and underscores)
    const asciiWords = str.toLowerCase().match(/[a-z0-9_]+/g) || [];
    tokens.push(...asciiWords);

    // CJK pattern for Chinese, Japanese, Korean characters
    const cjkPattern = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]+/g;
    const cjkMatches = str.match(cjkPattern) || [];

    // Generate bigrams for CJK text
    for (const match of cjkMatches) {
      // Add single character for length 1
      if (match.length === 1) {
        tokens.push(match);
      }
      // Generate bigrams
      for (let i = 0; i < match.length - 1; i++) {
        tokens.push(match.slice(i, i + 2));
      }
    }

    return tokens;
  }

  /**
   * Build ephemeral index from candidate note paths
   * @param candidatePaths - Array of note paths to index
   * @returns Number of documents indexed
   */
  async buildFromCandidates(candidatePaths: string[]): Promise<number> {
    this.clear();

    let indexed = 0;
    const limitedCandidates = candidatePaths.slice(0, this.memoryManager.getCandidateLimit());

    for (const path of limitedCandidates) {
      // Guard against path traversal or invalid inputs
      if (!VaultPathValidator.isValid(path)) {
        logInfo(`FullText: Skipping unsafe path ${path}`);
        continue;
      }
      if (!this.memoryManager.canAddContent(1000)) {
        // Rough estimate
        logInfo(
          `FullText: Memory limit reached (${indexed} docs, ${this.memoryManager.getUsagePercent()}% used)`
        );
        break;
      }

      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) {
        const doc = await this.createNoteDoc(file);
        if (doc) {
          const bodySize = MemoryManager.getByteSize(doc.body);

          if (this.memoryManager.canAddContent(bodySize)) {
            // Extract basenames from links for searchability (optimized)
            const linkBasenames = [...doc.linksOut, ...doc.linksIn]
              .map((path) => {
                const lastSlash = path.lastIndexOf("/");
                const basename = lastSlash >= 0 ? path.slice(lastSlash + 1) : path;
                return basename.endsWith(".md") ? basename.slice(0, -3) : basename;
              })
              .join(" ");

            // Extract path components for searchability
            // "Piano Lessons/Lesson 2.md" → "Piano Lessons Lesson 2"
            const pathComponents = doc.id.replace(/\.md$/, "").split("/").join(" ");

            // Extract frontmatter property values for searchability
            const propValues = this.extractPropertyValues(doc.props);

            this.index.add({
              id: doc.id,
              title: doc.title,
              path: pathComponents, // Index folder and file names
              headings: doc.headings.join(" "),
              tags: doc.tags.join(" "),
              props: propValues.join(" "), // Index frontmatter property values
              links: linkBasenames, // Index link basenames for search
              body: doc.body,
            });

            this.memoryManager.addBytes(bodySize);
            this.indexedDocs.add(doc.id);
            indexed++;
          }
        }
      }
    }

    logInfo(
      `FullText: Indexed ${indexed}/${candidatePaths.length} docs (${this.memoryManager.getUsagePercent()}% memory, ${this.memoryManager.getBytesUsed()} bytes)`
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
        this.extractPrimitiveValues(value, propValues, 2);
      }
    }
    return propValues;
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
      // Limit array processing to first 10 items for performance
      value.slice(0, 10).forEach((item) => {
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
   * Scoring happens in two stages:
   * 1. Score Accumulation: Documents matching multiple queries get additive scores
   * 2. Multi-field Bonus: Documents matching in multiple fields (title, tags, etc.) get boosted
   *
   * @param queries - Array of query strings
   * @param limit - Maximum results per query
   * @returns Array of NoteIdRank results
   */
  search(queries: string[], limit: number = 30, lowWeightTerms: string[] = []): NoteIdRank[] {
    const scoreMap = new Map<
      string,
      {
        score: number;
        fieldMatches: Set<string>;
        queriesMatched: Set<string>;
        lexicalMatches: { field: string; query: string; weight: number }[];
      }
    >();

    // Only log if we have many queries or debug mode
    if (queries.length > 5) {
      logInfo(`FullText: Searching with ${queries.length} queries`);
    }

    // Build a lookup for low-weight terms
    const lowWeightLookup = new Set(lowWeightTerms.map((t) => t.toLowerCase()));

    // Process each query
    for (const query of queries) {
      try {
        const results = this.index.search(query, { limit: limit * 2, enrich: true });

        // Process results with improved scoring
        if (Array.isArray(results)) {
          let queryMatchCount = 0;
          for (const fieldResult of results) {
            if (!fieldResult?.result || !fieldResult?.field) continue;

            const fieldName = fieldResult.field;
            const fieldWeight = this.getFieldWeight(fieldName);
            const isPhrase = query.trim().includes(" ");
            const baseQueryWeight = isPhrase ? 1.2 : 0.85;
            // Downweight LLM-provided salient terms relative to original queries
            const isLowWeightTerm = lowWeightLookup.has(query.toLowerCase());
            const lowWeightFactor = isLowWeightTerm ? 0.6 : 1.0;

            // Noise reduction for property values: heavy downweight for boolean/numeric tokens
            const isBooleanLiteral = /^(true|false|yes|no|on|off)$/i.test(query.trim());
            const isNumericLiteral = /^\d+(?:[.,]\d+)?$/.test(query.trim());
            const propNoiseFactor =
              fieldName === "props" && (isBooleanLiteral || isNumericLiteral) ? 0.1 : 1.0;

            const queryWeight = baseQueryWeight * lowWeightFactor * propNoiseFactor;

            for (let idx = 0; idx < fieldResult.result.length; idx++) {
              const item = fieldResult.result[idx];
              const id = typeof item === "string" ? item : item?.id;
              if (id) {
                queryMatchCount++;
                // Calculate position-based score with field weighting
                const positionScore = 1 / (idx + 1);
                const fieldScore = positionScore * fieldWeight * queryWeight;

                const existing = scoreMap.get(id) || {
                  score: 0,
                  fieldMatches: new Set<string>(),
                  queriesMatched: new Set<string>(),
                  lexicalMatches: [],
                };
                // Accumulate scores from different queries (don't use Math.max)
                // This way, documents matching multiple query terms get higher scores

                // Track lexical match for explanation
                existing.lexicalMatches.push({
                  field: fieldName,
                  query: query,
                  weight: fieldWeight,
                });

                const updated = {
                  score: existing.score + fieldScore,
                  fieldMatches: new Set(existing.fieldMatches).add(fieldName),
                  queriesMatched: new Set(existing.queriesMatched).add(query),
                  lexicalMatches: existing.lexicalMatches,
                };
                scoreMap.set(id, updated);
              }
            }
          }
          // Only log significant match counts
          if (queryMatchCount > 10) {
            logInfo(`  Query "${query}": ${queryMatchCount} matches found`);
          }
        }
      } catch (error) {
        logInfo(`FullText: Search failed for "${query}": ${error}`);
      }
    }

    // Apply bonus for multi-field matches
    // Example: Query "OAuth NextJS"
    // - Doc A matches "OAuth" in title only → multiFieldBonus = 1.0 (no bonus)
    // - Doc B matches "OAuth" in title AND "NextJS" in tags → multiFieldBonus = 1.2 (20% boost)
    // - Doc C matches in title, tags, AND body → multiFieldBonus = 1.4 (40% boost)
    const finalResults: NoteIdRank[] = [];
    for (const [id, data] of scoreMap.entries()) {
      // Boost score if matched in multiple fields
      // Each additional field beyond the first adds 20% to the score
      const multiFieldBonus = 1 + (data.fieldMatches.size - 1) * 0.2;
      const coverageBonus = 1 + Math.max(0, data.queriesMatched.size - 1) * 0.1;
      let finalScore = data.score * multiFieldBonus * coverageBonus;

      // Cheap phrase-in-path/title bonus
      const pathIndexString = id.replace(/\.md$/, "").split("/").join(" ").toLowerCase();
      for (const q of data.queriesMatched) {
        if (q.includes(" ")) {
          const ql = q.toLowerCase();
          if (pathIndexString.includes(ql)) {
            finalScore *= 1.5;
            break;
          }
        }
      }

      const explanation: SearchExplanation = {
        lexicalMatches: data.lexicalMatches,
        baseScore: finalScore,
        finalScore: finalScore,
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
   * Get field weight for scoring
   */
  private getFieldWeight(fieldName: string): number {
    const weights: Record<string, number> = {
      title: 3,
      path: 2.5,
      headings: 2,
      tags: 2,
      props: 2,
      links: 2,
      body: 1,
    };
    return weights[fieldName] || 1;
  }

  /**
   * Clear the ephemeral index and reset memory tracking
   */
  clear(): void {
    this.index = this.createIndex();
    this.indexedDocs.clear();
    this.memoryManager.reset();
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
      documentsIndexed: this.indexedDocs.size,
      memoryUsed: this.memoryManager.getBytesUsed(),
      memoryPercent: this.memoryManager.getUsagePercent(),
    };
  }
}
