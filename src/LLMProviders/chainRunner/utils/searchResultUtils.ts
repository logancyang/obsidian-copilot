import { logInfo, logWarn, logMarkdownBlock } from "@/logger";
import { sanitizeContentForCitations } from "@/LLMProviders/chainRunner/utils/citationUtils";

export interface SearchDoc {
  title?: string;
  path?: string;
  content?: string;
  mtime?: string | number;
  rerank_score?: number;
  score?: number;
  explanation?: unknown;
  includeInContext?: boolean;
  __sourceId?: string | number;
  collection_name?: string;
  source_id?: string | number;
  matchType?: string;
  source?: string;
  chunkId?: string;
}

interface QualitySummary {
  high: number;
  medium: number;
  low: number;
  total: number;
  averageScore: number;
}

export function generateQualitySummary(searchResults: SearchDoc[]): QualitySummary {
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

export function formatSearchResultsForLLM(searchResults: unknown): string {
  if (!Array.isArray(searchResults)) {
    return "";
  }

  const includedDocs = (searchResults as SearchDoc[]).filter(
    (doc) => doc.includeInContext !== false
  );

  if (includedDocs.length === 0) {
    return "No relevant documents found.";
  }

  const formattedDocs = includedDocs
    .map((doc, idx: number) => {
      const title = doc.title || "Untitled";
      const path = doc.path || "";
      const sourceId = doc.__sourceId || doc.collection_name || doc.source_id || idx + 1;

      let modified: string | null = null;
      if (doc.mtime) {
        const date = new Date(doc.mtime);
        if (!isNaN(date.getTime())) {
          modified = date.toISOString();
        }
      }

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

export function extractSourcesFromSearchResults(
  searchResults: unknown
): { title: string; path: string; score: number; explanation?: unknown }[] {
  if (!Array.isArray(searchResults)) {
    return [];
  }

  return (searchResults as SearchDoc[]).map((doc) => ({
    title: doc.title || doc.path || "Untitled",
    path: doc.path || doc.title || "",
    score: doc.rerank_score || doc.score || 0,
    explanation: doc.explanation || null,
  }));
}

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

function summarizeExplanation(explanation: unknown): string {
  if (!explanation) return "";

  const parts: string[] = [];
  const exp = explanation as Record<string, unknown>;

  try {
    if (Array.isArray(exp.lexicalMatches) && exp.lexicalMatches.length > 0) {
      const fields = new Set<string>();
      const terms = new Set<string>();
      for (const m of exp.lexicalMatches as Array<{ field?: unknown; query?: unknown }>) {
        if (typeof m?.field === "string") fields.add(m.field);
        if (typeof m?.query === "string") terms.add(m.query);
      }
      const fieldsStr = Array.from(fields).join("/");
      const termsStr = Array.from(terms).slice(0, 3).join(", ");
      parts.push(`Lexical(${fieldsStr}): ${termsStr}${terms.size > 3 ? ", ..." : ""}`);
    }

    if (typeof exp.semanticScore === "number" && exp.semanticScore > 0) {
      parts.push(`Semantic: ${(exp.semanticScore * 100).toFixed(1)}%`);
    }

    if (
      exp.folderBoost &&
      typeof (exp.folderBoost as { boostFactor?: number }).boostFactor === "number"
    ) {
      const fb = exp.folderBoost as { boostFactor: number; folder?: string };
      const folder = fb.folder || "root";
      parts.push(`Folder +${fb.boostFactor.toFixed(2)} (${folder})`);
    }

    if (exp.graphConnections && typeof exp.graphConnections === "object") {
      const gc = exp.graphConnections as {
        backlinks?: number;
        coCitations?: number;
        sharedTags?: number;
        score?: number;
      };
      const bits: string[] = [];
      if ((gc.backlinks ?? 0) > 0) bits.push(`${gc.backlinks} backlinks`);
      if ((gc.coCitations ?? 0) > 0) bits.push(`${gc.coCitations} co-cites`);
      if ((gc.sharedTags ?? 0) > 0) bits.push(`${gc.sharedTags} tags`);
      if (typeof gc.score === "number") {
        parts.push(`Graph ${gc.score.toFixed(1)}${bits.length ? ` (${bits.join(", ")})` : ""}`);
      } else if (bits.length) {
        parts.push(`Graph (${bits.join(", ")})`);
      }
    }

    if (
      exp.graphBoost &&
      typeof (exp.graphBoost as { boostFactor?: number }).boostFactor === "number" &&
      !exp.graphConnections
    ) {
      const gb = exp.graphBoost as { boostFactor: number; connections?: number };
      parts.push(`Graph +${gb.boostFactor.toFixed(2)} (${gb.connections} connections)`);
    }

    if (
      typeof exp.baseScore === "number" &&
      typeof exp.finalScore === "number" &&
      exp.baseScore !== exp.finalScore
    ) {
      parts.push(`Score: ${exp.baseScore.toFixed(4)}→${exp.finalScore.toFixed(4)}`);
    }
  } catch {
    // Ignore explanation parsing errors, leave parts as-is
  }

  return parts.join(" | ");
}

export function formatSplitSearchResultsForLLM(
  filterDocs: SearchDoc[],
  searchDocs: SearchDoc[],
  startId = 1
): string {
  let currentId = startId;
  const sections: string[] = [];

  if (filterDocs.length > 0) {
    const filterXml = filterDocs
      .map((doc) => {
        const id = doc.__sourceId || currentId++;
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

  if (searchDocs.length > 0) {
    const searchXml = searchDocs
      .map((doc) => {
        const id = doc.__sourceId || currentId++;
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

const FILTER_SOURCES = new Set(["time-filtered", "tag-match"]);

export function isFilterOnlyResults(docs: Array<{ source?: string }>): boolean {
  if (!Array.isArray(docs) || docs.length === 0) return false;
  return docs.every((doc) => doc.source != null && FILTER_SOURCES.has(doc.source));
}

export function isTimeDominantResults(docs: Array<{ source?: string }>): boolean {
  if (!Array.isArray(docs)) return false;
  return docs.some((doc) => doc.source === "time-filtered");
}

export function formatMetadataOnlyDocuments(docs: unknown, snippetLength = 300): string {
  if (!Array.isArray(docs) || docs.length === 0) {
    return "";
  }

  const fileElements = (docs as SearchDoc[])
    .map((doc) => {
      const title = doc.title || "Untitled";
      const path = doc.path || "";
      const modified = toIsoString(doc.mtime);
      const content = sanitizeContentForCitations(doc.content || "");
      const snippet = content.slice(0, snippetLength);

      const pathEl = path ? `\n<path>${path}</path>` : "";
      const modifiedEl = modified ? `\n<modified>${modified}</modified>` : "";
      const snippetEl = snippet ? `\n<snippet>${snippet}</snippet>` : "";

      return `<file>\n<title>${title}</title>${pathEl}${modifiedEl}${snippetEl}\n</file>`;
    })
    .join("\n");

  return `<additionalMatches count="${docs.length}" note="These results contain titles and metadata only. To read the full content of a note, call the readNote tool with its path.">\n${fileElements}\n</additionalMatches>`;
}

export function logSearchResultsDebugTable(searchResults: SearchDoc[]): void {
  if (!Array.isArray(searchResults) || searchResults.length === 0) {
    logInfo("Search Results: (none)");
    return;
  }

  type Row = {
    path: string;
    in: string;
    mtime: string;
    score: string;
    explanation: string;
  };

  let includedCount = 0;
  const rows: Row[] = searchResults.map((doc) => {
    const mtime = toIsoString(doc.mtime);
    const scoreNum = typeof doc.rerank_score === "number" ? doc.rerank_score : doc.score || 0;
    const score = (Number.isFinite(scoreNum) ? scoreNum : 0).toFixed(4);
    const path = doc.chunkId || doc.path || "";
    const explanation = summarizeExplanation(doc.explanation);
    const included = doc.includeInContext !== false;
    if (included) includedCount++;
    return {
      path,
      in: included ? "Y" : "",
      mtime,
      score,
      explanation,
    };
  });

  const total = rows.length;
  logInfo(`Search Results (debug table): ${total} rows; in-context ${includedCount}/${total}`);

  const esc = (s: string) => String(s || "").replace(/\|/g, "\\|");
  const mdHeader = `| PATH | IN | MTIME | SCORE | EXPLANATION |`;
  const mdSep = `| --- | :-: | --- | ---: | --- |`;
  const mdRows = rows.map(
    (r) => `| ${esc(r.path)} | ${r.in} | ${r.mtime || ""} | ${r.score} | ${esc(r.explanation)} |`
  );
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
