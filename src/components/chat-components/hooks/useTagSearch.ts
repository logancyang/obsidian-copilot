import { useMemo } from "react";
import fuzzysort from "fuzzysort";
import { useAllTags } from "./useAllTags";
import { TypeaheadOption } from "../TypeaheadMenuContent";

export interface TagSearchOption extends TypeaheadOption {
  tag: string;
}

/**
 * Configuration for tag search behavior
 */
export interface TagSearchConfig {
  /** Maximum number of results to return */
  limit?: number;
  /** Fuzzysort threshold for matching (-10000 = very lenient, 0 = exact match) */
  threshold?: number;
  /** Whether to include only frontmatter tags or all tags (defaults to false - includes all tags) */
  frontmatterOnly?: boolean;
}

const DEFAULT_CONFIG: Required<TagSearchConfig> = {
  limit: 10,
  threshold: -10000,
  frontmatterOnly: false,
};

/**
 * Unified hook for searching tags across all typeahead interfaces.
 * Ensures consistent search behavior and results between # and @ typeaheads.
 *
 * @param query - Search query string
 * @param config - Optional configuration for search behavior
 * @returns Array of TagSearchOption objects matching the query
 */
export function useTagSearch(query: string, config: TagSearchConfig = {}): TagSearchOption[] {
  const mergedConfig = useMemo(() => ({ ...DEFAULT_CONFIG, ...config }), [config]);

  // Get all available tags using the unified hook
  const allTags = useAllTags(mergedConfig.frontmatterOnly);

  // Transform tags into TagSearchOption objects
  const allTagOptions = useMemo(() => {
    return allTags.map((tag, index) => {
      // Remove # prefix for title display
      const titleTag = tag.startsWith("#") ? tag.slice(1) : tag;

      return {
        key: `tag-${titleTag}-${index}`,
        title: titleTag,
        subtitle: tag, // Show with # prefix in subtitle
        content: "", // Tags don't have preview content
        tag: titleTag, // Store without # prefix
      };
    });
  }, [allTags]);

  // Filter and search tags based on query
  const searchResults = useMemo(() => {
    // If no query, return first N tags
    if (!query.trim()) {
      return allTagOptions.slice(0, mergedConfig.limit);
    }

    const searchQuery = query.trim();

    // Search tag titles using fuzzysort with same algorithm as notes
    const results = fuzzysort.go(searchQuery, allTagOptions, {
      key: "title",
      limit: mergedConfig.limit,
      threshold: mergedConfig.threshold,
    });

    return results.map((result) => result.obj);
  }, [allTagOptions, query, mergedConfig]);

  return searchResults;
}
