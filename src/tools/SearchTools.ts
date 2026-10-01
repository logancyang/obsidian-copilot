import { getStandaloneQuestion } from "@/chainUtils";
import { TEXT_WEIGHT } from "@/constants";
import { BrevilabsClient } from "@/LLMProviders/brevilabsClient";
import { hasSelfHostSearchKey, selfHostWebSearch } from "@/LLMProviders/selfHostServices";
import { logError, logInfo } from "@/logger";
import { isSelfHostModeValid } from "@/plusUtils";
import { RetrieverFactory } from "@/search/RetrieverFactory";
import { getSettings } from "@/settings/model";
import { App } from "obsidian";
import * as z from "zod";
import { deduplicateSources } from "@/LLMProviders/chainRunner/utils/toolExecution";
import { createLangChainTool } from "./createLangChainTool";
import { getWebSearchCitationInstructions } from "@/LLMProviders/chainRunner/utils/citationUtils";
import { TieredLexicalRetriever } from "@/search/v3/TieredLexicalRetriever";
import { FilterRetriever } from "@/search/v3/FilterRetriever";
import { RETURN_ALL_LIMIT } from "@/search/v3/SearchCore";
import { mergeFilterAndSearchResults } from "@/search/v3/mergeResults";
import type { Document } from "@langchain/core/documents";

export interface QueryExpansionInfo {
  originalQuery: string;
  salientTerms: string[];
  expandedQueries: string[];
  recallTerms: string[];
}

function computeRecallTerms(expansion: {
  originalQuery: string;
  salientTerms: string[];
  expandedQueries: string[];
}): string[] {
  const seen = new Set<string>();
  const recallTerms: string[] = [];

  const addTerm = (term: unknown) => {
    if (typeof term !== "string") {
      return;
    }
    const normalized = term.toLowerCase().trim();
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      recallTerms.push(term.trim());
    }
  };

  if (expansion.originalQuery && typeof expansion.originalQuery === "string") {
    addTerm(expansion.originalQuery);
  }
  (expansion.salientTerms || []).forEach(addTerm);
  (expansion.expandedQueries || []).forEach(addTerm);

  return recallTerms;
}

function projectSearchDocument(doc: Document, isFilterResult: boolean) {
  const score = doc.metadata.rerank_score ?? doc.metadata.score ?? 0;
  return {
    title: doc.metadata.title || "Untitled",
    content: doc.pageContent,
    path: doc.metadata.path || "",
    score,
    rerank_score: score,
    includeInContext: doc.metadata.includeInContext ?? true,
    source: doc.metadata.source,
    mtime: doc.metadata.mtime ?? null,
    ctime: doc.metadata.ctime ?? null,
    chunkId: (doc.metadata as Record<string, unknown>).chunkId ?? null,
    isChunk: (doc.metadata as Record<string, unknown>).isChunk ?? false,
    explanation: doc.metadata.explanation ?? null,
    isFilterResult,
    matchType: isFilterResult ? doc.metadata.source || "filter" : undefined,
  };
}

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

async function performLexicalSearch({
  app,
  timeRange,
  query,
  salientTerms,
  forceLexical = false,
  preExpandedQuery,
}: {
  app: App;
  timeRange?: { startTime: number; endTime: number };
  query: string;
  salientTerms: string[];
  forceLexical?: boolean;
  preExpandedQuery?: QueryExpansionInfo;
}) {
  const settings = getSettings();
  const salientTagTerms = salientTerms.filter((term) => term.startsWith("#"));
  const tagTerms =
    salientTagTerms.length > 0
      ? salientTagTerms
      : (() => {
          try {
            return [...query.matchAll(/#[\p{L}\p{N}_/-]+/gu)].map((m) => m[0]);
          } catch {
            return [...query.matchAll(/#[a-z0-9_/-]+/gi)].map((m) => m[0]);
          }
        })();
  const hasTagTerms = tagTerms.length > 0;

  const needsExpandedLimits = timeRange !== undefined || hasTagTerms;
  const effectiveMaxK = needsExpandedLimits ? RETURN_ALL_LIMIT : settings.maxSourceChunks;

  logInfo(
    `lexicalSearch effectiveMaxK: ${effectiveMaxK} (expanded: ${needsExpandedLimits}), forceLexical: ${forceLexical}`
  );

  const convertedPreExpansion = preExpandedQuery
    ? {
        ...preExpandedQuery,
        queries: [
          preExpandedQuery.originalQuery,
          ...(preExpandedQuery.expandedQueries || []),
        ].filter(Boolean),
      }
    : undefined;

  const filterRetriever = new FilterRetriever(app, {
    salientTerms,
    timeRange,
    maxK: effectiveMaxK,
    returnAll: needsExpandedLimits,
  });

  const filterDocs = await filterRetriever.getRelevantDocuments(query);

  logInfo(`lexicalSearch filterRetriever returned ${filterDocs.length} filter docs`);

  let searchDocs: import("@langchain/core/documents").Document[] = [];
  let queryExpansion: QueryExpansionInfo | undefined;

  if (!filterRetriever.hasTimeRange()) {
    const retrieverOptions = {
      minSimilarityScore: needsExpandedLimits ? 0.0 : 0.1,
      maxK: effectiveMaxK,
      salientTerms,
      textWeight: TEXT_WEIGHT,
      returnAll: needsExpandedLimits,
      useRerankerThreshold: 0.5,
      tagTerms,
      preExpandedQuery: convertedPreExpansion,
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

  const { filterResults, searchResults } = mergeFilterAndSearchResults(filterDocs, searchDocs);

  const taggedFilterResults = filterResults.map((doc) => projectSearchDocument(doc, true));
  const taggedSearchResults = searchResults.map((doc) => projectSearchDocument(doc, false));

  logInfo(
    `lexicalSearch found ${taggedFilterResults.length} filter + ${taggedSearchResults.length} search documents for query: "${query}"`
  );
  if (timeRange) {
    logInfo(
      `Time range search from ${new Date(timeRange.startTime).toISOString()} to ${new Date(timeRange.endTime).toISOString()}`
    );
  }

  const searchSourcesLike = taggedSearchResults.map((d) => ({
    title: d.title || d.path || "Untitled",
    path: d.path || d.title || "",
    score: d.rerank_score || d.score || 0,
  }));
  const dedupedSearchSources = deduplicateSources(searchSourcesLike);

  const bestByKey = new Map<string, { rerank_score?: number }>();
  for (const d of taggedSearchResults) {
    const key = ((d.path as string) || (d.title as string)).toLowerCase();
    const existing = bestByKey.get(key);
    if (!existing || (d.rerank_score || 0) > (existing.rerank_score || 0)) {
      bestByKey.set(key, d);
    }
  }
  const dedupedSearchDocs = dedupedSearchSources
    .map((s) => bestByKey.get((s.path || s.title).toLowerCase()))
    .filter(Boolean);

  const allDocs = [...taggedFilterResults, ...dedupedSearchDocs].slice(0, effectiveMaxK);

  return { type: "local_search", documents: allDocs, queryExpansion };
}

function validateTimeRange(timeRange?: {
  startTime?: number;
  endTime?: number;
}): { startTime: number; endTime: number } | undefined {
  if (!timeRange) return undefined;

  const { startTime, endTime } = timeRange;

  if (!startTime || !endTime || startTime <= 0 || endTime <= 0) {
    logInfo("localSearch: Ignoring invalid time range (missing, zero, or negative values)");
    return undefined;
  }

  if (startTime > endTime) {
    logInfo("localSearch: Ignoring inverted time range (start > end)");
    return undefined;
  }

  return { startTime, endTime };
}

async function performMiyoSearch({
  app,
  query,
  salientTerms,
  timeRange,
}: {
  app: App;
  query: string;
  salientTerms: string[];
  timeRange?: { startTime: number; endTime: number };
}) {
  const tagTerms = salientTerms.filter((term) => term.startsWith("#"));
  const needsExpandedLimits = timeRange !== undefined || tagTerms.length > 0;
  const effectiveMaxK = needsExpandedLimits ? RETURN_ALL_LIMIT : getSettings().maxSourceChunks;

  const filterRetriever = new FilterRetriever(app, {
    salientTerms,
    timeRange,
    maxK: effectiveMaxK,
    returnAll: needsExpandedLimits,
  });
  const filterDocs = await filterRetriever.getRelevantDocuments(query);

  let miyoDocs: import("@langchain/core/documents").Document[] = [];
  if (!filterRetriever.hasTimeRange()) {
    const miyoRetriever = RetrieverFactory.createMiyoRetriever(app, {
      minSimilarityScore: needsExpandedLimits ? 0.0 : 0.1,
      maxK: effectiveMaxK,
      salientTerms,
      textWeight: TEXT_WEIGHT,
      returnAll: needsExpandedLimits,
      useRerankerThreshold: 0.5,
      tagTerms,
    });
    miyoDocs = await miyoRetriever.getRelevantDocuments(query);
  }

  logInfo(
    `miyoSearch: ${filterDocs.length} filter + ${miyoDocs.length} miyo docs for query: "${query}"`
  );

  const { filterResults, searchResults } = mergeFilterAndSearchResults(filterDocs, miyoDocs);

  const allDocs = [
    ...filterResults.map((doc) => projectSearchDocument(doc, true)),
    ...searchResults.map((doc) => projectSearchDocument(doc, false)),
  ].slice(0, effectiveMaxK);

  return { type: "local_search", documents: allDocs };
}

const createLocalSearchTool = (app: App) =>
  createLangChainTool({
    name: "localSearch",
    description:
      "Search for notes in the vault based on query, salient terms, and optional time range",
    schema: localSearchSchema,
    func: async ({ timeRange: rawTimeRange, query, salientTerms, _preExpandedQuery }) => {
      const timeRange = validateTimeRange(rawTimeRange);
      const settings = getSettings();
      const miyoActive = RetrieverFactory.isMiyoActive();

      // Miyo can stay enabled on mobile even though local discovery is unavailable.
      // Preserve that user intent as an unavailable result instead of silently
      // routing the same request to keyword search.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/356
      if (settings.enableMiyo && !miyoActive) {
        throw new Error(
          "Miyo is unavailable. Configure a remote Miyo connection, then retry vault search."
        );
      }

      if (miyoActive) {
        logInfo("localSearch: Using Miyo search path");
        return await performMiyoSearch({
          app,
          query,
          salientTerms,
          timeRange,
        });
      }

      const tagTerms = salientTerms.filter((term) => term.startsWith("#"));
      const shouldForceLexical = timeRange !== undefined || tagTerms.length > 0;

      if (shouldForceLexical) {
        logInfo("localSearch: Forcing lexical search (time range or tags present)");
        return await performLexicalSearch({
          app,
          timeRange,
          query,
          salientTerms,
          forceLexical: true,
          preExpandedQuery: _preExpandedQuery,
        });
      }

      const retrieverType = RetrieverFactory.getRetrieverType();
      logInfo(`localSearch: Using ${retrieverType} retriever via factory`);

      return await performLexicalSearch({
        app,
        timeRange,
        query,
        salientTerms,
        preExpandedQuery: _preExpandedQuery,
      });
    },
  });

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

const webSearchTool = createLangChainTool({
  name: "webSearch",
  description:
    "Search the INTERNET (NOT vault notes) when user explicitly asks for web/online information",
  schema: webSearchSchema,
  func: async ({ query, chatHistory }) => {
    try {
      const standaloneQuestion = await getStandaloneQuestion(query, chatHistory);

      let webContent: string;
      let citations: string[];

      if (isSelfHostModeValid() && hasSelfHostSearchKey()) {
        const result = await selfHostWebSearch(standaloneQuestion);
        webContent = result.content;
        citations = result.citations;
      } else {
        const response = await BrevilabsClient.getInstance().webSearch(standaloneQuestion);
        webContent = response.response.choices[0].message.content;
        citations = response.response.citations || [];
      }

      const formattedResults = [
        {
          type: "web_search",
          content: webContent,
          citations: citations,
          instruction: getWebSearchCitationInstructions(),
        },
      ];

      return formattedResults;
    } catch (error) {
      logError(`Error processing web search query ${query}:`, error);
      return { error: `Web search failed: ${error}` };
    }
  },
});

export { createLocalSearchTool, webSearchTool };
