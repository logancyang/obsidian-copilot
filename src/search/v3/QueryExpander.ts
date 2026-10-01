import { LLM_TIMEOUT_MS } from "@/constants";
import { TimeoutError } from "@/error";
import { logError, logInfo, logWarn } from "@/logger";
import { extractTagsFromQuery } from "@/search/v3/utils/tagUtils";
import { withSuppressedTokenWarnings, withTimeout } from "@/utils";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";

export interface QueryExpanderOptions {
  maxVariants?: number;
  timeout?: number;
  cacheSize?: number;
  getChatModel?: () => Promise<BaseChatModel | null>;
}

export interface ExpandedQuery {
  queries: string[];
  salientTerms: string[];
  originalQuery: string;
  expandedQueries: string[];
}

export class QueryExpander {
  private cache = new Map<string, ExpandedQuery>();
  private readonly config;

  private static readonly PROMPT_TEMPLATE = `Analyze this search query and provide:
1. SALIENT TERMS from the original query (for ranking)
2. Alternative queries and related terms (for finding more results)

Query: "{query}"

Instructions:

SALIENT TERMS (for ranking - ONLY from original query):
- Extract meaningful words FROM THE ORIGINAL QUERY ONLY
- Include: nouns, proper nouns, technical terms, domain concepts
- Exclude: action verbs (find, search, get), pronouns (my, your), articles (the, a), prepositions (in, on, for), conjunctions (and, or)
- These terms determine search ranking - must be from original query

ALTERNATIVE QUERIES (for recall - specific alternative phrasings):
- Alternative phrasings of the query (specific enough to be useful for search)

Example: "find my piano notes"
- Salient (from original): piano, notes
- Queries: "piano lesson notes", "piano practice sheets"

Example: "查找我的学习笔记"
- Salient (from original): 学习, 笔记
- Queries: "个人笔记文档"

Format:
<salient>
<term>word_from_original_query</term>
</salient>
<queries>
<query>alternative query</query>
</queries>`;

  constructor(private readonly options: QueryExpanderOptions = {}) {
    this.config = {
      maxVariants: options.maxVariants ?? 2,
      timeout: options.timeout ?? LLM_TIMEOUT_MS,
      cacheSize: options.cacheSize ?? 100,
      minTermLength: 2,
    };
  }

  async expand(query: string): Promise<ExpandedQuery> {
    if (!query?.trim()) {
      return {
        queries: [],
        salientTerms: [],
        originalQuery: "",
        expandedQueries: [],
      };
    }

    const cached = this.cache.get(query);
    if (cached) {
      this.cache.delete(query);
      this.cache.set(query, cached);
      logInfo(`QueryExpander: Using cached expansion for "${query}"`);
      return cached;
    }

    try {
      const expanded = await this.expandWithTimeout(query);

      this.cacheResult(query, expanded);

      return expanded;
    } catch (error) {
      logWarn(`QueryExpander: Failed to expand query "${query}":`, error);
      return this.fallbackExpansion(query);
    }
  }

  private async expandWithTimeout(query: string): Promise<ExpandedQuery> {
    try {
      return await withTimeout(
        (signal) => this.expandWithLLM(query, signal),
        this.config.timeout,
        "Query expansion"
      );
    } catch (error: unknown) {
      if (error instanceof TimeoutError) {
        logInfo(`QueryExpander: Timeout reached for "${query}"`);
        return this.fallbackExpansion(query);
      }
      throw error;
    }
  }

  private async expandWithLLM(query: string, signal?: AbortSignal): Promise<ExpandedQuery> {
    try {
      if (!this.options.getChatModel) {
        logInfo("QueryExpander: No chat model getter provided");
        return this.fallbackExpansion(query);
      }

      const model = await this.options.getChatModel();
      if (!model) {
        logInfo("QueryExpander: No chat model available");
        return this.fallbackExpansion(query);
      }

      const prompt = QueryExpander.PROMPT_TEMPLATE.replace(
        "{count}",
        this.config.maxVariants.toString()
      ).replace("{query}", query);

      const response = await withSuppressedTokenWarnings(async () => {
        return await model.invoke(prompt, signal ? { signal } : undefined);
      });

      if (!response) {
        return this.fallbackExpansion(query);
      }

      const content = this.extractContent(response);

      if (!content) {
        return this.fallbackExpansion(query);
      }

      const parsed = this.parseXMLResponse(content, query);

      logInfo(
        `QueryExpander: Expanded "${query}" to ${parsed.queries.length} queries and ${parsed.salientTerms.length} terms`
      );
      return parsed;
    } catch (error) {
      logError("QueryExpander: LLM expansion failed:", error);
      return this.fallbackExpansion(query);
    }
  }

  private extractContent(response: unknown): string | null {
    const typed = response as { content?: unknown; text?: unknown } | null | undefined;
    const extracted = typed?.content ?? typed?.text ?? "";
    return typeof response === "string"
      ? response
      : (typeof extracted === "string"
          ? extracted
          : typeof extracted === "number"
            ? String(extracted)
            : ""
        ).trim() || null;
  }

  private extractSalientTermsFromOriginal(originalQuery: string): string[] {
    const baseTerms = this.extractTermsFromQueries([originalQuery]);
    const tagTerms = extractTagsFromQuery(originalQuery);
    return this.combineBaseAndTagTerms(baseTerms, tagTerms, originalQuery);
  }

  private parseXMLResponse(content: string, originalQuery: string): ExpandedQuery {
    const queries: string[] = [originalQuery];
    const salientFromLLM = new Set<string>();

    const queryRegex = /<query>(.*?)<\/query>/g;
    let queryMatch;
    while ((queryMatch = queryRegex.exec(content)) !== null) {
      const query = queryMatch[1]?.trim();
      if (query && query !== originalQuery && queries.length <= this.config.maxVariants) {
        queries.push(query);
      }
    }

    const salientSection = content.match(/<salient>([\s\S]*?)<\/salient>/);
    if (salientSection) {
      const termRegex = /<term>(.*?)<\/term>/g;
      let termMatch;
      while ((termMatch = termRegex.exec(salientSection[1])) !== null) {
        const term = termMatch[1]?.trim().toLowerCase();
        if (term && this.isValidTerm(term)) {
          salientFromLLM.add(term);
        }
      }
    }

    const hasXMLContent = queries.length > 1 || salientFromLLM.size > 0 || /<term>/.test(content);

    if (!hasXMLContent) {
      return this.fallbackExpansion(originalQuery);
    }

    const tagTerms = extractTagsFromQuery(originalQuery);
    const salientTerms =
      salientFromLLM.size > 0
        ? Array.from(new Set([...salientFromLLM, ...tagTerms]))
        : this.extractSalientTermsFromOriginal(originalQuery);

    const expandedQueries = queries.slice(1);
    return {
      queries: queries.slice(0, this.config.maxVariants + 1),
      salientTerms: salientTerms,
      originalQuery: originalQuery,
      expandedQueries: expandedQueries.slice(0, this.config.maxVariants),
    };
  }

  private fallbackExpansion(query: string): ExpandedQuery {
    const baseTerms = this.extractTermsFromQueries([query]);
    const tagTerms = extractTagsFromQuery(query);
    const terms = this.combineBaseAndTagTerms(baseTerms, tagTerms, query);

    return {
      queries: [query],
      salientTerms: terms,
      originalQuery: query,
      expandedQueries: [],
    };
  }

  private extractTermsFromQueries(queries: string[]): string[] {
    const terms = new Set<string>();

    for (const query of queries) {
      const words = query
        .toLowerCase()
        .replace(/[^\w\s-]/g, " ")
        .split(/\s+/);

      for (const word of words) {
        if (this.isValidTerm(word)) {
          terms.add(word);

          if (word.includes("-")) {
            word.split("-").forEach((part) => {
              if (this.isValidTerm(part)) {
                terms.add(part);
              }
            });
          }
        }
      }
    }

    return Array.from(terms);
  }

  private isValidTerm(term: string): boolean {
    if (term.length < this.config.minTermLength) {
      return false;
    }

    if (term.startsWith("#")) {
      try {
        return /^#[\p{L}\p{N}_/-]+$/u.test(term);
      } catch {
        return /^#[A-Za-z0-9_/-]+$/.test(term);
      }
    }

    try {
      return /^[\p{L}\p{N}_-]+$/u.test(term);
    } catch {
      return /^[A-Za-z0-9_-]+$/.test(term);
    }
  }

  private combineBaseAndTagTerms(
    baseTerms: string[],
    tagTerms: string[],
    originalQuery: string
  ): string[] {
    const combined = new Set<string>([...baseTerms, ...tagTerms]);

    if (tagTerms.length === 0) {
      return Array.from(combined);
    }

    const standaloneTerms = this.collectStandaloneTerms(originalQuery);

    for (const tag of tagTerms) {
      const withoutHash = tag.slice(1);
      if (withoutHash.length > 0 && !standaloneTerms.has(withoutHash)) {
        combined.delete(withoutHash);
      }
    }

    return Array.from(combined);
  }

  private collectStandaloneTerms(originalQuery: string): Set<string> {
    const standaloneTerms = new Set<string>();

    if (!originalQuery) {
      return standaloneTerms;
    }

    const normalizedQuery = originalQuery.toLowerCase();
    const tagRanges = this.findTagRanges(normalizedQuery);

    const wordPatterns = [/[\p{L}\p{N}_-]+/gu, /[a-z0-9_-]+/g];

    for (const pattern of wordPatterns) {
      try {
        for (const match of normalizedQuery.matchAll(pattern)) {
          if (match.index === undefined) {
            continue;
          }

          const start = match.index;
          const end = start + match[0].length;
          const insideTag = tagRanges.some(
            ({ start: tagStart, end: tagEnd }) => start >= tagStart && end <= tagEnd
          );

          if (insideTag) {
            continue;
          }

          const candidate = match[0];
          if (this.isValidTerm(candidate) && !candidate.startsWith("#")) {
            standaloneTerms.add(candidate);

            if (candidate.includes("-")) {
              candidate.split("-").forEach((part) => {
                if (this.isValidTerm(part) && !part.startsWith("#")) {
                  standaloneTerms.add(part);
                }
              });
            }
          }
        }
        break;
      } catch {
        continue;
      }
    }

    return standaloneTerms;
  }

  private findTagRanges(normalizedQuery: string): Array<{ start: number; end: number }> {
    const ranges: Array<{ start: number; end: number }> = [];
    const tagPatterns = [/#[\p{L}\p{N}_/-]+/gu, /#[a-z0-9_/-]+/g];

    for (const pattern of tagPatterns) {
      try {
        for (const match of normalizedQuery.matchAll(pattern)) {
          if (match.index === undefined) {
            continue;
          }

          ranges.push({
            start: match.index,
            end: match.index + match[0].length,
          });
        }
        break;
      } catch {
        continue;
      }
    }

    return ranges;
  }

  private cacheResult(query: string, expanded: ExpandedQuery): void {
    if (this.cache.size >= this.config.cacheSize) {
      const firstKey: string | undefined = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(query, expanded);
  }
}
