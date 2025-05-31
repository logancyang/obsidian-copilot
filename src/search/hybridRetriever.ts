import { BrevilabsClient } from "@/LLMProviders/brevilabsClient";
import EmbeddingManager from "@/LLMProviders/embeddingManager";
import ProjectManager from "@/LLMProviders/projectManager";
import { logInfo } from "@/logger";
import VectorStoreManager from "@/search/vectorStoreManager";
import { getSettings } from "@/settings/model";
import { extractNoteFiles, removeThinkTags, withSuppressedTokenWarnings } from "@/utils";
import { BaseCallbackConfig } from "@langchain/core/callbacks/manager";
import { Document } from "@langchain/core/documents";
import { BaseChatModelCallOptions } from "@langchain/core/language_models/chat_models";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { BaseRetriever } from "@langchain/core/retrievers";
import { search } from "@orama/orama";
import { TFile } from "obsidian";
import { DBOperations } from "./dbOperations";

export class HybridRetriever extends BaseRetriever {
  public lc_namespace = ["hybrid_retriever"];

  private queryRewritePrompt: ChatPromptTemplate;

  constructor(
    private options: {
      minSimilarityScore: number;
      maxK: number;
      salientTerms: string[];
      timeRange?: { startTime: number; endTime: number };
      textWeight?: number;
      returnAll?: boolean;
      useRerankerThreshold?: number; // reranking API is only called with this set
    }
  ) {
    super();
    this.queryRewritePrompt = ChatPromptTemplate.fromTemplate(
      "Please write a passage to answer the question. If you don't know the answer, just make up a passage. \nQuestion: {question}\nPassage:"
    );
  }

  public async getRelevantDocuments(
    query: string,
    config?: BaseCallbackConfig
  ): Promise<Document[]> {
    // Wrap the entire function in token warning suppression
    return withSuppressedTokenWarnings(async () => {
      // Extract note TFiles wrapped in [[]] from the query
      const noteFiles = extractNoteFiles(query, app.vault);
      // Add note titles to salient terms
      const noteTitles = noteFiles.map((file) => file.basename);
      // Use Set to ensure uniqueness when combining terms
      const enhancedSalientTerms = [...new Set([...this.options.salientTerms, ...noteTitles])];

      // Retrieve chunks for explicitly mentioned note files
      const explicitChunks = await this.getExplicitChunks(noteFiles);
      let rewrittenQuery = query;
      if (config?.runName !== "no_hyde") {
        // Use config to determine if HyDE should be used
        // Generate a hypothetical answer passage
        rewrittenQuery = await this.rewriteQuery(query);
      }
      // Pass enhanced salient terms to include titles
      const oramaChunks = await this.getOramaChunks(
        rewrittenQuery,
        enhancedSalientTerms,
        this.options.textWeight
      );

      const combinedChunks = this.filterAndFormatChunks(oramaChunks, explicitChunks);

      let finalChunks = combinedChunks;

      // Add check for empty array
      if (combinedChunks.length === 0) {
        if (getSettings().debug) {
          console.log("No chunks found for query:", query);
        }
        return finalChunks;
      }

      const maxOramaScore = combinedChunks.reduce((max, chunk) => {
        const score = chunk.metadata.score;
        const isValidScore = typeof score === "number" && !isNaN(score);
        return isValidScore ? Math.max(max, score) : max;
      }, 0);

      const allScoresAreNaN = combinedChunks.every(
        (chunk) => typeof chunk.metadata.score !== "number" || isNaN(chunk.metadata.score)
      );

      const shouldRerank =
        this.options.useRerankerThreshold &&
        (maxOramaScore < this.options.useRerankerThreshold || allScoresAreNaN);
      // Apply reranking if max score is below the threshold or all scores are NaN
      if (shouldRerank) {
        const rerankResponse = await BrevilabsClient.getInstance().rerank(
          query,
          // Limit the context length to 3000 characters to avoid overflowing the reranker
          combinedChunks.map((doc) => doc.pageContent.slice(0, 3000))
        );

        // Map chunks based on reranked scores and include rerank_score in metadata
        finalChunks = rerankResponse.response.data.map((item) => ({
          ...combinedChunks[item.index],
          metadata: {
            ...combinedChunks[item.index].metadata,
            rerank_score: item.relevance_score,
          },
        }));
      }

      if (getSettings().debug) {
        console.log("*** HYBRID RETRIEVER DEBUG INFO: ***");

        if (config?.runName !== "no_hyde") {
          console.log("\nOriginal Query: ", query);
          console.log("Rewritten Query: ", rewrittenQuery);
        }

        console.log("\nExplicit Chunks: ", explicitChunks);
        console.log("Orama Chunks: ", oramaChunks);
        console.log("Combined Chunks: ", combinedChunks);
        console.log("Max Orama Score: ", maxOramaScore);
        if (shouldRerank) {
          console.log("Reranked Chunks: ", finalChunks);
        } else {
          console.log("No reranking applied.");
        }
      }

      return finalChunks;
    });
  }

  private async rewriteQuery(query: string): Promise<string> {
    try {
      const promptResult = await this.queryRewritePrompt.format({ question: query });

      // Execute model invocation with warnings suppressed
      const rewrittenQueryObject = await withSuppressedTokenWarnings(() => {
        const chatModel = ProjectManager.instance
          .getCurrentChainManager()
          .chatModelManager.getChatModel()
          .bind({ temperature: 0 } as BaseChatModelCallOptions);

        return chatModel.invoke(promptResult);
      });

      // Process the result
      if (rewrittenQueryObject && "content" in rewrittenQueryObject) {
        return removeThinkTags(rewrittenQueryObject.content as string);
      }

      console.warn("Unexpected rewrittenQuery format. Falling back to original query.");
      return query;
    } catch (error) {
      console.error("Error in rewriteQuery:", error);
      return query;
    }
  }

  private async getExplicitChunks(noteFiles: TFile[]): Promise<Document[]> {
    const explicitChunks: Document[] = [];
    for (const noteFile of noteFiles) {
      const db = await VectorStoreManager.getInstance().getDb();
      const hits = await DBOperations.getDocsByPath(db, noteFile.path);
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

    const db = await VectorStoreManager.getInstance().getDb();

    const searchParams: any = {
      similarity: this.options.minSimilarityScore,
      limit: this.options.maxK,
      includeVectors: true,
    };

    if (salientTerms.length > 0) {
      // Use hybrid mode when we have salient terms
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

      if (tagOnlyQuery) {
        if (getSettings().debug) {
          console.log("Tag only query detected, setting textWeight to 1 and vectorWeight to 0.");
        }
        textWeight = 1;
        vectorWeight = 0;
      }

      searchParams.mode = "hybrid";
      searchParams.term = salientTerms.join(" ");
      searchParams.vector = {
        value: queryVector,
        property: "embedding",
      };
      searchParams.hybridWeights = {
        text: textWeight,
        vector: vectorWeight,
      };
    } else {
      // Use vector mode when no salient terms
      searchParams.mode = "vector";
      searchParams.vector = {
        value: queryVector,
        property: "embedding",
      };
    }

    // Add time range filter if provided
    if (this.options.timeRange) {
      const { startTime, endTime } = this.options.timeRange;

      const dailyNotes = this.generateDailyNoteDateRange(startTime, endTime);

      logInfo("==== Daily note date range: ====", dailyNotes[0], dailyNotes[dailyNotes.length - 1]);

      // Perform the first search with title filter
      const dailyNoteFiles = extractNoteFiles(dailyNotes.join(", "), app.vault);
      const dailyNoteResults = await this.getExplicitChunks(dailyNoteFiles);

      // Set includeInContext to true for all dailyNoteResults
      const dailyNoteResultsWithContext = dailyNoteResults.map((doc) => ({
        ...doc,
        metadata: {
          ...doc.metadata,
          includeInContext: true,
        },
      }));

      logInfo("==== Modified time range: ====", startTime, endTime);

      // Perform a second search with time range filters
      searchParams.where = {
        mtime: { between: [startTime, endTime] },
      };

      const timeIntervalResults = await search(db, searchParams);

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

    if (getSettings().debug) {
      console.log("==== Orama Search Params: ====\n", searchParams);
    }
    const searchResults = await search(db, searchParams);

    // Add null check and validation for search results
    if (!searchResults || !searchResults.hits) {
      console.warn("Search results or hits are undefined");
      return [];
    }

    // Convert Orama search results to Document objects
    return searchResults.hits
      .map((hit) => {
        if (!hit || !hit.document) {
          console.warn("Invalid hit or document in search results");
          return null;
        }

        if (typeof hit.score !== "number" || isNaN(hit.score)) {
          console.warn("NaN/invalid score detected:", {
            score: hit.score,
            path: hit.document.path,
            title: hit.document.title,
          });
        }

        return new Document({
          pageContent: hit.document.content || "", // Add fallback for content
          metadata: {
            ...(hit.document.metadata || {}), // Add fallback for metadata
            score: hit.score,
            path: hit.document.path || "",
            mtime: hit.document.mtime,
            ctime: hit.document.ctime,
            title: hit.document.title || "",
            id: hit.document.id,
            embeddingModel: hit.document.embeddingModel,
            tags: hit.document.tags || [],
            extension: hit.document.extension,
            created_at: hit.document.created_at,
            nchars: hit.document.nchars,
          },
        });
      })
      .filter((doc): doc is Document => doc !== null); // Filter out null documents
  }

  private async convertQueryToVector(query: string): Promise<number[]> {
    const embeddingsAPI = await EmbeddingManager.getInstance().getEmbeddingsAPI();
    const vector = await embeddingsAPI.embedQuery(query);
    if (vector.length === 0) {
      throw new Error("Query embedding returned an empty vector");
    }
    return vector;
  }

  private generateDailyNoteDateRange(startTime: number, endTime: number): string[] {
    const dailyNotes: string[] = [];
    const start = new Date(startTime);
    const end = new Date(endTime);

    const current = new Date(start);
    while (current <= end) {
      dailyNotes.push(`[[${current.toLocaleDateString("en-CA")}]]`);
      current.setDate(current.getDate() + 1);
    }

    return dailyNotes;
  }

  private filterAndFormatChunks(oramaChunks: Document[], explicitChunks: Document[]): Document[] {
    const threshold = this.options.minSimilarityScore;
    // Only filter out scores that are numbers and below threshold
    const filteredOramaChunks = oramaChunks.filter((chunk) => {
      const score = chunk.metadata.score;
      if (typeof score !== "number" || isNaN(score)) {
        return true; // Keep chunks with NaN scores for now until we find out why
      }
      return score >= threshold;
    });

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
        includeInContext: true,
      },
    }));
  }
}
