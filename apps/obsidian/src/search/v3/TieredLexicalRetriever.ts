import { logInfo, logWarn } from "@/logger";
import { getSettings } from "@/settings/model";
import { extractNoteFiles } from "@/utils";
import { BaseCallbackConfig } from "@langchain/core/callbacks/manager";
import { Document } from "@langchain/core/documents";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { BaseRetriever } from "@langchain/core/retrievers";
import { App, TFile } from "obsidian";
import { ChunkManager, getSharedChunkManager } from "./chunks";
import { SearchCore } from "./SearchCore";
import { ExpandedQuery } from "./QueryExpander";
let getChatModelManagerSingleton: (() => { getChatModel: () => BaseChatModel }) | null = null;
async function safeGetChatModel(): Promise<BaseChatModel | null> {
  try {
    if (!getChatModelManagerSingleton) {
      const mod = await import("@/LLMProviders/chatModelManager");
      getChatModelManagerSingleton = () => mod.default.getInstance();
    }
    const chatModelManager = getChatModelManagerSingleton();
    return chatModelManager.getChatModel();
  } catch {
    return null;
  }
}

export class TieredLexicalRetriever extends BaseRetriever {
  public lc_namespace = ["tiered_lexical_retriever"];
  private searchCore: SearchCore;
  private chunkManager: ChunkManager;
  private lastQueryExpansion: ExpandedQuery | null = null;

  constructor(
    private app: App,
    private options: {
      minSimilarityScore?: number;
      maxK: number;
      salientTerms: string[];
      textWeight?: number;
      returnAll?: boolean;
      useRerankerThreshold?: number;
      preExpandedQuery?: ExpandedQuery;
    }
  ) {
    super();
    this.searchCore = new SearchCore(app, safeGetChatModel);
    this.chunkManager = getSharedChunkManager(app);
  }

  getLastQueryExpansion(): ExpandedQuery | null {
    return this.lastQueryExpansion;
  }

  public async getRelevantDocuments(
    query: string,
    config?: BaseCallbackConfig
  ): Promise<Document[]> {
    try {
      const noteFiles = extractNoteFiles(query, this.app.vault);
      const noteTitles = noteFiles.map((file) => file.basename);

      const enhancedSalientTerms = [...new Set([...this.options.salientTerms, ...noteTitles])];

      if (getSettings().debug) {
        logInfo("TieredLexicalRetriever: Starting search", {
          query,
          salientTerms: enhancedSalientTerms,
          maxK: this.options.maxK,
        });
      }

      const settings = getSettings();
      const retrieveResult = await this.searchCore.retrieve(query, {
        maxResults: this.options.maxK,
        salientTerms: enhancedSalientTerms,
        enableLexicalBoosts: settings.enableLexicalBoosts,
        preExpandedQuery: this.options.preExpandedQuery,
      });
      const searchResults = retrieveResult.results;
      this.lastQueryExpansion = retrieveResult.queryExpansion;

      const searchDocuments = await this.convertToDocuments(searchResults);

      const sortedDocuments = this.sortResults(searchDocuments);

      if (getSettings().debug) {
        logInfo("TieredLexicalRetriever: Search complete", {
          totalResults: sortedDocuments.length,
          searchResults: searchResults.length,
        });
      }

      return sortedDocuments;
    } catch (error) {
      logWarn("TieredLexicalRetriever: Error during search", error);
      return [];
    }
  }

  private async convertToDocuments(
    searchResults: Array<{ id: string; score: number; engine?: string; explanation?: unknown }>
  ): Promise<Document[]> {
    const documents: Document[] = [];

    for (const result of searchResults) {
      try {
        const isChunkId = result.id.includes("#");

        if (isChunkId) {
          const [notePath] = result.id.split("#");
          const file = this.app.vault.getAbstractFileByPath(notePath);
          if (!file || !(file instanceof TFile)) continue;

          let chunkContent = "";
          const cm = this.chunkManager as unknown as {
            getChunkText?: (id: string) => Promise<string>;
            getChunkTextSync?: (id: string) => string | undefined;
          };
          if (typeof cm.getChunkText === "function") {
            chunkContent = await cm.getChunkText(result.id);
          } else if (typeof cm.getChunkTextSync === "function") {
            chunkContent = cm.getChunkTextSync(result.id) || "";
          }
          if (!chunkContent) continue;

          const cache = this.app.metadataCache.getFileCache(file);

          documents.push(
            new Document({
              pageContent: chunkContent,
              metadata: {
                path: notePath,
                chunkId: result.id,
                title: file.basename,
                mtime: file.stat.mtime,
                ctime: file.stat.ctime,
                tags: cache?.tags?.map((t) => t.tag) || [],
                score: result.score,
                rerank_score: result.score,
                engine: result.engine || "chunk-v3",
                includeInContext: result.score > (this.options.minSimilarityScore || 0.1),
                explanation: result.explanation,
                isChunk: true,
              },
            })
          );
        } else {
          const file = this.app.vault.getAbstractFileByPath(result.id);
          if (!file || !(file instanceof TFile)) continue;

          const content = await this.app.vault.cachedRead(file);
          if (!content) continue;

          const cache = this.app.metadataCache.getFileCache(file);

          documents.push(
            new Document({
              pageContent: content,
              metadata: {
                path: result.id,
                title: file.basename,
                mtime: file.stat.mtime,
                ctime: file.stat.ctime,
                tags: cache?.tags?.map((t) => t.tag) || [],
                score: result.score,
                rerank_score: result.score,
                engine: result.engine || "v3",
                includeInContext: result.score > (this.options.minSimilarityScore || 0.1),
                explanation: result.explanation,
                isChunk: false,
              },
            })
          );
        }
      } catch (error) {
        logWarn(`TieredLexicalRetriever: Failed to convert result ${result.id}`, error);
      }
    }

    logInfo(`TieredLexicalRetriever: Converted ${documents.length} results to Documents`);
    return documents;
  }

  private sortResults(documents: Document[]): Document[] {
    return documents.sort((a, b) => {
      const scoreA = a.metadata.score || 0;
      const scoreB = b.metadata.score || 0;

      const scoreDiff = scoreB - scoreA;
      if (Math.abs(scoreDiff) > 0.01) {
        return scoreDiff;
      }

      if (a.metadata.isChunk && b.metadata.isChunk && a.metadata.path === b.metadata.path) {
        const aChunkIndex = parseInt(
          ((a.metadata.chunkId as string | undefined)?.split("#")[1] as string) || "0"
        );
        const bChunkIndex = parseInt(
          ((b.metadata.chunkId as string | undefined)?.split("#")[1] as string) || "0"
        );
        return aChunkIndex - bChunkIndex;
      }

      return scoreDiff;
    });
  }
}
