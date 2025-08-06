import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { logInfo, logWarn, logError } from "@/logger";

export interface QueryExpanderOptions {
  maxVariants?: number;
  timeout?: number;
  cacheSize?: number;
  getChatModel?: () => Promise<BaseChatModel | null>;
}

export interface ExpandedQuery {
  queries: string[]; // Original query + expanded variants
  salientTerms: string[]; // Unique important terms extracted from all queries
}

/**
 * Expands search queries using LLM to generate alternative phrasings
 * and extracts salient terms for improved search relevance.
 */
export class QueryExpander {
  private cache = new Map<string, ExpandedQuery>();

  private static readonly CONFIG = {
    MAX_VARIANTS: 2,
    TIMEOUT_MS: 500,
    MAX_CACHE_SIZE: 100,
    MIN_TERM_LENGTH: 2,
    PROMPT_TEMPLATE: `Generate alternative search queries and extract keywords for the following query:
"{query}"

Instructions:
- Generate {count} alternative search queries that capture the same intent
- Extract keywords ONLY from the ORIGINAL query above
- Keywords should be NOUNS or noun-like terms (things, concepts, topics, entities)
- Focus on the actual subject matter, not the action or intent
- EXCLUDE common action/intent verbs in ANY language such as:
  * English: find, search, get, locate, show, retrieve, etc.
  * Other languages: their equivalents (chercher, buscar, suchen, 查找, etc.)
- Include only content-bearing words that identify WHAT is being searched for
- Keep keywords in the SAME LANGUAGE as the original query
- Single words only, not phrases

Example: "find my piano notes" → Keywords: piano, notes (NOT: find, my)
Example: "search typescript interfaces" → Keywords: typescript, interfaces (NOT: search)
Example: "查找我的笔记" → Keywords: 笔记 (keep in Chinese)

Format your response using XML tags:
<queries>
<query>alternative query 1</query>
<query>alternative query 2</query>
</queries>
<terms>
<term>keyword1</term>
<term>keyword2</term>
<term>keyword3</term>
</terms>`,
  } as const;

  constructor(private readonly options: QueryExpanderOptions = {}) {}

  // Getters for configuration with defaults
  private get maxVariants(): number {
    return this.options.maxVariants ?? QueryExpander.CONFIG.MAX_VARIANTS;
  }

  private get timeout(): number {
    return this.options.timeout ?? QueryExpander.CONFIG.TIMEOUT_MS;
  }

  private get cacheSize(): number {
    return this.options.cacheSize ?? QueryExpander.CONFIG.MAX_CACHE_SIZE;
  }

  /**
   * Expands a search query into multiple variants and extracts salient terms.
   * Uses caching to avoid redundant LLM calls.
   * @param query - The original search query
   * @returns Expanded queries and salient terms extracted from the original query
   */
  async expand(query: string): Promise<ExpandedQuery> {
    // Check if query is valid
    if (!query?.trim()) {
      return { queries: [], salientTerms: [] };
    }

    // Check cache first
    const cached = this.cache.get(query);
    if (cached) {
      logInfo(`QueryExpander: Using cached expansion for "${query}"`);
      return cached;
    }

    try {
      // Expand with timeout protection
      const expanded = await this.expandWithTimeout(query);

      // Cache the result
      this.cacheResult(query, expanded);

      return expanded;
    } catch (error) {
      logWarn(`QueryExpander: Failed to expand query "${query}":`, error);
      // Fallback: extract terms from original query only
      return this.fallbackExpansion(query);
    }
  }

  /**
   * Expands query with timeout protection to prevent hanging on slow LLM responses.
   * @param query - The query to expand
   * @returns Expanded query or fallback if timeout is reached
   */
  private async expandWithTimeout(query: string): Promise<ExpandedQuery> {
    // Create timeout promise
    const timeoutPromise = new Promise<ExpandedQuery>((resolve) => {
      setTimeout(() => {
        logInfo(`QueryExpander: Timeout reached for "${query}"`);
        resolve(this.fallbackExpansion(query));
      }, this.timeout);
    });

    // Create expansion promise
    const expansionPromise = this.expandWithLLM(query);

    // Race between timeout and expansion
    return Promise.race([expansionPromise, timeoutPromise]);
  }

  /**
   * Performs the actual LLM call to expand the query.
   * @param query - The query to expand
   * @returns Expanded queries and extracted salient terms
   */
  private async expandWithLLM(query: string): Promise<ExpandedQuery> {
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

      const prompt = QueryExpander.CONFIG.PROMPT_TEMPLATE.replace(
        "{count}",
        this.maxVariants.toString()
      ).replace("{query}", query);

      const response = await model.invoke(prompt);
      const content = this.extractContent(response);

      if (!content) {
        return this.fallbackExpansion(query);
      }

      // Parse response using XML tags
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

  /**
   * Extracts text content from various LLM response formats.
   * @param response - The LLM response object or string
   * @returns The extracted text content or null if empty
   */
  private extractContent(response: any): string | null {
    // Elegant extraction with nullish coalescing
    return typeof response === "string"
      ? response
      : String(response?.content ?? response?.text ?? "").trim() || null;
  }

  /**
   * Parses XML-formatted LLM response to extract queries and terms.
   * Falls back to legacy format if XML tags are not found.
   * @param content - The LLM response content
   * @param originalQuery - The original query for fallback term extraction
   * @returns Parsed expanded queries and salient terms
   */
  private parseXMLResponse(content: string, originalQuery: string): ExpandedQuery {
    const queries: string[] = [originalQuery]; // Always include original
    const terms = new Set<string>();

    // Extract queries from XML tags
    const queryRegex = /<query>(.*?)<\/query>/g;
    let queryMatch;
    while ((queryMatch = queryRegex.exec(content)) !== null) {
      const query = queryMatch[1]?.trim();
      if (query && query !== originalQuery && queries.length <= this.maxVariants) {
        queries.push(query);
      }
    }

    // Extract terms from XML tags
    const termRegex = /<term>(.*?)<\/term>/g;
    let termMatch;
    while ((termMatch = termRegex.exec(content)) !== null) {
      const term = termMatch[1]?.trim().toLowerCase();
      if (term && this.isValidTerm(term)) {
        terms.add(term);
      }
    }

    // If no XML tags found, try legacy parsing
    if (queries.length === 1 && terms.size === 0) {
      return this.parseLegacyFormat(content, originalQuery);
    }

    // Also extract terms from the ORIGINAL query only (as fallback)
    const extractedTerms = this.extractTermsFromQueries([originalQuery]);
    extractedTerms.forEach((term) => {
      if (this.isValidTerm(term)) {
        terms.add(term);
      }
    });

    return {
      queries: queries.slice(0, this.maxVariants + 1), // +1 for original
      salientTerms: Array.from(terms),
    };
  }

  /**
   * Parses legacy non-XML format responses for backward compatibility.
   * @param content - The LLM response content
   * @param originalQuery - The original query
   * @returns Parsed expanded queries and salient terms
   */
  private parseLegacyFormat(content: string, originalQuery: string): ExpandedQuery {
    // Fallback parser for non-XML responses
    const lines = content.split("\n").map((line) => line.trim());
    const queries: string[] = [originalQuery];
    const terms = new Set<string>();

    let section: "queries" | "terms" | null = null;

    for (const line of lines) {
      if (!line || line === "") continue;

      // Detect section headers
      if (line.toUpperCase().includes("QUERIES")) {
        section = "queries";
        continue;
      }
      if (line.toUpperCase().includes("TERMS") || line.toUpperCase().includes("KEYWORDS")) {
        section = "terms";
        continue;
      }

      // Parse content based on current section
      if (section === "queries" && queries.length <= this.maxVariants) {
        const cleanQuery = line.replace(/^[-•*\d.)\s]+/, "").trim();
        if (cleanQuery && cleanQuery !== originalQuery) {
          queries.push(cleanQuery);
        }
      } else if (section === "terms") {
        const cleanTerm = line
          .replace(/^[-•*\d.)\s]+/, "")
          .trim()
          .toLowerCase();
        if (cleanTerm && this.isValidTerm(cleanTerm)) {
          terms.add(cleanTerm);
        }
      }
    }

    // If no sections found, treat lines as queries
    if (queries.length === 1 && terms.size === 0) {
      for (const line of lines.slice(0, this.maxVariants)) {
        if (line && !line.toUpperCase().includes("QUERY")) {
          queries.push(line);
        }
      }
    }

    // Extract terms from ORIGINAL query only
    const extractedTerms = this.extractTermsFromQueries([originalQuery]);
    extractedTerms.forEach((term) => terms.add(term));

    return {
      queries: queries.slice(0, this.maxVariants + 1),
      salientTerms: Array.from(terms),
    };
  }

  /**
   * Provides a fallback expansion when LLM is unavailable or fails.
   * Extracts terms directly from the original query.
   * @param query - The original query
   * @returns Fallback expansion with original query and extracted terms
   */
  private fallbackExpansion(query: string): ExpandedQuery {
    // Simple fallback: extract terms from the original query
    const terms = this.extractTermsFromQueries([query]);
    return {
      queries: [query],
      salientTerms: terms,
    };
  }

  /**
   * Extracts individual terms from queries by splitting and filtering.
   * Handles hyphenated words by extracting both compound and component terms.
   * @param queries - Array of queries to extract terms from
   * @returns Array of unique valid terms
   */
  private extractTermsFromQueries(queries: string[]): string[] {
    const terms = new Set<string>();

    for (const query of queries) {
      // Split on common delimiters and spaces
      const words = query
        .toLowerCase()
        .replace(/[^\w\s-]/g, " ") // Replace punctuation with spaces
        .split(/\s+/);

      for (const word of words) {
        if (this.isValidTerm(word)) {
          terms.add(word);

          // Also add compound terms split by hyphens
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

  /**
   * Validates if a term should be included in salient terms.
   * Filters out terms that are too short or contain only special characters.
   * @param term - The term to validate
   * @returns true if the term is valid for inclusion
   */
  private isValidTerm(term: string): boolean {
    return (
      term.length >= QueryExpander.CONFIG.MIN_TERM_LENGTH && /^[\w-]+$/.test(term) // Allow word characters and hyphens
    );
  }

  /**
   * Caches an expansion result with simple LRU eviction.
   * @param query - The original query as cache key
   * @param expanded - The expansion result to cache
   */
  private cacheResult(query: string, expanded: ExpandedQuery): void {
    // Map maintains insertion order for simple LRU
    if (this.cache.size >= this.cacheSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(query, expanded);
  }

  /**
   * Clears all cached query expansions.
   */
  clearCache(): void {
    this.cache.clear();
    logInfo("QueryExpander: Cache cleared");
  }

  /**
   * Gets the current number of cached expansions.
   * @returns The size of the cache
   */
  getCacheSize(): number {
    return this.cache.size;
  }

  /**
   * Backward compatibility method that returns only expanded queries.
   * @deprecated Use expand() instead for both queries and terms
   * @param query - The query to expand
   * @returns Array of expanded query strings
   */
  async expandQueries(query: string): Promise<string[]> {
    const result = await this.expand(query);
    return result.queries;
  }
}
