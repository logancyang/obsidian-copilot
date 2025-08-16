import { logWarn } from "@/logger";

/**
 * Formats localSearch results as structured text for LLM consumption
 * Includes essential metadata (title, path, mtime) while excluding unnecessary fields
 * @param searchResults - The raw search results from localSearch tool
 * @returns Formatted text string for LLM
 */
export function formatSearchResultsForLLM(searchResults: any[]): string {
  if (!Array.isArray(searchResults)) {
    return "";
  }

  // Filter documents that should be included in context
  const includedDocs = searchResults.filter((doc) => doc.includeInContext !== false);

  if (includedDocs.length === 0) {
    return "No relevant documents found.";
  }

  // Format each document with essential metadata
  const formattedDocs = includedDocs
    .map((doc: any) => {
      const title = doc.title || "Untitled";
      const path = doc.path || "";

      // Safely handle mtime - check validity before converting
      let modified: string | null = null;
      if (doc.mtime) {
        const date = new Date(doc.mtime);
        if (!isNaN(date.getTime())) {
          modified = date.toISOString();
        }
      }

      // Use template literal for cleaner XML generation
      return `<document>
<title>${title}</title>${
        path && path !== title
          ? `
<path>${path}</path>`
          : ""
      }${
        modified
          ? `
<modified>${modified}</modified>`
          : ""
      }
<content>
${doc.content || ""}
</content>
</document>`;
    })
    .filter((content) => content.length > 0);

  return formattedDocs.join("\n\n");
}

/**
 * Formats a localSearch result string for LLM consumption
 * @param resultString - The JSON string result from localSearch tool
 * @returns Formatted text string for LLM, or error message if parsing fails
 */
export function formatSearchResultStringForLLM(resultString: string): string {
  try {
    const searchResults = JSON.parse(resultString);
    if (!Array.isArray(searchResults)) {
      return "Invalid search results format.";
    }

    return formatSearchResultsForLLM(searchResults);
  } catch (error) {
    logWarn("Failed to format localSearch result string:", error);
    return "Error processing search results.";
  }
}

/**
 * Extracts sources with explanation from localSearch results for UI display
 * @param searchResults - The raw search results from localSearch tool
 * @returns Sources array with explanation preserved for UI
 */
export function extractSourcesFromSearchResults(
  searchResults: any[]
): { title: string; path: string; score: number; explanation?: any }[] {
  if (!Array.isArray(searchResults)) {
    return [];
  }

  return searchResults.map((doc: any) => ({
    title: doc.title || doc.path || "Untitled",
    path: doc.path || doc.title || "",
    score: doc.rerank_score || doc.score || 0,
    explanation: doc.explanation || null,
  }));
}
