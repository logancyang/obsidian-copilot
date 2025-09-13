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

/**
 * Gets web search citation instructions.
 */
export function getWebSearchCitationInstructions(): string {
  return CITATION_RULES;
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
  const hasSourcesSection = /(^|\n)\s*(?:####\s*)?Sources\s*:?\s*\n/i.test(response || "");
  // More robust detection: look for ANY line starting with [^digits]:
  const hasFootnoteDefinitions = /(^|\n)\s*\[\^\d+\]:\s*/.test(response || "");
  return hasSourcesSection || hasFootnoteDefinitions;
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
