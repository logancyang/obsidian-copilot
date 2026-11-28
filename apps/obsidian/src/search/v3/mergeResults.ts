import { Document } from "@langchain/core/documents";

export interface MergedSearchOutput {
  filterResults: Document[];
  searchResults: Document[];
}

export function mergeFilterAndSearchResults(
  filterDocs: Document[],
  searchDocs: Document[]
): MergedSearchOutput {
  const filterPaths = new Set<string>();
  for (const doc of filterDocs) {
    if (doc.metadata?.path) {
      filterPaths.add(doc.metadata.path as string);
    }
  }

  const dedupedSearchDocs = searchDocs.filter((doc) => {
    const docPath = doc.metadata?.path as string | undefined;
    return !docPath || !filterPaths.has(docPath);
  });

  return {
    filterResults: filterDocs,
    searchResults: dedupedSearchDocs,
  };
}
