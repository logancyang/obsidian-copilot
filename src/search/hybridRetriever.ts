import { CONTEXT_SCORE_THRESHOLD } from "@/constants";
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

export class HybridRetriever extends BaseRetriever {
  public lc_namespace = ["hybrid_retriever"];

  private llm: BaseLanguageModel;
  private queryRewritePrompt: ChatPromptTemplate;
  private embeddingsInstance: Embeddings;

  constructor(
    private db: Orama<any>,
    private vault: Vault,
    llm: BaseLanguageModel,
    embeddingsInstance: Embeddings,
    private options: {
      minSimilarityScore: number;
      maxK: number;
      salientTerms: string[];
      timeRange?: { startDate: string; endDate: string }; // ISO 8601 format in local timezone
      textWeight?: number;
      returnAll?: boolean;
    },
    private debug?: boolean
  ) {
    super();
    this.llm = llm;
    this.embeddingsInstance = embeddingsInstance;
    this.queryRewritePrompt = ChatPromptTemplate.fromTemplate(
      "Please write a passage to answer the question. If you don't know the answer, just make up a passage. \nQuestion: {question}\nPassage:"
    );
  }

  public async getRelevantDocuments(
    query: string,
    config?: BaseCallbackConfig
  ): Promise<Document[]> {
    // Extract note titles wrapped in [[]] from the query
    const noteTitles = extractNoteTitles(query);
    // Retrieve chunks for explicitly mentioned note titles
    const explicitChunks = await this.getExplicitChunks(noteTitles);
    let rewrittenQuery = query;
    if (config?.runName !== "no_hyde") {
      // Use config to determine if HyDE should be used
      // Generate a hypothetical answer passage
      rewrittenQuery = await this.rewriteQuery(query);
    }
    // Perform vector similarity search using ScoreThresholdRetriever
    const oramaChunks = await this.getOramaChunks(
      rewrittenQuery,
      this.options.salientTerms,
      this.options.textWeight
    );

    const combinedChunks = this.filterAndFormatChunks(oramaChunks, explicitChunks);

    if (this.debug) {
      console.log("*** HYBRID RETRIEVER DEBUG INFO: ***");

      if (config?.runName !== "no_hyde") {
        console.log("\nOriginal Query: ", query);
        console.log("\nRewritten Query: ", rewrittenQuery);
      }

      console.log(
        "\nSalient Terms: ",
        this.options.salientTerms,
        "\nNote Titles extracted: ",
        noteTitles,
        "\n\nExplicit Chunks:",
        explicitChunks,
        "\n\nOrama Chunks:",
        oramaChunks,
        "\n\nCombined Chunks:",
        combinedChunks
      );
    }

    return combinedChunks;
  }

  private async rewriteQuery(query: string): Promise<string> {
    try {
      const promptResult = await this.queryRewritePrompt.format({ question: query });
      const rewrittenQueryObject = await this.llm.invoke(promptResult);

      // Directly return the content assuming it's structured as expected
      if (rewrittenQueryObject && "content" in rewrittenQueryObject) {
        return rewrittenQueryObject.content;
      }
      console.warn("Unexpected rewrittenQuery format. Falling back to original query.");
      return query;
    } catch (error) {
      console.error("Error in rewriteQuery:", error);
      // If there's an error, return the original query
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

  // Orama does not support OR for filters, so we need to manually combine the results from the two queries
  // https://github.com/orgs/askorama/discussions/670
  public async getOramaChunks(
    query: string,
    salientTerms: string[],
    textWeight?: number
  ): Promise<Document[]> {
    let queryVector: number[];
    try {
      queryVector = await this.convertQueryToVector(query);
    } catch (error) {
      console.error(
        "Error in convertQueryToVector, please ensure your embedding model is working and has an adequate context length:",
        error,
        "\nQuery:",
        query
      );
      throw error;
    }

    let vectorWeight;
    if (!textWeight) {
      textWeight = 0.5;
    }
    vectorWeight = 1 - textWeight;

    let tagOnlyQuery = true;
    for (const term of salientTerms) {
      if (!term.startsWith("#")) {
        tagOnlyQuery = false;
        break;
      }
    }

    if (salientTerms.length > 0 && tagOnlyQuery) {
      if (this.debug) {
        console.log("Tag only query detected, setting textWeight to 1 and vectorWeight to 0.");
      }
      textWeight = 1;
      vectorWeight = 0;
    }

    const searchParams: any = {
      mode: "hybrid",
      term: salientTerms.join(" "),
      vector: {
        value: queryVector,
        property: "embedding",
      },
      similarity: this.options.minSimilarityScore,
      limit: this.options.maxK,
      includeVectors: true,
      hybridWeights: {
        text: textWeight,
        vector: vectorWeight,
      },
    };

    // Add time range filter if provided
    if (this.options.timeRange) {
      const { startDate, endDate } = this.options.timeRange;
      const startTimestamp = new Date(startDate).getTime();
      const endTimestamp = new Date(endDate).getTime();

      const dateRange = this.generateDateRange(startDate, endDate);

      // Perform the first search with title filter
      const dailyNoteResults = await this.getExplicitChunks(dateRange);

      // Set includeInContext to true for all dailyNoteResults
      const dailyNoteResultsWithContext = dailyNoteResults.map((doc) => ({
        ...doc,
        metadata: {
          ...doc.metadata,
          includeInContext: true,
        },
      }));

      // Perform a second search with time range filters
      searchParams.where = {
        ctime: { between: [startTimestamp, endTimestamp] },
        mtime: { between: [startTimestamp, endTimestamp] },
      };
      const timeIntervalResults = await search(this.db, searchParams);

      // Convert timeIntervalResults to Document objects
      const timeIntervalDocuments = timeIntervalResults.hits.map(
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

      // Combine and deduplicate results
      const combinedResults = [...dailyNoteResultsWithContext, ...timeIntervalDocuments];
      const uniqueResults = Array.from(new Set(combinedResults.map((doc) => doc.metadata.id))).map(
        (id) => combinedResults.find((doc) => doc.metadata.id === id)
      );

      return uniqueResults.filter((doc): doc is Document => doc !== undefined);
    }

    // If no time range is provided, perform a single search
    const searchResults = await search(this.db, searchParams);

    // Convert Orama search results to Document objects
    return searchResults.hits.map(
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
            includeInContext: hit.score >= CONTEXT_SCORE_THRESHOLD || this.options.returnAll,
          },
        })
    );
  }

  private async convertQueryToVector(query: string): Promise<number[]> {
    return await this.embeddingsInstance.embedQuery(query);
  }

  private generateDateRange(startDate: string, endDate: string): string[] {
    const dateRange: string[] = [];
    const currentDate = new Date(startDate);
    const end = new Date(endDate);

    while (currentDate <= end) {
      dateRange.push(`${currentDate.toISOString().split("T")[0]}`);
      currentDate.setDate(currentDate.getDate() + 1);
    }

    return dateRange;
  }

  private filterAndFormatChunks(oramaChunks: Document[], explicitChunks: Document[]): Document[] {
    const threshold = this.options.minSimilarityScore;
    const filteredOramaChunks = oramaChunks.filter((chunk) => chunk.metadata.score >= threshold);

    // Combine explicit and filtered Orama chunks, removing duplicates while maintaining order
    const uniqueChunks = new Set<string>(explicitChunks.map((chunk) => chunk.pageContent));
    const combinedChunks: Document[] = [...explicitChunks];

    for (const chunk of filteredOramaChunks) {
      const chunkContent = chunk.pageContent;
      if (!uniqueChunks.has(chunkContent)) {
        uniqueChunks.add(chunkContent);
        combinedChunks.push(chunk);
      }
    }

    // Add a new metadata field to indicate if the chunk should be included in the context
    return combinedChunks.map((chunk) => ({
      ...chunk,
      metadata: {
        ...chunk.metadata,
        includeInContext:
          chunk.metadata.includeInContext === true ||
          chunk.metadata.score >= CONTEXT_SCORE_THRESHOLD ||
          this.options.returnAll,
      },
    }));
  }
}
