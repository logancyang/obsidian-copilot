import { logInfo, logWarn } from "@/logger";
import { getSettings } from "@/settings/model";
import {
  getMatchingPatterns,
  isInternalExcludedFile,
  isSystemExcludedPath,
  shouldIndexFile,
} from "@/search/searchUtils";
import { extractNoteFiles } from "@/utils";
import { Document } from "@langchain/core/documents";
import { App, TFile, getAllTags } from "obsidian";
import { RETURN_ALL_LIMIT } from "./SearchCore";

export interface FilterRetrieverOptions {
  salientTerms: string[];
  timeRange?: { startTime: number; endTime: number };
  maxK: number;
  returnAll?: boolean;
}

export class FilterRetriever {
  constructor(
    private app: App,
    private options: FilterRetrieverOptions
  ) {}

  async getRelevantDocuments(query: string): Promise<Document[]> {
    if (this.options.timeRange) {
      return this.getTimeRangeDocuments(query);
    }

    const noteFiles = extractNoteFiles(query, this.app.vault);
    const titleMatches = await this.getTitleMatches(noteFiles);
    const tagMatches = await this.getTagMatches(this.resolveTagTerms(query));
    return this.combineGuaranteedMatches(titleMatches, tagMatches);
  }

  hasTimeRange(): boolean {
    return this.options.timeRange !== undefined;
  }

  private async getTimeRangeDocuments(_query: string): Promise<Document[]> {
    if (!this.options.timeRange) {
      return [];
    }

    const { startTime, endTime } = this.options.timeRange;

    const dailyNoteTitles = this.generateDailyNoteDateRange(startTime, endTime);

    if (getSettings().debug) {
      logInfo("FilterRetriever: Generated daily note titles", {
        startTime: new Date(startTime).toISOString(),
        endTime: new Date(endTime).toISOString(),
        titlesCount: dailyNoteTitles.length,
        firstTitle: dailyNoteTitles[0],
        lastTitle: dailyNoteTitles[dailyNoteTitles.length - 1],
      });
    }

    const { inclusions, exclusions } = getMatchingPatterns();

    const dailyNoteQuery = dailyNoteTitles.join(", ");
    const dailyNoteFiles = extractNoteFiles(dailyNoteQuery, this.app.vault).filter((f) =>
      shouldIndexFile(this.app, f, inclusions, exclusions)
    );

    const dailyNoteDocuments = await this.getTitleMatches(dailyNoteFiles);

    const dailyNotesWithContext = dailyNoteDocuments.map((doc) => {
      doc.metadata.includeInContext = true;
      return doc;
    });

    const allFiles = this.app.vault
      .getMarkdownFiles()
      .filter((f) => shouldIndexFile(this.app, f, inclusions, exclusions));
    const timeFilteredDocuments: Document[] = [];

    const maxTimeFilteredDocs = this.options.returnAll
      ? RETURN_ALL_LIMIT
      : Math.min(this.options.maxK, RETURN_ALL_LIMIT);

    for (const file of allFiles) {
      if (file.stat.mtime >= startTime && file.stat.mtime <= endTime) {
        if (dailyNoteFiles.some((f) => f.path === file.path)) {
          continue;
        }

        if (timeFilteredDocuments.length >= maxTimeFilteredDocs) {
          break;
        }

        try {
          const content = await this.app.vault.cachedRead(file);
          const cache = this.app.metadataCache.getFileCache(file);

          const daysSinceModified = (Date.now() - file.stat.mtime) / (1000 * 60 * 60 * 24);
          const recencyScore = Math.max(0.3, Math.min(1.0, 1.0 - daysSinceModified / 30));

          timeFilteredDocuments.push(
            new Document({
              pageContent: content,
              metadata: {
                path: file.path,
                title: file.basename,
                mtime: file.stat.mtime,
                ctime: file.stat.ctime,
                tags: cache?.tags?.map((t) => t.tag) || [],
                includeInContext: true,
                score: recencyScore,
                rerank_score: recencyScore,
                source: "time-filtered",
              },
            })
          );
        } catch (error) {
          logWarn(`FilterRetriever: Failed to read file ${file.path}`, error);
        }
      }
    }

    const documentMap = new Map<string, Document>();

    for (const doc of dailyNotesWithContext) {
      documentMap.set(doc.metadata.path as string, doc);
    }

    for (const doc of timeFilteredDocuments) {
      if (!documentMap.has(doc.metadata.path as string)) {
        documentMap.set(doc.metadata.path as string, {
          ...doc,
          metadata: {
            ...doc.metadata,
            includeInContext: true,
          },
        });
      }
    }

    const limit = this.options.returnAll ? RETURN_ALL_LIMIT : this.options.maxK;
    const results = Array.from(documentMap.values())
      .sort((a, b) => {
        const scoreA = a.metadata.score || 0;
        const scoreB = b.metadata.score || 0;
        return scoreB - scoreA;
      })
      .slice(0, limit);

    if (getSettings().debug) {
      logInfo("FilterRetriever: Time range search complete", {
        timeRange: this.options.timeRange,
        dailyNotesFound: dailyNoteFiles.length,
        timeFilteredDocs: timeFilteredDocuments.length,
        totalResults: results.length,
      });
    }

    return results;
  }

  private resolveTagTerms(query: string): string[] {
    const normalized = new Set<string>();

    for (const term of this.options.salientTerms ?? []) {
      if (typeof term === "string" && term.startsWith("#")) {
        normalized.add(term.toLowerCase());
      }
    }

    if (normalized.size === 0) {
      for (const tag of this.extractTagsFromQuery(query)) {
        normalized.add(tag);
      }
    }

    return Array.from(normalized);
  }

  private extractTagsFromQuery(query: string): string[] {
    if (!query) {
      return [];
    }

    let matches: RegExpMatchArray | null = null;
    try {
      matches = query.match(/#[\p{L}\p{N}_/-]+/gu);
    } catch {
      matches = query.match(/#[a-z0-9_/-]+/g);
    }

    if (!matches) {
      return [];
    }

    const normalized = new Set<string>();
    for (const raw of matches) {
      const trimmed = raw.trim();
      if (trimmed.length <= 1) {
        continue;
      }
      normalized.add(trimmed.toLowerCase());
    }

    return Array.from(normalized);
  }

  private generateDailyNoteDateRange(startTime: number, endTime: number): string[] {
    const dailyNotes: string[] = [];
    const start = new Date(startTime);
    const end = new Date(endTime);

    const maxDays = 365;
    const daysDiff = Math.ceil((endTime - startTime) / (1000 * 60 * 60 * 24));

    if (daysDiff > maxDays) {
      logWarn(
        `FilterRetriever: Date range exceeds ${maxDays} days, limiting to recent ${maxDays} days`
      );
      start.setTime(end.getTime() - maxDays * 24 * 60 * 60 * 1000);
    }

    const current = new Date(start);
    while (current <= end) {
      dailyNotes.push(`[[${current.toLocaleDateString("en-CA")}]]`);
      current.setDate(current.getDate() + 1);
    }

    return dailyNotes;
  }

  private async getTitleMatches(noteFiles: TFile[]): Promise<Document[]> {
    const chunks: Document[] = [];

    for (const file of noteFiles) {
      if (isInternalExcludedFile(file) || isSystemExcludedPath(file.path)) {
        continue;
      }
      try {
        const content = await this.app.vault.cachedRead(file);
        const cache = this.app.metadataCache.getFileCache(file);

        chunks.push(
          new Document({
            pageContent: content,
            metadata: {
              path: file.path,
              title: file.basename,
              mtime: file.stat.mtime,
              ctime: file.stat.ctime,
              tags: cache?.tags?.map((t) => t.tag) || [],
              includeInContext: true,
              score: 1.0,
              rerank_score: 1.0,
              source: "title-match",
            },
          })
        );
      } catch (error) {
        logWarn(`FilterRetriever: Failed to read title-matched file ${file.path}`, error);
      }
    }

    return chunks;
  }

  private async getTagMatches(tagTerms: string[]): Promise<Document[]> {
    if (tagTerms.length === 0) return [];

    const { inclusions, exclusions } = getMatchingPatterns();
    const allFiles = this.app.vault.getMarkdownFiles();
    const documents: Document[] = [];
    const limit = this.options.returnAll ? RETURN_ALL_LIMIT : this.options.maxK;

    for (const file of allFiles) {
      if (documents.length >= limit) break;

      if (
        !shouldIndexFile(this.app, file, inclusions, exclusions) ||
        isInternalExcludedFile(file)
      ) {
        continue;
      }

      const cache = this.app.metadataCache.getFileCache(file);
      if (!cache) continue;

      const fileTags = getAllTags(cache) ?? [];
      if (fileTags.length === 0) continue;

      const hasMatch = fileTags.some((fileTag) => {
        const normalizedFileTag = fileTag.toLowerCase();
        return tagTerms.some(
          (searchTag) =>
            normalizedFileTag === searchTag || normalizedFileTag.startsWith(searchTag + "/")
        );
      });

      if (!hasMatch) continue;

      try {
        const content = await this.app.vault.cachedRead(file);
        documents.push(
          new Document({
            pageContent: content,
            metadata: {
              path: file.path,
              title: file.basename,
              mtime: file.stat.mtime,
              ctime: file.stat.ctime,
              tags: fileTags,
              includeInContext: true,
              score: 1.0,
              rerank_score: 1.0,
              source: "tag-match",
            },
          })
        );
      } catch (error) {
        logWarn(`FilterRetriever: Failed to read tag-matched file ${file.path}`, error);
      }
    }

    return documents;
  }

  private combineGuaranteedMatches(...sets: Document[][]): Document[] {
    const seen = new Set<string>();
    const result: Document[] = [];
    for (const docs of sets) {
      for (const doc of docs) {
        const path = doc.metadata.path as string;
        if (!seen.has(path)) {
          seen.add(path);
          result.push(doc);
        }
      }
    }
    return result;
  }
}
