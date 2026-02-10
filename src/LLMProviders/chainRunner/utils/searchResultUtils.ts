import { logInfo, logWarn, logMarkdownBlock, logTable } from "@/logger";

/**
 * Quality summary for search results.
 * Helps the LLM evaluate whether results are adequate or if re-search is needed.
 */
export interface QualitySummary {
  high: number; // Count of results with score >= 0.7
  medium: number; // Count of results with score >= 0.3 and < 0.7
  low: number; // Count of results with score < 0.3
  total: number;
  averageScore: number;
}

/**
 * Generate a quality summary for search results.
 * This helps the LLM evaluate whether the results are relevant enough.
 *
 * @param searchResults - Array of search results with scores
 * @returns Quality summary with counts by relevance tier
 */
export function generateQualitySummary(searchResults: any[]): QualitySummary {
  if (!Array.isArray(searchResults) || searchResults.length === 0) {
    return { high: 0, medium: 0, low: 0, total: 0, averageScore: 0 };
  }

  let high = 0;
  let medium = 0;
  let low = 0;
  let totalScore = 0;

  for (const doc of searchResults) {
    const score = doc.rerank_score ?? doc.score ?? 0;
    totalScore += score;

    if (score >= 0.7) {
      high++;
    } else if (score >= 0.3) {
      medium++;
    } else {
      low++;
    }
  }

  return {
    high,
    medium,
    low,
    total: searchResults.length,
    averageScore: totalScore / searchResults.length,
  };
}

/**
 * Format quality summary as a concise string for LLM context.
 *
 * @param summary - Quality summary from generateQualitySummary
 * @returns Formatted string like "[Relevance: 3 high, 2 medium, 1 low]"
 */
export function formatQualitySummary(summary: QualitySummary): string {
  const parts: string[] = [];
  if (summary.high > 0) parts.push(`${summary.high} high`);
  if (summary.medium > 0) parts.push(`${summary.medium} medium`);
  if (summary.low > 0) parts.push(`${summary.low} low`);

  if (parts.length === 0) {
    return "[Relevance: no results]";
  }

  return `[Relevance: ${parts.join(", ")}]`;
}

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
    .map((doc: any, idx: number) => {
      const title = doc.title || "Untitled";
      const path = doc.path || "";
      // Optional stable source id if provided by caller; fallback to order
      const sourceId = (doc as any).__sourceId || (doc as any).source_id || idx + 1;

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
<id>${sourceId}</id>
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

/**
 * Convert a timestamp value to an ISO string if valid.
 * Accepts milliseconds since epoch or ISO string; returns "" if not parseable.
 */
function toIsoString(ts: unknown): string {
  if (typeof ts === "number") {
    const d = new Date(ts);
    return isNaN(d.getTime()) ? "" : d.toISOString();
  }
  if (typeof ts === "string") {
    const d = new Date(ts);
    return isNaN(d.getTime()) ? "" : d.toISOString();
  }
  return "";
}

/**
 * Create a concise, single-line summary of an explanation object.
 * Includes lexical matches, semantic score, folder/graph boosts, and score adjustments.
 */
export function summarizeExplanation(explanation: any): string {
  if (!explanation) return "";

  const parts: string[] = [];

  try {
    // Lexical matches summary
    if (Array.isArray(explanation.lexicalMatches) && explanation.lexicalMatches.length > 0) {
      const fields = new Set<string>();
      const terms = new Set<string>();
      for (const m of explanation.lexicalMatches) {
        if (m?.field) fields.add(String(m.field));
        if (m?.query) terms.add(String(m.query));
      }
      const fieldsStr = Array.from(fields).join("/");
      const termsStr = Array.from(terms).slice(0, 3).join(", ");
      parts.push(`Lexical(${fieldsStr}): ${termsStr}${terms.size > 3 ? ", ..." : ""}`);
    }

    // Semantic score
    if (typeof explanation.semanticScore === "number" && explanation.semanticScore > 0) {
      parts.push(`Semantic: ${(explanation.semanticScore * 100).toFixed(1)}%`);
    }

    // Folder boost
    if (explanation.folderBoost && typeof explanation.folderBoost.boostFactor === "number") {
      const fb = explanation.folderBoost;
      const folder = fb.folder || "root";
      parts.push(`Folder +${fb.boostFactor.toFixed(2)} (${folder})`);
    }

    // Graph connections (query-aware boost)
    if (explanation.graphConnections && typeof explanation.graphConnections === "object") {
      const gc = explanation.graphConnections;
      const bits: string[] = [];
      if (gc.backlinks > 0) bits.push(`${gc.backlinks} backlinks`);
      if (gc.coCitations > 0) bits.push(`${gc.coCitations} co-cites`);
      if (gc.sharedTags > 0) bits.push(`${gc.sharedTags} tags`);
      if (typeof gc.score === "number") {
        parts.push(`Graph ${gc.score.toFixed(1)}${bits.length ? ` (${bits.join(", ")})` : ""}`);
      } else if (bits.length) {
        parts.push(`Graph (${bits.join(", ")})`);
      }
    }

    // Legacy graph boost
    if (
      explanation.graphBoost &&
      typeof explanation.graphBoost.boostFactor === "number" &&
      !explanation.graphConnections
    ) {
      const gb = explanation.graphBoost;
      parts.push(`Graph +${gb.boostFactor.toFixed(2)} (${gb.connections} connections)`);
    }

    // Score adjustment
    if (
      typeof explanation.baseScore === "number" &&
      typeof explanation.finalScore === "number" &&
      explanation.baseScore !== explanation.finalScore
    ) {
      parts.push(`Score: ${explanation.baseScore.toFixed(4)}→${explanation.finalScore.toFixed(4)}`);
    }
  } catch {
    // Ignore explanation parsing errors, leave parts as-is
  }

  return parts.join(" | ");
}

/**
 * Logs a formatted table of search results with explanation for debugging.
 * Each row includes index, chunk id or path, title, ctime, mtime, score, and explanation summary.
 *
 * Example output:
 *   # | CHUNK/PATH                              | TITLE        | CTIME                | MTIME                | SCORE  | EXPLANATION
 *   1 | notes/file.md#3                         | File         | 2024-09-01T...      | 2024-09-10T...      | 0.8123 | Lexical(body): term1, term2 | Graph 2.0 (3 backlinks)
 */
/**
 * Formats split filter/search results as XML for LLM consumption.
 * Filter results get a `<matchType>` element; search results get `<modified>`.
 * Both use continuous `<id>` numbering across sections and are nested inside `<localSearch>`.
 *
 * @param filterDocs - Guaranteed-inclusion documents (title/tag/time matches)
 * @param searchDocs - Scored search results
 * @param startId - Starting ID for continuous numbering (default 1)
 * @returns Formatted XML string with `<filterResults>` and `<searchResults>` sections
 */
export function formatSplitSearchResultsForLLM(
  filterDocs: any[],
  searchDocs: any[],
  startId = 1
): string {
  let currentId = startId;
  const sections: string[] = [];

  // Format filter results
  if (filterDocs.length > 0) {
    const filterXml = filterDocs
      .map((doc: any) => {
        const id = (doc as any).__sourceId || currentId++;
        const title = doc.title || "Untitled";
        const path = doc.path || "";
        const matchType = doc.matchType || doc.source || "filter";
        const modified = toIsoString(doc.mtime);

        return `<document>
<id>${id}</id>
<title>${title}</title>
<path>${path}</path>
<matchType>${matchType}</matchType>${modified ? `\n<modified>${modified}</modified>` : ""}
<content>
${doc.content || ""}
</content>
</document>`;
      })
      .join("\n\n");

    sections.push(`<filterResults>\n${filterXml}\n</filterResults>`);
  }

  // Format search results
  if (searchDocs.length > 0) {
    const searchXml = searchDocs
      .map((doc: any) => {
        const id = (doc as any).__sourceId || currentId++;
        const title = doc.title || "Untitled";
        const path = doc.path || "";
        const modified = toIsoString(doc.mtime);

        return `<document>
<id>${id}</id>
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
      .join("\n\n");

    sections.push(`<searchResults>\n${searchXml}\n</searchResults>`);
  }

  if (sections.length === 0) {
    return "No relevant documents found.";
  }

  return sections.join("\n\n");
}

export function logSearchResultsDebugTable(searchResults: any[]): void {
  if (!Array.isArray(searchResults) || searchResults.length === 0) {
    logInfo("Search Results: (none)");
    return;
  }

  type Row = {
    idx: string;
    in: string;
    path: string;
    mtime: string;
    score: string;
    explanation: string;
  };

  let includedCount = 0;
  const rows: Row[] = searchResults.map((doc: any, i: number) => {
    const mtime = toIsoString(doc.mtime);
    const scoreNum = typeof doc.rerank_score === "number" ? doc.rerank_score : doc.score || 0;
    const score = (Number.isFinite(scoreNum) ? scoreNum : 0).toFixed(4);
    const path = doc.chunkId || doc.path || "";
    const explanation = summarizeExplanation(doc.explanation);
    const included = doc.includeInContext !== false;
    if (included) includedCount++;
    return {
      idx: String(i + 1),
      in: included ? "Y" : "",
      path,
      mtime,
      score,
      explanation,
    };
  });

  // No ASCII table in logs; we output console.table and Markdown below

  const total = rows.length;
  // Log as a proper dev console table first (best visual fidelity in DevTools)
  logInfo(`Search Results (debug table): ${total} rows; in-context ${includedCount}/${total}`);
  logTable(rows, ["idx", "in", "path", "mtime", "score", "explanation"]);

  // Intentionally avoid dumping ASCII multi-line into the log file (it would be sanitized to \n)

  // Also write a Markdown table to the rolling log file so it renders in Obsidian
  // Escape pipe characters in explanation/path to prevent column breaks
  const esc = (s: string) => String(s || "").replace(/\|/g, "\\|");
  const mdHeader = `| # | IN | PATH | MTIME | SCORE | EXPLANATION |`;
  const mdSep = `| ---: | :-: | --- | --- | ---: | --- |`;
  const mdRows = rows.map(
    (r) =>
      `| ${r.idx} | ${r.in} | ${esc(r.path)} | ${r.mtime || ""} | ${r.score} | ${esc(r.explanation)} |`
  );
  // Surround with blank lines to ensure proper table block rendering
  logMarkdownBlock([
    "",
    `Results: ${total} rows; in-context ${includedCount}/${total}`,
    "",
    mdHeader,
    mdSep,
    ...mdRows,
    "",
  ]);
}
