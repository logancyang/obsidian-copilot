import { TEXT_WEIGHT } from "@/constants";
import { CustomError } from "@/error";
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
  }: {
    timeRange?: { startTime: TimeInfo; endTime: TimeInfo };
    query: string;
    salientTerms: string[];
    vectorStoreManager: VectorStoreManager;
    chatModelManager: ChatModelManager;
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

    const hybridRetriever = new HybridRetriever(
      vectorStoreManager.getDb(),
      vault,
      chatModelManager.getChatModel(),
      embeddingInstance,
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
    description: "Index the vault to the vector store",
    schema: z.object({
      vectorStoreManager: z.any().describe("The VectorStoreManager instance"),
    }),
  }
);

export { indexTool, localSearchTool };
