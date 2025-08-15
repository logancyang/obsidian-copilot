import { getStandaloneQuestion } from "@/chainUtils";
import { TEXT_WEIGHT } from "@/constants";
import { BrevilabsClient } from "@/LLMProviders/brevilabsClient";
import { logInfo } from "@/logger";
import { TieredLexicalRetriever } from "@/search/v3/TieredLexicalRetriever";
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
    const settings = getSettings();

    const returnAll = timeRange !== undefined;
    // For time-based queries, ensure a healthy cap to avoid starving recall
    const effectiveMaxK = returnAll
      ? Math.max(settings.maxSourceChunks, 200)
      : settings.maxSourceChunks;

    logInfo(`returnAll: ${returnAll}`);

    // Use tiered lexical retriever for multi-stage search
    const retriever = new TieredLexicalRetriever(app, {
      minSimilarityScore: returnAll ? 0.0 : 0.1,
      maxK: effectiveMaxK,
      salientTerms,
      timeRange: timeRange
        ? {
            startTime: timeRange.startTime.epoch,
            endTime: timeRange.endTime.epoch,
          }
        : undefined,
      textWeight: TEXT_WEIGHT,
      returnAll: returnAll,
      useRerankerThreshold: 0.5,
    });

    // Perform the search
    const documents = await retriever.getRelevantDocuments(query);

    logInfo(`localSearch found ${documents.length} documents for query: "${query}"`);
    if (timeRange) {
      logInfo(
        `Time range search from ${new Date(timeRange.startTime.epoch).toISOString()} to ${new Date(timeRange.endTime.epoch).toISOString()}`
      );
    }

    // Format the results - include full content for LLM context
    const formattedResults = documents.map((doc) => {
      const scored = doc.metadata.rerank_score ?? doc.metadata.score ?? 0;
      return {
        title: doc.metadata.title || "Untitled",
        // Include full content for documents that will be sent to LLM
        content: doc.pageContent,
        path: doc.metadata.path || "",
        // Ensure both fields reflect the same final fused score when present
        score: scored,
        rerank_score: scored,
        includeInContext: doc.metadata.includeInContext ?? true,
        source: doc.metadata.source, // Pass through source for proper labeling
        // Show actual modified time for time-based queries
        mtime: doc.metadata.mtime ?? null,
        // Include search explanation if available
        explanation: doc.metadata.explanation ?? null,
      };
    });

    return JSON.stringify(formattedResults);
  },
});

// Note: indexTool is kept for backward compatibility but is no longer used with v3 search
const indexTool = createTool({
  name: "indexVault",
  description: "Index the vault to the Copilot index",
  schema: z.void(), // No parameters
  handler: async () => {
    // Tiered lexical retriever doesn't require manual indexing - it builds ephemeral indexes on demand
    const indexResultPrompt = `The tiered lexical retriever builds indexes on demand and doesn't require manual indexing.\n`;
    return (
      indexResultPrompt +
      JSON.stringify({
        success: true,
        message: "Tiered lexical retriever uses on-demand indexing. No manual indexing required.",
      })
    );
  },
  isBackground: true,
});

// Define Zod schema for webSearch
const webSearchSchema = z.object({
  query: z.string().min(1).describe("The search query"),
  chatHistory: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
      })
    )
    .describe("Previous conversation turns"),
});

// Add new web search tool
const webSearchTool = createTool({
  name: "webSearch",
  description: "Search the web for information",
  schema: webSearchSchema,
  isPlusOnly: true,
  handler: async ({ query, chatHistory }) => {
    try {
      // Get standalone question considering chat history
      const standaloneQuestion = await getStandaloneQuestion(query, chatHistory);

      const response = await BrevilabsClient.getInstance().webSearch(standaloneQuestion);
      const citations = response.response.citations || [];

      // Return structured JSON response for consistency with other tools
      // Format as an array of results like localSearch does
      const webContent = response.response.choices[0].message.content;
      const formattedResults = [
        {
          type: "web_search",
          content: webContent,
          citations: citations,
          instruction:
            "Provide a response based on this information. Include source citations at the end under '#### Sources' as markdown links.",
        },
      ];

      return JSON.stringify(formattedResults);
    } catch (error) {
      console.error(`Error processing web search query ${query}:`, error);
      return "";
    }
  },
});

export { indexTool, localSearchTool, webSearchTool };
export type { SimpleTool };
