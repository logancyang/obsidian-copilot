import { getStandaloneQuestion } from "@/chainUtils";
import { TEXT_WEIGHT } from "@/constants";
import { BrevilabsClient } from "@/LLMProviders/brevilabsClient";
import { logInfo } from "@/logger";
import { RetrieverFactory } from "@/search/RetrieverFactory";
import { getSettings } from "@/settings/model";
import { z } from "zod";
import { deduplicateSources } from "@/LLMProviders/chainRunner/utils/toolExecution";
import { createLangChainTool } from "./createLangChainTool";
import { RETURN_ALL_LIMIT } from "@/search/v3/SearchCore";
import { getWebSearchCitationInstructions } from "@/LLMProviders/chainRunner/utils/citationUtils";
import { TieredLexicalRetriever } from "@/search/v3/TieredLexicalRetriever";

/**
 * Query expansion data returned with search results.
 * Used to show what terms were actually searched in the reasoning block.
 */
export interface QueryExpansionInfo {
  originalQuery: string;
  salientTerms: string[]; // Terms from original query (used for ranking)
  expandedQueries: string[]; // Alternative phrasings (used for recall)
  expandedTerms: string[]; // LLM-generated related terms (used for recall)
  recallTerms: string[]; // All terms combined that were used for recall
}

/**
 * Compute all recall terms from expansion data.
 * This mirrors the logic in SearchCore.retrieve() that builds recallQueries.
 * Terms are deduplicated and ordered by priority: original query, salient terms, expanded queries, expanded terms.
 */
function computeRecallTerms(expansion: {
  originalQuery: string;
  salientTerms: string[];
  expandedQueries: string[];
  expandedTerms: string[];
}): string[] {
  const seen = new Set<string>();
  const recallTerms: string[] = [];

  const addTerm = (term: unknown) => {
    // Defensive: only process string values
    if (typeof term !== "string") {
      return;
    }
    const normalized = term.toLowerCase().trim();
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      recallTerms.push(term.trim());
    }
  };

  // Add in priority order: original query, salient terms, expanded queries, expanded terms
  if (expansion.originalQuery && typeof expansion.originalQuery === "string") {
    addTerm(expansion.originalQuery);
  }
  (expansion.salientTerms || []).forEach(addTerm);
  (expansion.expandedQueries || []).forEach(addTerm);
  (expansion.expandedTerms || []).forEach(addTerm);

  return recallTerms;
}

// Define Zod schema for localSearch
const localSearchSchema = z.object({
  query: z.string().min(1).describe("The search query to find relevant notes"),
  salientTerms: z
    .array(z.string())
    .describe(
      "Keywords extracted from the user's query for BM25 full-text search. Must be from original query."
    ),
  timeRange: z
    .object({
      startTime: z.number().describe("Start time as epoch milliseconds"),
      endTime: z.number().describe("End time as epoch milliseconds"),
    })
    .optional()
    .describe("Optional time range filter. Use epoch milliseconds from getTimeRangeMs result."),
  _preExpandedQuery: z
    .object({
      originalQuery: z.string(),
      salientTerms: z.array(z.string()),
      expandedQueries: z.array(z.string()),
      expandedTerms: z.array(z.string()),
      recallTerms: z.array(z.string()),
    })
    .optional()
    .describe("Internal: pre-expanded query data injected by the system to avoid double expansion"),
});

// Core lexical search function (shared by lexicalSearchTool and localSearchTool)
async function performLexicalSearch({
  timeRange,
  query,
  salientTerms,
  forceLexical = false,
  preExpandedQuery,
}: {
  timeRange?: { startTime: number; endTime: number };
  query: string;
  salientTerms: string[];
  forceLexical?: boolean;
  preExpandedQuery?: QueryExpansionInfo;
}) {
  const settings = getSettings();

  const tagTerms = salientTerms.filter((term) => term.startsWith("#"));
  const returnAll = timeRange !== undefined;
  const returnAllTags = tagTerms.length > 0;
  const shouldReturnAll = returnAll || returnAllTags;
  const effectiveMaxK = shouldReturnAll ? RETURN_ALL_LIMIT : settings.maxSourceChunks;

  logInfo(
    `lexicalSearch returnAll: ${returnAll} (tags returnAll: ${returnAllTags}), forceLexical: ${forceLexical}`
  );

  // Convert QueryExpansionInfo to ExpandedQuery format (adding queries field)
  const convertedPreExpansion = preExpandedQuery
    ? {
        ...preExpandedQuery,
        // Build queries array: original query + expanded queries
        queries: [
          preExpandedQuery.originalQuery,
          ...(preExpandedQuery.expandedQueries || []),
        ].filter(Boolean),
      }
    : undefined;

  const retrieverOptions = {
    minSimilarityScore: shouldReturnAll ? 0.0 : 0.1,
    maxK: effectiveMaxK,
    salientTerms,
    timeRange,
    textWeight: TEXT_WEIGHT,
    returnAll,
    useRerankerThreshold: 0.5,
    returnAllTags,
    tagTerms,
    preExpandedQuery: convertedPreExpansion, // Pass pre-expanded data to skip double expansion
  };

  // If forceLexical is true, bypass the factory and use lexical retriever directly
  // This ensures time-range and tag filtering works correctly
  let retriever;
  let retrieverType: string;
  if (forceLexical) {
    retriever = RetrieverFactory.createLexicalRetriever(app, retrieverOptions);
    retrieverType = "lexical (forced)";
  } else {
    const retrieverResult = await RetrieverFactory.createRetriever(app, retrieverOptions);
    retriever = retrieverResult.retriever;
    retrieverType = retrieverResult.type;
  }

  logInfo(`lexicalSearch using ${retrieverType} retriever`);
  const documents = await retriever.getRelevantDocuments(query);

  // Extract query expansion from the lexical retriever if available
  let queryExpansion: QueryExpansionInfo | undefined;
  if (retriever instanceof TieredLexicalRetriever) {
    const expansion = retriever.getLastQueryExpansion();
    if (expansion) {
      queryExpansion = {
        originalQuery: expansion.originalQuery,
        salientTerms: expansion.salientTerms,
        expandedQueries: expansion.expandedQueries,
        expandedTerms: expansion.expandedTerms,
        recallTerms: computeRecallTerms(expansion),
      };
    }
  }

  logInfo(`lexicalSearch found ${documents.length} documents for query: "${query}"`);
  if (timeRange) {
    logInfo(
      `Time range search from ${new Date(timeRange.startTime).toISOString()} to ${new Date(timeRange.endTime).toISOString()}`
    );
  }

  const formattedResults = documents.map((doc) => {
    const scored = doc.metadata.rerank_score ?? doc.metadata.score ?? 0;
    return {
      title: doc.metadata.title || "Untitled",
      content: doc.pageContent,
      path: doc.metadata.path || "",
      score: scored,
      rerank_score: scored,
      includeInContext: doc.metadata.includeInContext ?? true,
      source: doc.metadata.source,
      mtime: doc.metadata.mtime ?? null,
      ctime: doc.metadata.ctime ?? null,
      chunkId: (doc.metadata as any).chunkId ?? null,
      isChunk: (doc.metadata as any).isChunk ?? false,
      explanation: doc.metadata.explanation ?? null,
    };
  });
  // Reuse the same dedupe logic used by Show Sources (path fallback to title, keep highest score)
  const sourcesLike = formattedResults.map((d) => ({
    title: d.title || d.path || "Untitled",
    path: d.path || d.title || "",
    score: d.rerank_score || d.score || 0,
  }));
  const dedupedSources = deduplicateSources(sourcesLike);

  // Map back to document objects in the same deduped order
  const bestByKey = new Map<string, any>();
  for (const d of formattedResults) {
    const key = (d.path || d.title).toLowerCase();
    const existing = bestByKey.get(key);
    if (!existing || (d.rerank_score || 0) > (existing.rerank_score || 0)) {
      bestByKey.set(key, d);
    }
  }
  const dedupedDocs = dedupedSources
    .map((s) => bestByKey.get((s.path || s.title).toLowerCase()))
    .filter(Boolean);

  return { type: "local_search", documents: dedupedDocs, queryExpansion };
}

// Local search tool using RetrieverFactory (handles Self-hosted > Semantic > Lexical priority)
const lexicalSearchTool = createLangChainTool({
  name: "lexicalSearch",
  description: "Search for notes using lexical/keyword-based search",
  schema: localSearchSchema,
  func: async ({ timeRange, query, salientTerms }) => {
    return await performLexicalSearch({ timeRange, query, salientTerms });
  },
});

// Semantic search tool using Orama-based HybridRetriever
const semanticSearchTool = createLangChainTool({
  name: "semanticSearch",
  description: "Search for notes using semantic/meaning-based search with embeddings",
  schema: localSearchSchema,
  func: async ({ timeRange, query, salientTerms }) => {
    const settings = getSettings();

    const returnAll = timeRange !== undefined;
    const effectiveMaxK = returnAll
      ? Math.max(settings.maxSourceChunks, 200)
      : settings.maxSourceChunks;

    logInfo(`semanticSearch returnAll: ${returnAll}`);

    // Always use HybridRetriever for semantic search
    const retriever = new (await import("@/search/hybridRetriever")).HybridRetriever({
      minSimilarityScore: returnAll ? 0.0 : 0.1,
      maxK: effectiveMaxK,
      salientTerms,
      timeRange,
      textWeight: TEXT_WEIGHT,
      returnAll: returnAll,
      useRerankerThreshold: 0.5,
    });

    const documents = await retriever.getRelevantDocuments(query);

    logInfo(`semanticSearch found ${documents.length} documents for query: "${query}"`);
    if (timeRange) {
      logInfo(
        `Time range search from ${new Date(timeRange.startTime).toISOString()} to ${new Date(timeRange.endTime).toISOString()}`
      );
    }

    const formattedResults = documents.map((doc) => {
      const scored = doc.metadata.rerank_score ?? doc.metadata.score ?? 0;
      return {
        title: doc.metadata.title || "Untitled",
        content: doc.pageContent,
        path: doc.metadata.path || "",
        score: scored,
        rerank_score: scored,
        includeInContext: doc.metadata.includeInContext ?? true,
        source: doc.metadata.source,
        mtime: doc.metadata.mtime ?? null,
        ctime: doc.metadata.ctime ?? null,
        chunkId: (doc.metadata as any).chunkId ?? null,
        isChunk: (doc.metadata as any).isChunk ?? false,
        explanation: doc.metadata.explanation ?? null,
      };
    });
    // Reuse the same dedupe logic used by Show Sources
    const sourcesLike = formattedResults.map((d) => ({
      title: d.title || d.path || "Untitled",
      path: d.path || d.title || "",
      score: d.rerank_score || d.score || 0,
    }));
    const dedupedSources = deduplicateSources(sourcesLike);

    const bestByKey = new Map<string, any>();
    for (const d of formattedResults) {
      const key = (d.path || d.title).toLowerCase();
      const existing = bestByKey.get(key);
      if (!existing || (d.rerank_score || 0) > (existing.rerank_score || 0)) {
        bestByKey.set(key, d);
      }
    }
    const dedupedDocs = dedupedSources
      .map((s) => bestByKey.get((s.path || s.title).toLowerCase()))
      .filter(Boolean);

    return { type: "local_search", documents: dedupedDocs };
  },
});

/**
 * Validate and sanitize time range to prevent LLM hallucinations.
 * Returns undefined if the time range is invalid or nonsensical.
 */
function validateTimeRange(timeRange?: {
  startTime: number;
  endTime: number;
}): { startTime: number; endTime: number } | undefined {
  if (!timeRange) return undefined;

  const { startTime, endTime } = timeRange;

  // Check for invalid values (0, negative, or non-numbers)
  if (!startTime || !endTime || startTime <= 0 || endTime <= 0) {
    logInfo("localSearch: Ignoring invalid time range (zero or negative values)");
    return undefined;
  }

  // Check for inverted range
  if (startTime > endTime) {
    logInfo("localSearch: Ignoring inverted time range (start > end)");
    return undefined;
  }

  return timeRange;
}

// Smart wrapper that uses RetrieverFactory for unified retriever selection
const localSearchTool = createLangChainTool({
  name: "localSearch",
  description:
    "Search for notes in the vault based on query, salient terms, and optional time range",
  schema: localSearchSchema,
  func: async ({ timeRange: rawTimeRange, query, salientTerms, _preExpandedQuery }) => {
    // Validate time range to prevent LLM hallucinations (e.g., {startTime: 0, endTime: 0})
    const timeRange = validateTimeRange(rawTimeRange);

    const tagTerms = salientTerms.filter((term) => term.startsWith("#"));
    const shouldForceLexical = timeRange !== undefined || tagTerms.length > 0;

    // For time-range and tag queries, force lexical search for better filtering
    // Otherwise, let RetrieverFactory handle the priority (Self-hosted > Semantic > Lexical)
    if (shouldForceLexical) {
      logInfo("localSearch: Forcing lexical search (time range or tags present)");
      return await performLexicalSearch({
        timeRange,
        query,
        salientTerms,
        forceLexical: true,
        preExpandedQuery: _preExpandedQuery,
      });
    }

    // Use RetrieverFactory which handles priority: Self-hosted > Semantic > Lexical
    const retrieverType = RetrieverFactory.getRetrieverType();
    logInfo(`localSearch: Using ${retrieverType} retriever via factory`);

    // Delegate to shared function which uses RetrieverFactory internally
    return await performLexicalSearch({
      timeRange,
      query,
      salientTerms,
      preExpandedQuery: _preExpandedQuery,
    });
  },
});

// Note: indexTool behavior depends on which retriever is active
const indexTool = createLangChainTool({
  name: "indexVault",
  description: "Index the vault to the Copilot index",
  schema: z.object({}), // No parameters
  func: async () => {
    const settings = getSettings();
    if (settings.enableSemanticSearchV3) {
      // Semantic search uses persistent Orama index - trigger actual indexing
      try {
        const VectorStoreManager = (await import("@/search/vectorStoreManager")).default;
        const count = await VectorStoreManager.getInstance().indexVaultToVectorStore();
        const indexResultPrompt = `Semantic search index refreshed with ${count} documents.\n`;
        return {
          success: true,
          message:
            indexResultPrompt + `Semantic search index has been refreshed with ${count} documents.`,
          documentCount: count,
        };
      } catch (error: any) {
        return {
          success: false,
          message: `Failed to index with semantic search: ${error.message}`,
        };
      }
    } else {
      // V3 search builds indexes on demand
      return {
        success: true,
        message: "Tiered lexical retriever uses on-demand indexing. No manual indexing required.",
      };
    }
  },
});

// Define Zod schema for webSearch
const webSearchSchema = z.object({
  query: z.string().min(1).describe("The search query to search the internet"),
  chatHistory: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
      })
    )
    .describe("Previous conversation turns for context (usually empty array)"),
});

// Add new web search tool
const webSearchTool = createLangChainTool({
  name: "webSearch",
  description:
    "Search the INTERNET (NOT vault notes) when user explicitly asks for web/online information",
  schema: webSearchSchema,
  func: async ({ query, chatHistory }) => {
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
          // Instruct the model to use footnote-style citations and definitions.
          // Chat UI will render [^n] as [n] for readability and show a simple numbered Sources list.
          // When inserted into a note, the original [^n] footnotes will remain valid Markdown footnotes.
          instruction: getWebSearchCitationInstructions(),
        },
      ];

      return formattedResults;
    } catch (error) {
      console.error(`Error processing web search query ${query}:`, error);
      return { error: `Web search failed: ${error}` };
    }
  },
});

export { indexTool, lexicalSearchTool, localSearchTool, semanticSearchTool, webSearchTool };
