import { BrevilabsClient } from "@/LLMProviders/brevilabsClient";
import { extractNoteTitles, getNoteFileFromTitle } from "@/utils";
import VectorDBManager from "@/vectorDBManager";
import { BaseCallbackConfig } from "@langchain/core/callbacks/manager";
import { Document } from "@langchain/core/documents";
import { Embeddings } from "@langchain/core/embeddings";
import { BaseLanguageModel } from "@langchain/core/language_models/base";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { BaseRetriever } from "@langchain/core/retrievers";
import { Orama, search } from "@orama/orama";
import { Vault } from "obsidian";
import { get_encoding, type Tiktoken } from "@dqbd/tiktoken";

export interface HybridRetrieverOptions {
  minSimilarityScore: number;
  maxK: number;
  salientTerms: string[];
  timeRange?: { startDate: string; endDate: string }; // ISO 8601 format in local timezone
  textWeight?: number;
  returnAll?: boolean;
  useRerankerThreshold?: number;
  maxTokens?: number;
  rerankerTemp?: number;
  hybridSearchWeight?: number;
}

interface MessageContentText {
  type: "text";
  text: string;
}

export class HybridRetriever extends BaseRetriever {
  public lc_namespace = ["hybrid_retriever"];
  private tokenEncoder: Tiktoken | null = null;
  private llm: BaseLanguageModel;
  private queryRewritePrompt: ChatPromptTemplate;
  private embeddingsInstance: Embeddings;
  private brevilabsClient: BrevilabsClient;

  constructor(
    private db: Orama<any>,
    private vault: Vault,
    llm: BaseLanguageModel,
    embeddingsInstance: Embeddings,
    brevilabsClient: BrevilabsClient,
    private options: HybridRetrieverOptions,
    private debug?: boolean
  ) {
    super();
    this.llm = llm;
    this.embeddingsInstance = embeddingsInstance;
    this.brevilabsClient = brevilabsClient;

    this.queryRewritePrompt = ChatPromptTemplate.fromTemplate(`
Given the question below, rewrite it to create a comprehensive search query that will help find relevant information.
Consider key concepts, related terms, and any implicit context that might be helpful.
Original question: {question}
Enhanced query:`);

    if (!brevilabsClient) {
      throw new Error("BrevilabsClient is required but was not provided");
    }
  }

  private async initializeTokenEncoder(): Promise<void> {
    if (!this.tokenEncoder) {
      this.tokenEncoder = await get_encoding("cl100k_base");
    }
  }

  public async getRelevantDocuments(
    query: string,
    config?: BaseCallbackConfig
  ): Promise<Document[]> {
    const noteTitles = extractNoteTitles(query);
    const explicitChunks = await this.getExplicitChunks(noteTitles);

    let rewrittenQuery = query;
    if (config?.runName !== "no_hyde") {
      rewrittenQuery = await this.rewriteQuery(query);
    }

    const oramaChunks = await this.getOramaChunks(
      rewrittenQuery,
      this.options.salientTerms,
      this.options.textWeight
    );

    const combinedChunks = this.filterAndFormatChunks(oramaChunks, explicitChunks);

    let finalChunks = combinedChunks;
    const maxOramaScore = combinedChunks.reduce(
      (max, chunk) => Math.max(max, chunk.metadata.score ?? 0),
      0
    );

    if (this.shouldApplyReranking(maxOramaScore)) {
      finalChunks = await this.rerankChunks(query, combinedChunks);
    }

    if (this.options.maxTokens) {
      await this.initializeTokenEncoder();
      finalChunks = await this.limitTokens(finalChunks, this.options.maxTokens);
    }

    if (this.debug) {
      this.logDebugInfo(query, rewrittenQuery, explicitChunks, oramaChunks, finalChunks);
    }

    return finalChunks;
  }

  private async rewriteQuery(query: string): Promise<string> {
    try {
      const promptResult = await this.queryRewritePrompt.format({ question: query });
      const rewrittenQueryObject = await this.llm.invoke(promptResult);

      if (rewrittenQueryObject && "content" in rewrittenQueryObject) {
        const content =
          typeof rewrittenQueryObject.content === "string"
            ? rewrittenQueryObject.content
            : Array.isArray(rewrittenQueryObject.content)
              ? rewrittenQueryObject.content
                  .map((c: MessageContentText | any) =>
                    "type" in c && c.type === "text" ? c.text : ""
                  )
                  .join("")
              : "";
        return content || query;
      }
      return query;
    } catch (error) {
      console.error("Error in rewriteQuery:", error);
      return query;
    }
  }

  private async getExplicitChunks(noteTitles: string[]): Promise<Document[]> {
    const explicitChunks: Document[] = [];
    for (const noteTitle of noteTitles) {
      const noteFile = await getNoteFileFromTitle(this.vault, noteTitle);
      const hits = await VectorDBManager.getDocsByPath(this.db, noteFile?.path ?? "");
      if (hits) {
        const matchingChunks = hits.map(
          (hit: any) =>
            new Document({
              pageContent: hit.document.content,
              metadata: {
                ...hit.document.metadata,
                score: hit.score,
                path: hit.document.path,
                mtime: hit.document.mtime,
                ctime: hit.document.ctime,
                title: hit.document.title,
                id: hit.document.id,
                embeddingModel: hit.document.embeddingModel,
                tags: hit.document.tags,
                extension: hit.document.extension,
                created_at: hit.document.created_at,
                nchars: hit.document.nchars,
              },
            })
        );
        explicitChunks.push(...matchingChunks);
      }
    }
    return explicitChunks;
  }

  public async getOramaChunks(
    query: string,
    salientTerms: string[],
    textWeight?: number
  ): Promise<Document[]> {
    let queryVector: number[];
    try {
      queryVector = await this.convertQueryToVector(query);
    } catch (error) {
      console.error("Error in convertQueryToVector:", error, "\nQuery:", query);
      throw error;
    }

    const searchParams: any = {
      similarity: this.options.minSimilarityScore,
      limit: this.options.maxK,
      includeVectors: true,
    };

    if (salientTerms.length > 0) {
      const { vectorWeight, isTagOnlyQuery } = this.calculateWeights(salientTerms, textWeight);

      searchParams.mode = "hybrid";
      searchParams.term = salientTerms.join(" ");
      searchParams.vector = {
        value: queryVector,
        property: "embedding",
      };
      searchParams.hybridWeights = {
        text: isTagOnlyQuery ? 1 : (textWeight ?? 0.5),
        vector: isTagOnlyQuery ? 0 : vectorWeight,
      };
    } else {
      searchParams.mode = "vector";
      searchParams.vector = {
        value: queryVector,
        property: "embedding",
      };
    }

    if (this.options.timeRange) {
      return this.getTimeRangeResults(searchParams);
    }

    const searchResults = await search(this.db, searchParams);
    return this.convertToDocuments(searchResults.hits);
  }

  private calculateWeights(
    salientTerms: string[],
    textWeight?: number
  ): {
    vectorWeight: number;
    isTagOnlyQuery: boolean;
  } {
    const isTagOnlyQuery = salientTerms.every((term) => term.startsWith("#"));
    if (isTagOnlyQuery) {
      if (this.debug) {
        console.log("Tag only query detected, using text-only search");
      }
      return { vectorWeight: 0, isTagOnlyQuery: true };
    }

    const effectiveTextWeight = textWeight ?? 0.5;
    return {
      vectorWeight: 1 - effectiveTextWeight,
      isTagOnlyQuery: false,
    };
  }

  private async getTimeRangeResults(searchParams: any): Promise<Document[]> {
    if (!this.options.timeRange) {
      throw new Error("Time range is required but not provided");
    }

    const { startDate, endDate } = this.options.timeRange;
    const startTimestamp = new Date(startDate).getTime();
    const endTimestamp = new Date(endDate).getTime();
    const dateRange = this.generateDateRange(startDate, endDate);

    if (this.debug) {
      console.log("Date range:", dateRange[0], "to", dateRange[dateRange.length - 1]);
    }

    const dailyNoteResults = await this.getExplicitChunks(dateRange);
    const dailyNoteResultsWithContext = dailyNoteResults.map((doc) => ({
      ...doc,
      metadata: { ...doc.metadata, includeInContext: true },
    }));

    searchParams.where = {
      ctime: { between: [startTimestamp, endTimestamp] },
      mtime: { between: [startTimestamp, endTimestamp] },
    };

    const timeIntervalResults = await search(this.db, searchParams);
    const timeIntervalDocuments = this.convertToDocuments(timeIntervalResults.hits);

    return this.deduplicateResults([...dailyNoteResultsWithContext, ...timeIntervalDocuments]);
  }

  private deduplicateResults(documents: Document[]): Document[] {
    const seen = new Set<string>();
    return documents.filter((doc) => {
      const id = doc.metadata.id as string;
      if (seen.has(id)) {
        return false;
      }
      seen.add(id);
      return true;
    });
  }

  private async convertQueryToVector(query: string): Promise<number[]> {
    return await this.embeddingsInstance.embedQuery(query);
  }

  private generateDateRange(startDate: string, endDate: string): string[] {
    const dateRange: string[] = [];
    const currentDate = new Date(startDate);
    const end = new Date(endDate);

    while (currentDate <= end) {
      dateRange.push(currentDate.toISOString().split("T")[0]);
      currentDate.setDate(currentDate.getDate() + 1);
    }

    return dateRange;
  }

  private async limitTokens(docs: Document[], maxTokens: number): Promise<Document[]> {
    if (!this.tokenEncoder) {
      throw new Error("Token encoder not initialized");
    }

    let totalTokens = 0;
    const limitedDocs: Document[] = [];

    for (const doc of docs) {
      const tokens = this.tokenEncoder.encode(doc.pageContent).length;
      if (totalTokens + tokens <= maxTokens) {
        limitedDocs.push(doc);
        totalTokens += tokens;
      } else {
        break;
      }
    }

    return limitedDocs;
  }

  private shouldApplyReranking(maxScore: number): boolean {
    return !!(
      this.options.useRerankerThreshold &&
      maxScore < this.options.useRerankerThreshold &&
      maxScore > 0
    );
  }

  private async rerankChunks(query: string, chunks: Document[]): Promise<Document[]> {
    const rerankResponse = await this.brevilabsClient.rerank(
      query,
      chunks.map((doc) => doc.pageContent.slice(0, 3000))
    );

    return rerankResponse.response.data.map((item) => ({
      ...chunks[item.index],
      metadata: {
        ...chunks[item.index].metadata,
        rerank_score: item.relevance_score,
        original_score: chunks[item.index].metadata.score,
      },
    }));
  }

  private convertToDocuments(hits: any[]): Document[] {
    return hits.map(
      (hit) =>
        new Document({
          pageContent: hit.document.content,
          metadata: {
            ...hit.document.metadata,
            score: hit.score,
            path: hit.document.path,
            mtime: hit.document.mtime,
            ctime: hit.document.ctime,
            title: hit.document.title,
            id: hit.document.id,
            embeddingModel: hit.document.embeddingModel,
            tags: hit.document.tags,
            extension: hit.document.extension,
            created_at: hit.document.created_at,
            nchars: hit.document.nchars,
          },
        })
    );
  }

  private filterAndFormatChunks(oramaChunks: Document[], explicitChunks: Document[]): Document[] {
    const threshold = this.options.minSimilarityScore;
    const filteredOramaChunks = oramaChunks.filter((chunk) => chunk.metadata.score >= threshold);

    const uniqueChunks = new Set<string>();
    const combinedChunks: Document[] = [];

    for (const chunk of explicitChunks) {
      if (!uniqueChunks.has(chunk.pageContent)) {
        uniqueChunks.add(chunk.pageContent);
        combinedChunks.push({
          ...chunk,
          metadata: { ...chunk.metadata, includeInContext: true },
        });
      }
    }

    for (const chunk of filteredOramaChunks) {
      if (!uniqueChunks.has(chunk.pageContent)) {
        uniqueChunks.add(chunk.pageContent);
        combinedChunks.push({
          ...chunk,
          metadata: { ...chunk.metadata, includeInContext: true },
        });
      }
    }

    return combinedChunks;
  }

  private logDebugInfo(
    query: string,
    rewrittenQuery: string,
    explicitChunks: Document[],
    oramaChunks: Document[],
    finalChunks: Document[]
  ): void {
    console.log("=== HYBRID RETRIEVER DEBUG INFO ===");
    console.log("Original Query:", query);
    console.log("Rewritten Query:", rewrittenQuery);
    console.log("Explicit Chunks:", explicitChunks.length);
    console.log("Orama Chunks:", oramaChunks.length);
    console.log("Final Chunks:", finalChunks.length);
    console.log(
      "Top Scores:",
      finalChunks.slice(0, 3).map((c: Document) => ({
        score: c.metadata.score,
        rerank_score: c.metadata.rerank_score,
        path: c.metadata.path,
      }))
    );

    if (this.options.timeRange) {
      console.log("Time Range:", {
        start: this.options.timeRange.startDate,
        end: this.options.timeRange.endDate,
      });
    }

    if (this.options.salientTerms.length > 0) {
      console.log("Salient Terms:", this.options.salientTerms);
    }

    console.log("Search Parameters:", {
      minSimilarityScore: this.options.minSimilarityScore,
      maxK: this.options.maxK,
      textWeight: this.options.textWeight,
      useRerankerThreshold: this.options.useRerankerThreshold,
      maxTokens: this.options.maxTokens,
    });
  }

  // Cleanup method for tokenizer
  async cleanup(): Promise<void> {
    if (this.tokenEncoder) {
      this.tokenEncoder.free();
      this.tokenEncoder = null;
    }
  }
}
