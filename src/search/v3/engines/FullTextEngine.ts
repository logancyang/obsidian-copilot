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
          { field: "headings", tokenize: this.tokenizeMixed.bind(this), weight: 2 },
          { field: "tags", tokenize: this.tokenizeMixed.bind(this), weight: 2 },
          { field: "links", tokenize: this.tokenizeMixed.bind(this), weight: 2 }, // Links have same weight as tags
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

            this.index.add({
              id: doc.id,
              title: doc.title,
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
    const scoreMap = new Map<string, number>();

    // Process each query
    for (const query of queries) {
      try {
        const results = this.index.search(query, { limit, enrich: true });

        // Process results directly (inlined for simplicity)
        if (Array.isArray(results)) {
          for (const fieldResult of results) {
            if (!fieldResult?.result) continue;

            for (let idx = 0; idx < fieldResult.result.length; idx++) {
              const item = fieldResult.result[idx];
              const id = typeof item === "string" ? item : item?.id;
              if (id) {
                const score = 1 / (idx + 1);
                scoreMap.set(id, Math.max(scoreMap.get(id) || 0, score));
              }
            }
          }
        }
      } catch (error) {
        logInfo(`FullText: Search failed for "${query}": ${error}`);
      }
    }

    // Convert to sorted array
    return Array.from(scoreMap.entries())
      .map(([id, score]) => ({ id, score, engine: "fulltext" }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
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
