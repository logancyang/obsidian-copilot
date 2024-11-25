import { TEXT_WEIGHT } from "@/constants";
import { CustomError } from "@/error";
import { BrevilabsClient } from "@/LLMProviders/brevilabsClient";
import ChatModelManager from "@/LLMProviders/chatModelManager";
import { HybridRetriever } from "@/search/hybridRetriever";
import { TimeInfo } from "@/tools/TimeTools";
import VectorStoreManager from "@/VectorStoreManager";
import { tool } from "@langchain/core/tools";
import { z } from "zod";

const localSearchTool = tool(
  async ({
    timeRange,
    query,
    salientTerms,
    vectorStoreManager,
    chatModelManager,
    brevilabsClient,
  }: {
    timeRange?: { startTime: TimeInfo; endTime: TimeInfo };
    query: string;
    salientTerms: string[];
    vectorStoreManager: VectorStoreManager;
    chatModelManager: ChatModelManager;
    brevilabsClient: BrevilabsClient;
  }) => {
    // Ensure VectorStoreManager is initialized
    await vectorStoreManager.waitForInitialization();

    const embeddingsManager = vectorStoreManager.getEmbeddingsManager();
    const vault = vectorStoreManager.getVault();
    const embeddingInstance = embeddingsManager?.getEmbeddingsAPI();
    const settings = vectorStoreManager.getSettings();

    if (!embeddingInstance) {
      throw new CustomError("Embedding instance not found.");
    }

    const returnAll = timeRange !== undefined;

    const db = vectorStoreManager.getDb();
    if (!db) {
      throw new CustomError("Orama database not found.");
    }

    const hybridRetriever = new HybridRetriever(
      db,
      vault,
      chatModelManager.getChatModel(),
      embeddingInstance,
      brevilabsClient,
      {
        minSimilarityScore: returnAll ? 0.0 : 0.1,
        maxK: returnAll ? 100 : 15,
        salientTerms,
        timeRange: timeRange
          ? {
              startDate: timeRange.startTime.localDateString,
              endDate: timeRange.endTime.localDateString,
            }
          : undefined,
        textWeight: TEXT_WEIGHT,
        returnAll: returnAll,
        // Voyage AI reranker did worse than Orama in some cases, so only use it if
        // Orama did not return anything higher than this threshold
        useRerankerThreshold: 0.5,
      },
      settings.debug
    );

    // Perform the search
    const documents = await hybridRetriever.getRelevantDocuments(query);

    // Format the results
    const formattedResults = documents.map((doc) => ({
      title: doc.metadata.title,
      content: doc.pageContent,
      path: doc.metadata.path,
      score: doc.metadata.score,
      rerank_score: doc.metadata.rerank_score,
      includeInContext: doc.metadata.includeInContext,
    }));

    return JSON.stringify(formattedResults);
  },
  {
    name: "localSearch",
    description: "Search for notes based on the time range and query",
    schema: z.object({
      timeRange: z
        .object({
          startTime: z.any(),
          endTime: z.any(),
        })
        .optional(),
      query: z.string().describe("The search query"),
      salientTerms: z.array(z.string()).describe("List of salient terms extracted from the query"),
      vectorStoreManager: z.any().describe("The VectorStoreManager instance"),
      chatModelManager: z.any().describe("The ChatModelManager instance"),
      brevilabsClient: z.any().describe("The BrevilabsClient instance"),
    }),
  }
);

const indexTool = tool(
  async ({ vectorStoreManager }: { vectorStoreManager: VectorStoreManager }) => {
    try {
      const indexedCount = await vectorStoreManager.indexVaultToVectorStore();
      const indexResultPrompt = `Please report whether the indexing was successful.\nIf success is true, just say it is successful. If 0 files is indexed, say there are no new files to index.`;
      return (
        indexResultPrompt +
        JSON.stringify({
          success: true,
          message:
            indexedCount === 0
              ? "No new files to index."
              : `Indexed ${indexedCount} files in the vault.`,
        })
      );
    } catch (error) {
      console.error("Error indexing vault:", error);
      return JSON.stringify({
        success: false,
        message: "An error occurred while indexing the vault.",
      });
    }
  },
  {
    name: "indexVault",
    description: "Index the vault to the Copilot index",
    schema: z.object({
      vectorStoreManager: z.any().describe("The VectorStoreManager instance"),
    }),
  }
);

// Add new web search tool
const webSearchTool = tool(
  async ({ query, brevilabsClient }: { query: string; brevilabsClient: BrevilabsClient }) => {
    try {
      const response = await brevilabsClient.webSearch(query);
      return (
        "\n\nWeb search results below, don't forget to list the sources at the end of your answer:\n" +
        response.response
      );
    } catch (error) {
      console.error(`Error processing web search query ${query}:`, error);
      return "";
    }
  },
  {
    name: "webSearch",
    description: "Search the web for information",
    schema: z.object({
      query: z.string().describe("The search query"),
      brevilabsClient: z.any().describe("The BrevilabsClient instance"),
    }),
  }
);

export { indexTool, localSearchTool, webSearchTool };
