import { useMemo } from "react";
import fuzzysort from "fuzzysort";
import { useAllTags } from "./useAllTags";
import { TypeaheadOption } from "@/components/chat-components/TypeaheadMenuContent";

export interface TagSearchOption extends TypeaheadOption {
  tag: string;
}

export interface TagSearchConfig {
  limit?: number;
  threshold?: number;
  frontmatterOnly?: boolean;
}

const DEFAULT_CONFIG: Required<TagSearchConfig> = {
  limit: 10,
  threshold: -10000,
  frontmatterOnly: false,
};

export function useTagSearch(query: string, config: TagSearchConfig = {}): TagSearchOption[] {
  const mergedConfig = useMemo(() => ({ ...DEFAULT_CONFIG, ...config }), [config]);

  const allTags = useAllTags(mergedConfig.frontmatterOnly);

  const allTagOptions = useMemo(() => {
    return allTags.map((tag, index) => {
      const tagWithoutHash = tag.startsWith("#") ? tag.slice(1) : tag;

      return {
        key: `tag-${tagWithoutHash}-${index}`,
        title: tag,
        subtitle: undefined,
        content: "",
        tag: tagWithoutHash,
      };
    });
  }, [allTags]);

  const searchResults = useMemo(() => {
    if (!query.trim()) {
      return allTagOptions.slice(0, mergedConfig.limit);
    }

    const searchQuery = query.trim();

    const results = fuzzysort.go(searchQuery, allTagOptions, {
      key: "title",
      limit: mergedConfig.limit,
      threshold: mergedConfig.threshold,
    });

    return results.map((result) => result.obj);
  }, [allTagOptions, query, mergedConfig]);

  return searchResults;
}
