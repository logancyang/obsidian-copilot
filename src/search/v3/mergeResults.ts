import { Document } from "@langchain/core/documents";

/**
 * Output of merging filter and search results.
 * Filter results are guaranteed-inclusion (title/tag/time matches).
 * Search results are scored BM25+/semantic hits, deduped against filter paths.
 */
export interface MergedSearchOutput {
  filterResults: Document[];
  searchResults: Document[];
}

/**
 * Merge filter (guaranteed-inclusion) documents with scored search documents.
 * Search docs from notes already covered by a filter doc are dropped.
 * Filter results are never removed.
 *
 * @param filterDocs - Guaranteed-inclusion documents from FilterRetriever
 * @param searchDocs - Scored documents from main search retriever
 * @returns Split output with separate filter and search arrays
 */
export function mergeFilterAndSearchResults(
  filterDocs: Document[],
  searchDocs: Document[]
): MergedSearchOutput {
  const filterPaths = new Set<string>();
  for (const doc of filterDocs) {
    if (doc.metadata?.path) {
      filterPaths.add(doc.metadata.path);
    }
  }

  const dedupedSearchDocs = searchDocs.filter((doc) => {
    const docPath = doc.metadata?.path;
    return !docPath || !filterPaths.has(docPath);
  });

  return {
    filterResults: filterDocs,
    searchResults: dedupedSearchDocs,
  };
}
