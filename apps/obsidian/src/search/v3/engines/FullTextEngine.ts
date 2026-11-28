import { logInfo, logWarn } from "@/logger";
import { CHUNK_SIZE } from "@/constants";
import MiniSearch, { SearchResult } from "minisearch";
import { App, TFile, getAllTags } from "obsidian";
import { ChunkManager, getSharedChunkManager } from "@/search/v3/chunks";
import { NoteIdRank } from "@/search/v3/interfaces";
import { MemoryManager } from "@/search/v3/utils/MemoryManager";

export class FullTextEngine {
  private index: MiniSearch | null = null;
  private memoryManager: MemoryManager;
  private indexedChunks = new Set<string>();
  private chunkManager: ChunkManager;

  private static readonly BATCH_SIZE = 10;
  private static readonly CHUNK_MEMORY_PERCENTAGE = 0.35;
  private static readonly MAX_ARRAY_ITEMS = 10;
  private static readonly MAX_EXTRACTION_DEPTH = 2;

  private static readonly FIELD_WEIGHTS = {
    title: 5,
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
        fuzzy: false,
        combineWith: "OR",
      },
    });
  }

  private tokenizeMixed(str: string): string[] {
    if (!str) {
      return [];
    }

    const tokens = new Set<string>();
    const lowered = str.toLowerCase();
    let asciiSource = lowered;

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

    const asciiWords = asciiSource.match(/[a-z0-9_]+/g) || [];
    asciiWords.forEach((word) => tokens.add(word));

    const cjkPattern = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]+/g;
    const cjkMatches = str.match(cjkPattern) || [];

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

  async buildFromCandidates(candidatePaths: string[]): Promise<number> {
    logInfo(`FullTextEngine: [CHUNKS] Starting with ${candidatePaths.length} candidate notes`);

    this.indexedChunks.clear();
    this.memoryManager.reset();

    await new Promise((resolve) => window.setTimeout(resolve, 0));
    const startTime = Date.now();
    this.index = this.createIndex();
    const createTime = Date.now() - startTime;
    logInfo(`FullTextEngine: MiniSearch index created in ${createTime}ms`);

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

    let indexed = 0;
    const BATCH_SIZE = FullTextEngine.BATCH_SIZE;
    const processedNotes = new Map<string, { tags: string[]; links: string[]; props: string[] }>();

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];

      const contentSize = MemoryManager.getByteSize(chunk.content);
      if (!this.memoryManager.canAddContent(contentSize)) {
        logInfo(`FullTextEngine: Memory limit reached at ${indexed} chunks`);
        break;
      }

      const pathComponents = chunk.notePath.replace(/\.md$/, "").split("/").join(" ");

      let noteMetadata = processedNotes.get(chunk.notePath);
      if (!noteMetadata) {
        const file = this.app.vault.getAbstractFileByPath(chunk.notePath);
        if (file instanceof TFile) {
          const cache = this.app.metadataCache.getFileCache(file);
          const frontmatter = cache?.frontmatter ?? {};
          const rawTags = cache ? (getAllTags(cache) ?? []) : [];
          const frontmatterTags = this.extractFrontmatterTags(frontmatter);
          const normalizedTags = this.normalizeTagList([...rawTags, ...frontmatterTags]);

          const outgoing = this.app.metadataCache.resolvedLinks[file.path] ?? {};
          const backlinks = this.app.metadataCache.getBacklinksForFile(file)?.data ?? {};
          const linksOut = Object.keys(outgoing);
          const linksIn = Object.keys(backlinks);
          const allLinks = [...linksOut, ...linksIn];

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

      const bodyWithProps = [chunk.content, ...noteMetadata.props].join(" ");

      this.index.add({
        id: chunk.id,
        title: chunk.title,
        heading: chunk.heading,
        path: pathComponents,
        body: bodyWithProps,
        tags: noteMetadata.tags.join(" "),
        notePath: chunk.notePath,
        chunkIndex: chunk.chunkIndex,
      });

      this.memoryManager.addBytes(contentSize);
      this.indexedChunks.add(chunk.id);
      indexed++;

      if (i > 0 && i % BATCH_SIZE === 0) {
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      }
    }

    logInfo(
      `FullTextEngine: [CHUNKS] Indexed ${indexed}/${chunks.length} chunks (${this.memoryManager.getUsagePercent()}% memory)`
    );
    return indexed;
  }

  private extractPropertyValues(props: Record<string, unknown> | undefined): string[] {
    const propValues: string[] = [];
    if (props && typeof props === "object") {
      for (const value of Object.values(props)) {
        this.extractPrimitiveValues(value, propValues, FullTextEngine.MAX_EXTRACTION_DEPTH);
      }
    }
    return propValues;
  }

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
      const rawValue = frontmatter[key];
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
      value.slice(0, FullTextEngine.MAX_ARRAY_ITEMS).forEach((item) => {
        if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
          const str = typeof item === "string" ? item.trim() : String(item);
          if (str) output.push(str);
        }
      });
    }
  }

  search(
    queries: string[],
    limit: number = 30,
    salientTerms: string[] = [],
    originalQuery?: string
  ): NoteIdRank[] {
    if (!this.index) {
      return [];
    }

    const searchQuery =
      salientTerms.length > 0 ? salientTerms.join(" ") : originalQuery || queries[0] || "";

    if (!searchQuery.trim()) {
      return [];
    }

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
      const results = this.index.search(searchQuery, searchOptions);

      logInfo(
        `FullText: Search found ${results.length} results for "${searchQuery.substring(0, 50)}..."`
      );

      return results.slice(0, limit).map((result) => ({
        id: result.id as string,
        score: result.score,
        engine: "fulltext",
        explanation: {
          lexicalMatches: this.extractLexicalMatches(result),
          baseScore: result.score,
          finalScore: result.score,
        },
      }));
    } catch (error) {
      logWarn(`FullText: Search failed for "${searchQuery}": ${error}`);
      return [];
    }
  }

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

  private getFieldWeight(fieldName: string): number {
    return (
      FullTextEngine.FIELD_WEIGHTS[fieldName as keyof typeof FullTextEngine.FIELD_WEIGHTS] || 1
    );
  }

  clear(): void {
    try {
      this.index = null;
      this.indexedChunks.clear();
      this.memoryManager.reset();
      logInfo("FullTextEngine: Cleanup completed successfully");
    } catch (error) {
      logWarn(`FullTextEngine: Cleanup error: ${error}`);
    }
  }
}
