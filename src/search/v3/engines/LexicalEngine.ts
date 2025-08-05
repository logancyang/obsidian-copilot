import FlexSearch from "flexsearch";
import { TFile, Vault, Platform } from "obsidian";
import { Hit, RetrieverEngine } from "../interfaces";

// Define our document type for FlexSearch
interface NoteDocument {
  id: string;
  title: string;
  content: string;
}

// Type definition for FlexSearch Document instance
interface FlexSearchDocument {
  search(query: string, options?: { limit: number }): any[];
  add(document: NoteDocument): void;
  update(document: NoteDocument): void;
  remove(id: string): void;
}

export class LexicalEngine implements RetrieverEngine {
  public readonly name = "lexical";
  private index: FlexSearchDocument;

  // Configuration constants
  private static readonly CONFIG = {
    PREVIEW: {
      DESKTOP: 4 * 1024, // 4KB
      MOBILE: 2 * 1024, // 2KB
    },
    MOBILE_FILE_LIMIT: 1000,
    DEFAULT_SEARCH_LIMIT: 30,
    INDEX: {
      tokenize: "forward",
      resolution: 4,
      cache: false,
      worker: false,
      document: {
        id: "id",
        index: [
          { field: "title", tokenize: "forward" },
          { field: "content", tokenize: "forward" },
        ],
        store: false, // Don't store docs to save memory
      },
    },
  } as const;

  constructor() {
    this.index = this.createIndex();
  }

  private createIndex(): FlexSearchDocument {
    const Document = (FlexSearch as any).Document;
    return new Document(LexicalEngine.CONFIG.INDEX);
  }

  private getPreviewLength(): number {
    return Platform.isMobile
      ? LexicalEngine.CONFIG.PREVIEW.MOBILE
      : LexicalEngine.CONFIG.PREVIEW.DESKTOP;
  }

  private createDocument(file: TFile, content: string): NoteDocument {
    return {
      id: file.path,
      title: file.basename,
      content: content.slice(0, this.getPreviewLength()),
    };
  }

  async initialize(vault: Vault): Promise<void> {
    const files = vault.getMarkdownFiles();

    // Limit files on mobile
    const filesToIndex = Platform.isMobile
      ? files.slice(0, LexicalEngine.CONFIG.MOBILE_FILE_LIMIT)
      : files;

    // Index all files
    for (const file of filesToIndex) {
      await this.indexFile(file, vault);
    }

    console.log(`LexicalEngine: Indexed ${filesToIndex.length} files`);
  }

  private async indexFile(file: TFile, vault: Vault): Promise<void> {
    try {
      const content = await vault.cachedRead(file);
      const document = this.createDocument(file, content);
      this.index.add(document);
    } catch (error) {
      console.warn(`Failed to index file ${file.path}:`, error);
    }
  }

  search(queries: string[], limit: number = LexicalEngine.CONFIG.DEFAULT_SEARCH_LIMIT): Hit[] {
    const validQueries = queries.filter((q) => q?.trim());
    if (validQueries.length === 0) return [];

    const scoreMap = new Map<string, number>();

    for (const query of validQueries) {
      this.searchSingleQuery(query, limit, scoreMap);
    }

    return this.convertToHits(scoreMap, limit);
  }

  private searchSingleQuery(query: string, limit: number, scoreMap: Map<string, number>): void {
    try {
      const results = this.index.search(query, { limit });
      this.processSearchResults(results, scoreMap);
    } catch (error) {
      console.warn(`Search failed for query "${query}":`, error);
    }
  }

  private processSearchResults(results: any[], scoreMap: Map<string, number>): void {
    if (!Array.isArray(results)) return;

    results
      .filter((fieldResult) => fieldResult?.result)
      .forEach((fieldResult) => {
        const items = this.normalizeResults(fieldResult.result);
        this.updateScoreMap(items, scoreMap);
      });
  }

  private normalizeResults(result: any): string[] {
    if (Array.isArray(result)) return result;
    if (typeof result === "string") return [result];
    return [];
  }

  private updateScoreMap(items: string[], scoreMap: Map<string, number>): void {
    items.forEach((id, index) => {
      if (typeof id === "string") {
        const score = 1 / (index + 1);
        const existingScore = scoreMap.get(id) || 0;
        if (score > existingScore) {
          scoreMap.set(id, score);
        }
      }
    });
  }

  private convertToHits(scoreMap: Map<string, number>, limit: number): Hit[] {
    return Array.from(scoreMap.entries())
      .map(([noteId, score]) => ({
        noteId,
        score,
        engine: "lexical" as const,
        rank: 0, // Will be set later by RRF
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  updateFile(file: TFile, content: string): void {
    const document = this.createDocument(file, content);
    this.upsertDocument(document);
  }

  private upsertDocument(document: NoteDocument): void {
    const operations = [() => this.index.update(document), () => this.index.add(document)];

    for (const operation of operations) {
      try {
        operation();
        return;
      } catch {
        // Continue to next operation
      }
    }

    console.warn(`Failed to upsert document ${document.id}`);
  }

  removeFile(path: string): void {
    try {
      this.index.remove(path);
    } catch (error) {
      console.warn(`Failed to remove file ${path}:`, error);
    }
  }

  cleanup(): void {
    this.index = this.createIndex();
  }
}
