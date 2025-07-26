import { getStandaloneQuestion } from "@/chainUtils";
import {
  EMPTY_INDEX_ERROR_MESSAGE,
  PLUS_MODE_DEFAULT_SOURCE_CHUNKS,
  TEXT_WEIGHT,
} from "@/constants";
import { CustomError } from "@/error";
import { BrevilabsClient } from "@/LLMProviders/brevilabsClient";
import { HybridRetriever } from "@/search/hybridRetriever";
import VectorStoreManager from "@/search/vectorStoreManager";
import { getSettings } from "@/settings/model";
import { z } from "zod";
import { createTool, SimpleTool } from "./SimpleTool";

// Define Zod schema for localSearch
const localSearchSchema = z.object({
  query: z.string().min(1).describe("The search query"),
  salientTerms: z.array(z.string()).describe("List of salient terms extracted from the query"),
  timeRange: z
    .object({
      startTime: z.any(), // TimeInfo type
      endTime: z.any(), // TimeInfo type
    })
    .optional()
    .describe("Time range for search"),
});

const localSearchTool = createTool({
  name: "localSearch",
  description: "Search for notes based on the time range and query",
  schema: localSearchSchema,
  handler: async ({ timeRange, query, salientTerms }) => {
    const indexEmpty = await VectorStoreManager.getInstance().isIndexEmpty();
    if (indexEmpty) {
      throw new CustomError(EMPTY_INDEX_ERROR_MESSAGE);
    }

    const returnAll = timeRange !== undefined;
    const maxSourceChunks =
      getSettings().maxSourceChunks < PLUS_MODE_DEFAULT_SOURCE_CHUNKS
        ? PLUS_MODE_DEFAULT_SOURCE_CHUNKS
        : getSettings().maxSourceChunks;

    if (getSettings().debug) {
      console.log("returnAll:", returnAll);
    }

    const hybridRetriever = new HybridRetriever({
      minSimilarityScore: returnAll ? 0.0 : 0.1,
      maxK: returnAll ? 1000 : maxSourceChunks,
      salientTerms,
      timeRange: timeRange
        ? {
            startTime: timeRange.startTime.epoch,
            endTime: timeRange.endTime.epoch,
          }
        : undefined,
      textWeight: TEXT_WEIGHT,
      returnAll: returnAll,
      // Voyage AI reranker did worse than Orama in some cases, so only use it if
      // Orama did not return anything higher than this threshold
      useRerankerThreshold: 0.5,
    });

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
});

const indexTool = createTool({
  name: "indexVault",
  description: "Index the vault to the Copilot index",
  schema: z.void(), // No parameters
  handler: async () => {
    try {
      const indexedCount = await VectorStoreManager.getInstance().indexVaultToVectorStore();
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
  isBackground: true,
});

// Define Zod schema for webSearch
const webSearchSchema = z.object({
  query: z.string().min(1).describe("The search query"),
  chatHistory: z.array(z.any()).describe("Previous conversation turns"),
});

// Add new web search tool
const webSearchTool = createTool({
  name: "webSearch",
  description: "Search the web for information",
  schema: webSearchSchema,
  handler: async ({ query, chatHistory }) => {
    try {
      // Get standalone question considering chat history
      const standaloneQuestion = await getStandaloneQuestion(query, chatHistory);

      const response = await BrevilabsClient.getInstance().webSearch(standaloneQuestion);
      const citations = response.response.citations || [];
      const citationsList =
        citations.length > 0
          ? "\n\nSources:\n" + citations.map((url, index) => `[${index + 1}] ${url}`).join("\n")
          : "";

      return (
        "Here are the web search results. Please provide a response based on this information and include source citations listed at the end of your response under the heading '#### Sources' as a list of markdown links. For each URL, create a descriptive title based on the domain and path and return it in the markdown format '- [title](url)':\n\n" +
        response.response.choices[0].message.content +
        citationsList
      );
    } catch (error) {
      console.error(`Error processing web search query ${query}:`, error);
      return "";
    }
  },
});

export { indexTool, localSearchTool, webSearchTool };
export type { SimpleTool };
