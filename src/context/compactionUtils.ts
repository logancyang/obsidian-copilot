/**
 * Shared utilities for content compaction.
 *
 * These are pure functions used by both L2ContextCompactor and ChatHistoryCompactor
 * for truncating and extracting structure from content.
 */

/**
 * Configuration for compaction operations
 */
export interface CompactionConfig {
  /** Characters to keep per section (default: 500) */
  previewCharsPerSection: number;
  /** Max total sections to include (default: 20) */
  maxSections: number;
  /** Threshold below which content is kept verbatim (default: 5000) */
  verbatimThreshold: number;
}

export const DEFAULT_COMPACTION_CONFIG: CompactionConfig = {
  previewCharsPerSection: 500,
  maxSections: 20,
  verbatimThreshold: 5000,
};

/**
 * Merge partial config with defaults
 */
export function mergeConfig(config: Partial<CompactionConfig> = {}): CompactionConfig {
  return { ...DEFAULT_COMPACTION_CONFIG, ...config };
}

/**
 * Compact content by extracting headings and preview from each section.
 *
 * @param content - The full content to compact
 * @param previewCharsPerSection - Max chars to keep per section
 * @param maxSections - Max number of sections to include
 * @returns Compacted content with structure preserved
 */
export function compactBySection(
  content: string,
  previewCharsPerSection = 500,
  maxSections = 20
): string {
  // Split content by markdown headings (keep the heading with its section)
  const sections = content.split(/(?=^#{1,6}\s+)/m).filter((s) => s.trim());

  if (sections.length <= 1) {
    // No headings - just truncate intelligently
    return truncateWithEllipsis(content, previewCharsPerSection * 4);
  }

  // Limit number of sections
  const limitedSections = sections.slice(0, maxSections);
  const hasMoreSections = sections.length > maxSections;

  const compacted = limitedSections
    .map((section) => {
      const lines = section.trim().split("\n");
      const heading = lines[0]; // The heading line
      const body = lines.slice(1).join("\n").trim();

      if (body.length <= previewCharsPerSection) {
        // Keep full section if small enough
        return section.trim();
      }

      // Keep heading + truncated body
      return `${heading}\n${truncateWithEllipsis(body, previewCharsPerSection)}`;
    })
    .join("\n\n");

  if (hasMoreSections) {
    return `${compacted}\n\n[... ${sections.length - maxSections} more sections omitted ...]`;
  }

  return compacted;
}

/**
 * Truncate text at a sensible boundary (sentence or paragraph) with ellipsis.
 *
 * @param text - Text to truncate
 * @param maxLength - Maximum length
 * @returns Truncated text with ellipsis if truncated
 */
export function truncateWithEllipsis(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  const truncated = text.slice(0, maxLength);

  // Try to break at sentence boundary - find last complete sentence
  // Look for sentence-ending punctuation followed by space
  const sentenceEndPattern = /[.!?]\s+/g;
  let lastSentenceEnd = -1;
  let match;
  while ((match = sentenceEndPattern.exec(truncated)) !== null) {
    // Only count if we're past 50% of the text (avoid breaking too early)
    if (match.index > maxLength * 0.5) {
      lastSentenceEnd = match.index + 1; // Include the punctuation
    }
  }
  if (lastSentenceEnd > 0) {
    return truncated.slice(0, lastSentenceEnd) + " ...";
  }

  // Try to break at paragraph boundary
  const lastParagraph = truncated.lastIndexOf("\n\n");
  if (lastParagraph > maxLength * 0.5) {
    return truncated.slice(0, lastParagraph) + "\n\n...";
  }

  // Fall back to word boundary
  const lastSpace = truncated.lastIndexOf(" ");
  if (lastSpace > maxLength * 0.8) {
    return truncated.slice(0, lastSpace) + " ...";
  }

  return truncated + "...";
}

/**
 * Escape a string for use in an XML attribute value.
 */
export function escapeXmlAttr(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
