import { getStandaloneQuestion } from "@/chainUtils";
import { DEFAULT_MAX_SOURCE_CHUNKS, TEXT_WEIGHT } from "@/constants";
import { BrevilabsClient } from "@/LLMProviders/brevilabsClient";
import { selfHostWebSearch } from "@/LLMProviders/selfHostServices";
import { logInfo } from "@/logger";
import { isSelfHostModeValid } from "@/plusUtils";
import { RetrieverFactory } from "@/search/RetrieverFactory";
import { getSettings } from "@/settings/model";
import { z } from "zod";
import { deduplicateSources } from "@/LLMProviders/chainRunner/utils/toolExecution";
import { createLangChainTool } from "./createLangChainTool";
import { RETURN_ALL_LIMIT } from "@/search/v3/SearchCore";
import { getWebSearchCitationInstructions } from "@/LLMProviders/chainRunner/utils/citationUtils";
import { TieredLexicalRetriever } from "@/search/v3/TieredLexicalRetriever";
import { FilterRetriever } from "@/search/v3/FilterRetriever";
import { mergeFilterAndSearchResults } from "@/search/v3/mergeResults";

/**
 * Query expansion data returned with search results.
 * Used to show what terms were actually searched in the reasoning block.
 */
export interface QueryExpansionInfo {
  originalQuery: string;
  salientTerms: string[]; // Terms from original query (used for ranking)
  expandedQueries: string[]; // Alternative phrasings (used for recall)
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

  // Add in priority order: original query, salient terms, expanded queries
  if (expansion.originalQuery && typeof expansion.originalQuery === "string") {
    addTerm(expansion.originalQuery);
  }
  (expansion.salientTerms || []).forEach(addTerm);
  (expansion.expandedQueries || []).forEach(addTerm);

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
      startTime: z.number().optional().describe("Start time as epoch milliseconds"),
      endTime: z.number().optional().describe("End time as epoch milliseconds"),
    })
    .optional()
    .describe("Optional time range filter. Use epoch milliseconds from getTimeRangeMs result."),
  returnAll: z
    .boolean()
    .optional()
    .describe(
      "Set to true when the user wants ALL matching notes, not just the best few. " +
        "Use for requests like 'find all my X', 'list every Y', 'show me all my Z', " +
        "'how many notes about W'. Returns up to 100 results instead of default 30. " +
        "Leave false/undefined for normal questions."
    ),
  _preExpandedQuery: z
    .object({
      originalQuery: z.string(),
      salientTerms: z.array(z.string()),
      expandedQueries: z.array(z.string()),
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
  returnAll = false,
}: {
  timeRange?: { startTime: number; endTime: number };
  query: string;
  salientTerms: string[];
  forceLexical?: boolean;
  preExpandedQuery?: QueryExpansionInfo;
  /** Caller-requested return-all (from LLM tool schema). Combined with implicit triggers. */
  returnAll?: boolean;
}) {
  // Extract tag terms for self-host retriever (server-side tag filtering)
  const tagTerms = salientTerms.filter((term) => term.startsWith("#"));

  // Time-range and tag-focused queries always use expanded result limits
  const useExpandedLimits = returnAll || timeRange !== undefined || tagTerms.length > 0;
  const effectiveMaxK = useExpandedLimits ? RETURN_ALL_LIMIT : DEFAULT_MAX_SOURCE_CHUNKS;

  logInfo(
    `lexicalSearch useExpandedLimits: ${useExpandedLimits} (timeRange: ${!!timeRange}, tags: ${tagTerms.length > 0}, explicit: ${returnAll}), forceLexical: ${forceLexical}`
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

  // --- Step 1: Run FilterRetriever (always) ---
  const filterRetriever = new FilterRetriever(app, {
    salientTerms,
    timeRange,
    maxK: effectiveMaxK,
    returnAll: useExpandedLimits,
  });

  const filterDocs = await filterRetriever.getRelevantDocuments(query);

  logInfo(`lexicalSearch filterRetriever returned ${filterDocs.length} filter docs`);

  // --- Step 2: Run main retriever (skip if time range — filter results are the complete set) ---
  let searchDocs: import("@langchain/core/documents").Document[] = [];
  let queryExpansion: QueryExpansionInfo | undefined;

  if (!filterRetriever.hasTimeRange()) {
    const retrieverOptions = {
      minSimilarityScore: useExpandedLimits ? 0.0 : 0.1,
      maxK: effectiveMaxK,
      salientTerms,
      textWeight: TEXT_WEIGHT,
      returnAll: useExpandedLimits,
      useRerankerThreshold: 0.5,
      tagTerms, // Used by SelfHostRetriever for server-side tag filtering
      preExpandedQuery: convertedPreExpansion, // Pass pre-expanded data to skip double expansion
    };

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
    searchDocs = await retriever.getRelevantDocuments(query);

    // Extract query expansion from the lexical retriever if available
    if (retriever instanceof TieredLexicalRetriever) {
      const expansion = retriever.getLastQueryExpansion();
      if (expansion) {
        queryExpansion = {
          originalQuery: expansion.originalQuery,
          salientTerms: expansion.salientTerms,
          expandedQueries: expansion.expandedQueries,
          recallTerms: computeRecallTerms(expansion),
        };
      }
    }
  }

  // --- Step 3: Merge filter + search results ---
  const { filterResults, searchResults } = mergeFilterAndSearchResults(filterDocs, searchDocs);

  // Tag each result with isFilterResult and matchType
  const mapDoc = (doc: import("@langchain/core/documents").Document, isFilter: boolean) => ({
    title: doc.metadata.title || "Untitled",
    content: doc.pageContent,
    path: doc.metadata.path || "",
    score: doc.metadata.rerank_score ?? doc.metadata.score ?? 0,
    rerank_score: doc.metadata.rerank_score ?? doc.metadata.score ?? 0,
    includeInContext: doc.metadata.includeInContext ?? true,
    source: doc.metadata.source,
    mtime: doc.metadata.mtime ?? null,
    ctime: doc.metadata.ctime ?? null,
    chunkId: (doc.metadata as any).chunkId ?? null,
    isChunk: (doc.metadata as any).isChunk ?? false,
    explanation: doc.metadata.explanation ?? null,
    isFilterResult: isFilter,
    matchType: isFilter ? doc.metadata.source || "filter" : (undefined as string | undefined),
  });

  const taggedFilterResults = filterResults.map((doc) => mapDoc(doc, true));
  const taggedSearchResults = searchResults.map((doc) => mapDoc(doc, false));

  logInfo(
    `lexicalSearch found ${taggedFilterResults.length} filter + ${taggedSearchResults.length} search documents for query: "${query}"`
  );
  if (timeRange) {
    logInfo(
      `Time range search from ${new Date(timeRange.startTime).toISOString()} to ${new Date(timeRange.endTime).toISOString()}`
    );
  }

  // Deduplicate only search results (filter results are never deduped away)
  const searchSourcesLike = taggedSearchResults.map((d) => ({
    title: d.title || d.path || "Untitled",
    path: d.path || d.title || "",
    score: d.rerank_score || d.score || 0,
  }));
  const dedupedSearchSources = deduplicateSources(searchSourcesLike);

  const bestByKey = new Map<string, any>();
  for (const d of taggedSearchResults) {
    const key = (d.path || d.title).toLowerCase();
    const existing = bestByKey.get(key);
    if (!existing || (d.rerank_score || 0) > (existing.rerank_score || 0)) {
      bestByKey.set(key, d);
    }
  }
  const dedupedSearchDocs = dedupedSearchSources
    .map((s) => bestByKey.get((s.path || s.title).toLowerCase()))
    .filter(Boolean);

  // Combine: filter results first, then deduped search results (capped to prevent oversized payloads)
  const allDocs = [...taggedFilterResults, ...dedupedSearchDocs].slice(0, effectiveMaxK);

  return { type: "local_search", documents: allDocs, queryExpansion };
}

// Local search tool using RetrieverFactory (handles Self-hosted > Semantic > Lexical priority)
const lexicalSearchTool = createLangChainTool({
  name: "lexicalSearch",
  description: "Search for notes using lexical/keyword-based search",
  schema: localSearchSchema,
  func: async ({ timeRange: rawTimeRange, query, salientTerms, returnAll }) => {
    const timeRange = validateTimeRange(rawTimeRange);
    return await performLexicalSearch({
      timeRange,
      query,
      salientTerms,
      returnAll: returnAll === true,
    });
  },
});

// Semantic search tool using Orama-based HybridRetriever
const semanticSearchTool = createLangChainTool({
  name: "semanticSearch",
  description: "Search for notes using semantic/meaning-based search with embeddings",
  schema: localSearchSchema,
  func: async ({ timeRange: rawTimeRange, query, salientTerms, returnAll }) => {
    const timeRange = validateTimeRange(rawTimeRange);

    // Time-range and tag-focused queries always use expanded result limits
    const tagTerms = salientTerms.filter((term) => term.startsWith("#"));
    const useExpandedLimits = returnAll === true || timeRange !== undefined || tagTerms.length > 0;
    const effectiveMaxK = useExpandedLimits
      ? Math.max(DEFAULT_MAX_SOURCE_CHUNKS, 200)
      : DEFAULT_MAX_SOURCE_CHUNKS;

    logInfo(
      `semanticSearch useExpandedLimits: ${useExpandedLimits} (timeRange: ${!!timeRange}, tags: ${tagTerms.length > 0}, explicit: ${returnAll === true})`
    );

    // Always use HybridRetriever for semantic search
    const retriever = new (await import("@/search/hybridRetriever")).HybridRetriever({
      minSimilarityScore: useExpandedLimits ? 0.0 : 0.1,
      maxK: effectiveMaxK,
      salientTerms,
      timeRange,
      textWeight: TEXT_WEIGHT,
      returnAll: useExpandedLimits,
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
 * Returns undefined if the time range is invalid, incomplete, or nonsensical.
 * Handles cases where LLMs return empty objects {} or partial objects.
 */
function validateTimeRange(timeRange?: {
  startTime?: number;
  endTime?: number;
}): { startTime: number; endTime: number } | undefined {
  if (!timeRange) return undefined;

  const { startTime, endTime } = timeRange;

  // Check for missing, invalid values (0, negative, or non-numbers)
  // This handles LLM returning {} or {startTime: undefined, endTime: undefined}
  if (!startTime || !endTime || startTime <= 0 || endTime <= 0) {
    logInfo("localSearch: Ignoring invalid time range (missing, zero, or negative values)");
    return undefined;
  }

  // Check for inverted range
  if (startTime > endTime) {
    logInfo("localSearch: Ignoring inverted time range (start > end)");
    return undefined;
  }

  return { startTime, endTime };
}

// Smart wrapper that uses RetrieverFactory for unified retriever selection
const localSearchTool = createLangChainTool({
  name: "localSearch",
  description:
    "Search for notes in the vault based on query, salient terms, and optional time range",
  schema: localSearchSchema,
  func: async ({ timeRange: rawTimeRange, query, salientTerms, returnAll, _preExpandedQuery }) => {
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
        returnAll: returnAll === true,
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
      returnAll: returnAll === true,
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

      const response =
        isSelfHostModeValid() && getSettings().firecrawlApiKey
          ? await selfHostWebSearch(standaloneQuestion)
          : await BrevilabsClient.getInstance().webSearch(standaloneQuestion);
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
