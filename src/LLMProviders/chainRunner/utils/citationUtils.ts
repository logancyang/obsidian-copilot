/**
 * Citation utilities for consistent citation behavior across the application.
 * Handles citation rules, content sanitization, and source formatting.
 */

// ===== CITATION RULES =====

export const CITATION_RULES = `CITATION RULES:
1. START with [^1] and increment sequentially ([^1], [^2], [^3], etc.) with NO gaps
2. BE SELECTIVE: ONLY cite when introducing NEW factual claims, specific data, or direct quotes from sources
3. IMPORTANT: Do NOT cite every sentence or bullet point. This creates clutter and poor readability.
4. DO NOT cite for:
   - General knowledge or common facts
   - Your own analysis or synthesis
   - Transitional or concluding statements
   - Every single sentence (AVOID CITATION CLUTTER - aim for 1-3 citations per paragraph maximum)
5. Citations are for SOURCE ATTRIBUTION, not for proving every statement
6. GOOD: One citation per key concept. BAD: Citation after every sentence.
7. Place citations immediately after the specific claim: "The study found X [^1]" not "The study found X. [^1]"
8. Do not reuse any bracketed numbers that appear inside the source content itself
9. If multiple source chunks come from the same document, cite each relevant chunk separately (e.g., [^1] and [^2] can both be from the same document title)
10. End with '#### Sources' section containing: [^n]: [[Title]] (one per line, matching citation order)`;

export const WEB_CITATION_RULES = `WEB CITATION RULES:
1. START with [^1] and increment sequentially ([^1], [^2], [^3], etc.) with NO gaps
2. Cite ONLY when introducing new factual claims, statistics, or direct quotes from the search results
3. After every cited claim, place the corresponding footnote immediately after the sentence ("The study found X [^1]")
4. End with '#### Sources' and provide definitions EXACTLY in this format: [^n]: [Short Title](URL)

IMPORTANT: Each source definition must follow this exact pattern:
- Start with [^n]: (where n is the citation number)
- Follow with [Title](URL) where Title is SHORT (2-5 words) and wrapped in square brackets
- Example: [^1]: [Paul Graham Essay](https://paulgraham.com/wealth.html)
- DO NOT write long descriptions - keep titles concise`;

// ===== INSTRUCTION GENERATORS =====

/**
 * Generates citation instructions with source catalog for vault searches.
 */
export function getVaultCitationGuidance(sourceCatalog: string[]): string {
  return `

<guidance>
${CITATION_RULES}

Source Catalog (for reference only):
${sourceCatalog.join("\n")}
</guidance>`;
}

/**
 * Generates citation instructions for QA contexts.
 */
export function getQACitationInstructions(sourceCatalog: string): string {
  return `

${CITATION_RULES}

Source Catalog (for reference only):
${sourceCatalog}`;
}

// ===== CONSTANTS =====

const MAX_FALLBACK_SOURCES = 20;

// ===== CENTRALIZED CITATION CONTROL =====

/**
 * Gets appropriate citation instructions based on settings.
 * Returns empty string if citations are disabled.
 */
export function getCitationInstructions(
  enableInlineCitations: boolean,
  sourceCatalog: string[]
): string {
  if (!enableInlineCitations) {
    return "";
  }
  return getVaultCitationGuidance(sourceCatalog);
}

/**
 * Gets QA citation instructions based on settings.
 * Returns empty string if citations are disabled.
 */
export function getQACitationInstructionsConditional(
  enableInlineCitations: boolean,
  sourceCatalog: string
): string {
  if (!enableInlineCitations) {
    return "";
  }
  return getQACitationInstructions(sourceCatalog);
}

/**
 * Adds fallback sources to response if citations are missing and citations are enabled.
 */
export function addFallbackSources(
  response: string,
  sources: { title?: string; path?: string }[],
  enableInlineCitations: boolean
): string {
  // Input validation
  if (!enableInlineCitations || !sources?.length || !response) {
    return response || "";
  }

  if (hasExistingCitations(response)) {
    return response;
  }

  // Add simple sources section as fallback
  const sourcesList = sources
    .slice(0, MAX_FALLBACK_SOURCES)
    .map((s, i) => {
      const title = (s.title || s.path || "Untitled").replace(/^\[\[|\]\]$/g, ""); // Strip existing wiki link brackets
      return `[^${i + 1}]: [[${title}]]`;
    })
    .join("\n");

  return `${response}\n\n#### Sources:\n\n${sourcesList}`;
}

// ===== CONTENT PROCESSING =====

/**
 * Sanitizes content to remove pre-existing citation markers to prevent number leakage.
 */
export function sanitizeContentForCitations(text: string): string {
  if (!text) return "";

  // Remove inline footnote refs like [^12]
  let out = text.replace(/\[\^\d+\]/g, "");

  // Remove numeric citations like [1] or [1, 2] that are not markdown links or wiki links
  out = out.replace(/\[(\d+(?:\s*,\s*\d+)*)\](?!\()/g, "");

  // Remove footnote definition lines like [^1]: something
  out = out.replace(/^\s*\[\^\d+\]:.*$/gm, "");

  return out;
}

/**
 * Detects if response already has sources section or footnote definitions.
 */
export function hasExistingCitations(response: string): boolean {
  const content = response || "";
  const hasMarkdownHeading = /(^|\n)\s*#{1,6}\s*Sources\b/i.test(content);
  const hasPlainLabel = /(^|\n)\s*Sources\s*(?:[:-]\s*)?(\n|$)/i.test(content);
  const hasSummaryTag = /<summary>\s*Sources\s*<\/summary>/i.test(content);
  // More robust detection: look for ANY line starting with [^digits]:
  const hasFootnoteDefinitions = /(^|\n)\s*\[\^\d+\]:\s*/.test(content);
  return hasMarkdownHeading || hasPlainLabel || hasSummaryTag || hasFootnoteDefinitions;
}

/**
 * Provides web-search-specific citation instructions using markdown links.
 */
export function getWebSearchCitationInstructions(enableInlineCitations: boolean): string {
  if (!enableInlineCitations) {
    return "";
  }

  return `\n\n${WEB_CITATION_RULES}`;
}

// ===== CITATION PROCESSING UTILITIES =====

export interface SourcesSection {
  mainContent: string;
  sourcesBlock: string;
}

/**
 * Extracts the sources section from content if present.
 */
export function extractSourcesSection(content: string): SourcesSection | null {
  const sourcesRegex = /([\s\S]*?)\n+(?:####\s*)?Sources\s*:?\s*\n+([\s\S]*)$/i;
  const match = content.match(sourcesRegex);
  if (!match) return null;

  return {
    mainContent: match[1],
    sourcesBlock: (match[2] || "").trim(),
  };
}

/**
 * Normalizes sources block by adding line breaks if everything is on one line.
 */
export function normalizeSourcesBlock(sourcesBlock: string): string {
  if (!sourcesBlock.includes("\n")) {
    // Ensure a break before every [n]
    sourcesBlock = sourcesBlock.replace(/\s*\[(\d+)\]\s*/g, "\n[$1] ");
    // And before every n. pattern if present
    sourcesBlock = sourcesBlock.replace(/\s+(\d+)\.\s/g, "\n$1. ");
    sourcesBlock = sourcesBlock.trim();
  }
  return sourcesBlock;
}

/**
 * Parses footnote definitions from sources block.
 */
export function parseFootnoteDefinitions(sourcesBlock: string): string[] {
  return sourcesBlock
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^\[\^\d+\]:/.test(l));
}

/**
 * Builds a citation renumbering map based on first-mention order in content.
 */
export function buildCitationMap(
  mainContent: string,
  footnoteLines: string[]
): Map<number, number> {
  const map = new Map<number, number>();
  const seen = new Set<number>();
  const firstMention: number[] = [];

  // Find first mention order in main content
  const refRe = /\[\^(\d+)\]/g;
  let mref: RegExpExecArray | null;
  while ((mref = refRe.exec(mainContent)) !== null) {
    const n = parseInt(mref[1], 10);
    if (!seen.has(n)) {
      seen.add(n);
      firstMention.push(n);
    }
  }

  if (firstMention.length > 0) {
    firstMention.forEach((n, i) => map.set(n, i + 1));
  } else {
    // Fallback to definition order
    let idx = 1;
    for (const line of footnoteLines) {
      const m = line.match(/^\[\^(\d+)\]:/);
      if (m) {
        const n = parseInt(m[1], 10);
        if (!map.has(n)) map.set(n, idx++);
      }
    }
  }

  return map;
}

/**
 * Normalizes citations in content using the provided mapping.
 */
export function normalizeCitations(content: string, map: Map<number, number>): string {
  // Already-footnote refs: [^n] -> [n] (remapped contiguously)
  // Use global flag with multiple passes to handle consecutive citations like [^7][^8]
  let result = content;
  let changed;
  do {
    changed = false;

    // Handle single citations: [^n] -> [n]
    result = result.replace(/\[\^(\d+)\]/g, (match, n) => {
      const oldN = parseInt(n, 10);
      const newN = map.get(oldN) ?? oldN;
      const replacement = `[${newN}]`;
      if (replacement !== match) {
        changed = true;
      }
      return replacement;
    });

    // Handle multiple citations: [^n, ^m] -> [n, m]
    result = result.replace(/\[\^(\d+(?:\s*,\s*\^?\d+)*)\]/g, (match, citationList) => {
      // Split and process each number in the list
      const processedNumbers = citationList
        .split(",")
        .map((part: string) => {
          const cleanPart = part.trim().replace(/^\^/, ""); // Remove leading ^
          const oldN = parseInt(cleanPart, 10);
          const newN = map.get(oldN) ?? oldN;
          return newN;
        })
        .sort((a: number, b: number) => a - b) // Sort numbers in ascending order
        .map((n: number) => n.toString())
        .join(", ");

      const replacement = `[${processedNumbers}]`;
      if (replacement !== match) {
        changed = true;
      }
      return replacement;
    });
  } while (changed);

  // Fix periods after citations that cause markdown list interpretation: [1]. -> [1]
  result = result.replace(/\[(\d+)\]\./g, "[$1]");

  return result;
}

/**
 * Converts footnote definitions to simple display items.
 */
export function convertFootnoteDefinitions(
  sourcesBlock: string,
  map: Map<number, number>
): string[] {
  const items: string[] = [];
  sourcesBlock.split("\n").forEach((line) => {
    const m = line.match(/^\[\^(\d+)\]:\s*(.*)$/);
    if (!m) return;
    const oldN = parseInt(m[1], 10);
    const newN = map.get(oldN) ?? oldN;
    const markdownLink = m[2].match(/\[([^\]]+)\]\(([^)]+)\)/);
    const wl = m[2].match(/\[\[(.*?)\]\]/);

    let display: string;
    if (markdownLink) {
      // Proper markdown link format: [Title](URL)
      display = `<a href="${markdownLink[2]}">${markdownLink[1]}</a>`;
    } else if (wl) {
      // Wiki link format: [[Title]]
      display = `[[${wl[1]}]]`;
    } else {
      // Handle malformed web citations like "Description text](URL)"
      const malformedLink = m[2].match(/^(.*?)\]\s*\(([^)]+)\)\s*$/);
      if (malformedLink) {
        // Extract text and URL from malformed pattern
        const text = malformedLink[1].trim();
        const url = malformedLink[2].trim();
        display = `<a href="${url}">${text}</a>`;
      } else {
        // Fallback: remove any trailing parenthetical content
        display = m[2].replace(/\s*\([^)]*\)\s*$/, "");
      }
    }
    items[newN - 1] = display;
  });
  return items;
}

/**
 * Consolidates duplicate sources and returns mapping for citation updates.
 */
export function consolidateDuplicateSources(items: string[]): {
  uniqueItems: string[];
  consolidationMap: Map<number, number>;
} {
  const uniqueItems: string[] = [];
  const seenTitles = new Set<string>();
  const consolidationMap = new Map<number, number>(); // oldIndex -> newIndex

  items.forEach((item, originalIndex) => {
    if (!item) return;

    // Extract title from wikilink format [[title]] or use the item as-is
    const titleMatch = item.match(/\[\[(.*?)\]\]/);
    const title = titleMatch ? titleMatch[1].toLowerCase() : item.toLowerCase();

    if (!seenTitles.has(title)) {
      seenTitles.add(title);
      uniqueItems.push(item);
      consolidationMap.set(originalIndex + 1, uniqueItems.length); // 1-based indexing
    } else {
      // Find the index of the first occurrence
      const firstOccurrenceIndex = uniqueItems.findIndex((existing) => {
        const existingTitleMatch = existing.match(/\[\[(.*?)\]\]/);
        const existingTitle = existingTitleMatch
          ? existingTitleMatch[1].toLowerCase()
          : existing.toLowerCase();
        return existingTitle === title;
      });
      if (firstOccurrenceIndex >= 0) {
        consolidationMap.set(originalIndex + 1, firstOccurrenceIndex + 1); // 1-based indexing
      }
    }
  });

  return { uniqueItems, consolidationMap };
}

/**
 * Updates citations in content to reflect consolidated numbering.
 */
export function updateCitationsForConsolidation(
  content: string,
  consolidationMap: Map<number, number>
): string {
  if (consolidationMap.size === 0) return content;

  return content.replace(/\[(\d+(?:\s*,\s*\d+)*)\]/g, (match, nums) => {
    const parts = nums.split(/\s*,\s*/);
    const remappedParts = parts.map((n: string) => {
      const oldNum = parseInt(n, 10);
      return String(consolidationMap.get(oldNum) || oldNum);
    });
    return `[${remappedParts.join(", ")}]`;
  });
}

/**
 * Main function to process inline citations in content.
 * Uses settings to determine if inline citations should be processed.
 */
export function processInlineCitations(content: string, useInlineCitations: boolean): string {
  const sourcesSection = extractSourcesSection(content);
  if (!sourcesSection) return content;

  let { mainContent, sourcesBlock } = sourcesSection;
  sourcesBlock = normalizeSourcesBlock(sourcesBlock);

  // If inline citations are disabled, use simple expandable sources list
  if (!useInlineCitations) {
    const sourceLinks = sourcesBlock
      .split("\n")
      .map((line) => {
        const match = line.match(/- \[\[(.*?)\]\]/);
        if (match) {
          return `<li>[[${match[1]}]]</li>`;
        }
        return line;
      })
      .join("\n");

    return (
      mainContent +
      "\n\n<br/>\n<details><summary>Sources</summary>\n<ul>\n" +
      sourceLinks +
      "\n</ul>\n</details>"
    );
  }

  // Process inline citations
  const footnoteLines = parseFootnoteDefinitions(sourcesBlock);
  if (footnoteLines.length === 0) {
    // Not footnote format, use simple sources list
    const sourceLinks = sourcesBlock
      .split("\n")
      .map((line) => {
        const match = line.match(/- \[\[(.*?)\]\]/);
        if (match) {
          return `<li>[[${match[1]}]]</li>`;
        }
        return line;
      })
      .join("\n");

    return (
      mainContent +
      "\n\n<br/>\n<details><summary>Sources</summary>\n<ul>\n" +
      sourceLinks +
      "\n</ul>\n</details>"
    );
  }

  // Process footnote-style citations
  const citationMap = buildCitationMap(mainContent, footnoteLines);
  mainContent = normalizeCitations(mainContent, citationMap);

  let items = convertFootnoteDefinitions(sourcesBlock, citationMap);
  const { uniqueItems, consolidationMap } = consolidateDuplicateSources(items);

  // Update citations to reflect consolidation
  if (consolidationMap.size > 0) {
    mainContent = updateCitationsForConsolidation(mainContent, consolidationMap);
    items = uniqueItems;
  }

  // Build sources list maintaining proper citation mapping
  // The old code used .filter().map() which destroyed the mapping by renumbering
  // Now we build the list respecting the citation numbers used in the text
  const maxCitationNum = Math.max(
    ...Array.from(citationMap.values()).concat(
      consolidationMap.size > 0 ? Array.from(consolidationMap.values()) : []
    )
  );

  const sourcesList: string[] = [];
  for (let i = 1; i <= maxCitationNum; i++) {
    const item = items[i - 1];
    if (item) {
      sourcesList.push(`<li><strong>[${i}]</strong> ${item}</li>`);
    }
  }

  const formattedSourcesList = sourcesList.join("\n");

  return (
    mainContent +
    "\n\n<br/>\n<details><summary>Sources</summary>\n<ul>\n" +
    formattedSourcesList +
    "\n</ul>\n</details>"
  );
}

// ===== SOURCE CATALOG UTILITIES =====

export interface SourceCatalogEntry {
  title: string;
  path: string;
}

/**
 * Formats source catalog entries for citation guidance.
 */
export function formatSourceCatalog(sources: SourceCatalogEntry[]): string[] {
  return sources.map((source) => {
    const title = source.title || source.path || "Untitled";
    const path = source.path || title;
    return `- [[${title}]] (${path})`;
  });
}
