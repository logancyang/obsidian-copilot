import { getStandaloneQuestion } from "@/chainUtils";
import {
  EMPTY_INDEX_ERROR_MESSAGE,
  PLUS_MODE_DEFAULT_SOURCE_CHUNKS,
  TEXT_WEIGHT,
  ChatModelProviders,
  ModelCapability,
} from "@/constants";
import { CustomError } from "@/error";
// import { BrevilabsClient } from "@/LLMProviders/brevilabsClient"; // BrevilabsClient disabled
import { HybridRetriever } from "@/search/hybridRetriever";
import VectorStoreManager from "@/search/vectorStoreManager";
import { getSettings, getModelKeyFromModel } from "@/settings/model";
import { TimeInfo } from "@/tools/TimeTools";
import { err2String, ChatHistoryEntry } from "@/utils";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import ChatModelManager from "@/LLMProviders/chatModelManager";
import { getModelKey } from "@/aiParams";
import { AIMessage } from "@langchain/core/messages";


const localSearchTool = tool(
  async ({
    timeRange,
    query,
    salientTerms,
  }: {
    timeRange?: { startTime: TimeInfo; endTime: TimeInfo };
    query: string;
    salientTerms: string[];
  }) => {
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
    }),
  }
);

const indexTool = tool(
  async () => {
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
  {
    name: "indexVault",
    description: "Index the vault to the Copilot2 index",
  }
);

// Add new web search tool
const webSearchTool = tool(
  async ({ query, chatHistory }: { query:string; chatHistory: ChatHistoryEntry[] }) => {
    try {
      console.log(`webSearchTool invoked for query: ${query}`);
      const chatModel = ChatModelManager.getInstance().getChatModel();

      if (!chatModel) {
        console.error("webSearchTool: Chat model is not available.");
        return "Error: Chat model is not available to perform web search.";
      }

      const currentModelKey = getModelKey();
      const settings = getSettings();
      const activeModelConfig = settings.activeModels.find(m => getModelKeyFromModel(m) === currentModelKey);

      let modelNameForLog = "current model";
      if (activeModelConfig) {
        modelNameForLog = activeModelConfig.name;
        if (activeModelConfig.provider === ChatModelProviders.GOOGLE && activeModelConfig.capabilities?.includes(ModelCapability.WEB_SEARCH)) {
          console.log(`webSearchTool: Attempting web search with Google model: ${modelNameForLog} which has WEB_SEARCH capability.`);
        } else {
          console.log(`webSearchTool: Attempting web search with ${modelNameForLog}. Success depends on its inherent capabilities.`);
        }
      } else {
          console.log(`webSearchTool: Attempting web search with an unknown current model.`);
      }

      const searchPrompt = `Please perform a web search for the following query and provide a concise answer based on the search results. Include up to 3-5 source URLs if available and relevant, listing them at the end under a "Sources:" heading:

Query: "${query}"`;

      const messages = [];
      // Add chat history if available, ensuring correct role mapping if needed
      if (chatHistory && chatHistory.length > 0) {
        // Assuming ChatHistoryEntry has { role: "user" | "assistant", content: string }
        // Langchain expects { role: "human" | "ai", content: string } or specific message instances
        chatHistory.forEach(entry => {
          if (entry.role === "user") {
            messages.push({ role: "human", content: entry.content });
          } else if (entry.role === "assistant") {
            messages.push({ role: "ai", content: entry.content });
          }
        });
      }
      messages.push({ role: "user", content: searchPrompt }); // Or "human" role

      const response = await chatModel.invoke(messages);

      let content = "";
      // Standardize access to response content
      if (response && typeof response.content === 'string') {
        content = response.content;
      } else if (response && Array.isArray(response.content) && response.content.length > 0) {
        // Handle cases where content is an array of parts (e.g. text and tool calls in Gemini)
        const textParts = response.content.filter(part => typeof part.text === 'string');
        if (textParts.length > 0) {
          content = textParts.map(part => part.text).join("\n");
        } else {
          content = "Model response did not contain a direct text part for search results.";
        }
      } else {
        content = "Model did not return a recognizable text response for the web search.";
      }

      console.log(`webSearchTool: Response from model ${modelNameForLog}:`, content);
      return content;

    } catch (error) {
      console.error(`webSearchTool: Error during web search attempt:`, error);
      return `Error performing web search: ${err2String(error)}`;
    }
  },
  {
    name: "webSearch",
    description: "Search the web for information",
    schema: z.object({
      query: z.string().describe("The search query"),
      chatHistory: z
        .array(
          z.object({
            role: z.enum(["user", "assistant"]),
            content: z.string(),
          })
        )
        .describe("Previous conversation turns"),
    }),
  }
);

export { indexTool, localSearchTool, webSearchTool };
