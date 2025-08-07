import FlexSearch from "flexsearch";
import { App, TFile, getAllTags } from "obsidian";
import { NoteDoc, NoteIdRank } from "../interfaces";
import { MemoryManager } from "../utils/MemoryManager";
import { logInfo } from "@/logger";

/**
 * Full-text search engine using ephemeral FlexSearch index built per-query
 */
export class FullTextEngine {
  private index: any; // FlexSearch.Document
  private memoryManager: MemoryManager;
  private indexedDocs = new Set<string>();

  constructor(private app: App) {
    this.memoryManager = new MemoryManager();
    this.index = this.createIndex();
  }

  /**
   * Create a new FlexSearch index with multilingual tokenization
   */
  private createIndex(): any {
    const Document = (FlexSearch as any).Document;
    return new Document({
      encode: false,
      tokenize: this.tokenizeMixed.bind(this),
      cache: false,
      document: {
        id: "id",
        index: [
          { field: "title", tokenize: this.tokenizeMixed.bind(this), weight: 3 },
          { field: "path", tokenize: this.tokenizeMixed.bind(this), weight: 2.5 }, // Path components are highly relevant
          { field: "headings", tokenize: this.tokenizeMixed.bind(this), weight: 2 },
          { field: "tags", tokenize: this.tokenizeMixed.bind(this), weight: 2 },
          { field: "links", tokenize: this.tokenizeMixed.bind(this), weight: 2 },
          { field: "body", tokenize: this.tokenizeMixed.bind(this), weight: 1 },
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

            this.index.add({
              id: doc.id,
              title: doc.title,
              path: pathComponents, // Index folder and file names
              headings: doc.headings.join(" "),
              tags: doc.tags.join(" "),
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
      const content = await this.app.vault.cachedRead(file);

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
   * Search the ephemeral index with multiple query variants
   * @param queries - Array of query strings
   * @param limit - Maximum results per query
   * @returns Array of NoteIdRank results
   */
  search(queries: string[], limit: number = 30): NoteIdRank[] {
    const scoreMap = new Map<string, { score: number; fieldMatches: Set<string> }>();

    // Only log if we have many queries or debug mode
    if (queries.length > 5) {
      logInfo(`FullText: Searching with ${queries.length} queries`);
    }

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

            for (let idx = 0; idx < fieldResult.result.length; idx++) {
              const item = fieldResult.result[idx];
              const id = typeof item === "string" ? item : item?.id;
              if (id) {
                queryMatchCount++;
                // Calculate position-based score with field weighting
                const positionScore = 1 / (idx + 1);
                const fieldScore = positionScore * fieldWeight;

                const existing = scoreMap.get(id) || { score: 0, fieldMatches: new Set() };
                // Accumulate scores from different queries (don't use Math.max)
                // This way, documents matching multiple query terms get higher scores
                existing.score += fieldScore;
                existing.fieldMatches.add(fieldName);
                scoreMap.set(id, existing);
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
    const finalResults: NoteIdRank[] = [];
    for (const [id, data] of scoreMap.entries()) {
      // Boost score if matched in multiple fields
      const multiFieldBonus = 1 + (data.fieldMatches.size - 1) * 0.2;
      const finalScore = data.score * multiFieldBonus;
      finalResults.push({ id, score: finalScore, engine: "fulltext" });
    }

    // Apply folder-based boosting before sorting
    this.applyFolderBoost(finalResults);

    // Sort again after boosting and return top results
    finalResults.sort((a, b) => b.score - a.score);
    return finalResults.slice(0, limit);
  }

  /**
   * Apply folder-based boosting to improve ranking of related notes.
   * Notes in the same folder get a boost when multiple notes from that folder are found.
   */
  private applyFolderBoost(results: NoteIdRank[]): void {
    // Count notes per folder
    const folderCounts = new Map<string, number>();

    for (const result of results) {
      const lastSlash = result.id.lastIndexOf("/");
      if (lastSlash > 0) {
        const folder = result.id.substring(0, lastSlash);
        folderCounts.set(folder, (folderCounts.get(folder) || 0) + 1);
      }
    }

    // Log folder boost summary
    const foldersWithMultiple = Array.from(folderCounts.entries()).filter(([, count]) => count > 1);
    if (foldersWithMultiple.length > 0) {
      logInfo(`FullText: Boosting ${foldersWithMultiple.length} folders with multiple matches`);
      // Log top folders
      foldersWithMultiple.slice(0, 3).forEach(([folder, count]) => {
        const boostFactor = 1 + Math.log2(count + 1);
        logInfo(`  ${folder}: ${count} docs (${boostFactor.toFixed(2)}x boost)`);
      });
    }

    // Apply boost to notes in folders with multiple matches
    for (const result of results) {
      const lastSlash = result.id.lastIndexOf("/");
      if (lastSlash > 0) {
        const folder = result.id.substring(0, lastSlash);
        const count = folderCounts.get(folder) || 1;

        // Boost score based on folder prevalence (more notes in folder = higher boost)
        if (count > 1) {
          // Use a more moderate boost to avoid overflow
          // Logarithmic boost: grows slower than exponential
          const boostFactor = 1 + Math.log2(count + 1); // More moderate: ~2x for 3 docs, ~2.3x for 7 docs
          result.score = result.score * boostFactor;
        }
      }
    }
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
