import { getStandaloneQuestion } from "@/chainUtils";
import { PLUS_MODE_DEFAULT_SOURCE_CHUNKS, TEXT_WEIGHT } from "@/constants";
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
    const baseMax =
      settings.maxSourceChunks < PLUS_MODE_DEFAULT_SOURCE_CHUNKS
        ? PLUS_MODE_DEFAULT_SOURCE_CHUNKS
        : settings.maxSourceChunks;
    // For time-based queries, ensure a healthy cap to avoid starving recall when users set a very low max
    const effectiveMaxK = returnAll ? Math.max(baseMax, 200) : baseMax;

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

    // Format the results - only include snippet, not full content
    const formattedResults = documents.map((doc) => ({
      title: doc.metadata.title || "Untitled",
      // Only include a snippet for display (first 200 chars)
      content: doc.pageContent.substring(0, 200),
      path: doc.metadata.path || "",
      score: doc.metadata.score ?? 0,
      rerank_score: doc.metadata.rerank_score ?? null,
      includeInContext: doc.metadata.includeInContext ?? true,
      source: doc.metadata.source, // Pass through source for proper labeling
      // Show actual modified time for time-based queries
      mtime: doc.metadata.mtime ?? null,
    }));

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
