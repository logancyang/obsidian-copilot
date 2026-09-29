export interface CompactionConfig {
  previewCharsPerSection: number;
  maxSections: number;
  verbatimThreshold: number;
}

export const DEFAULT_COMPACTION_CONFIG: CompactionConfig = {
  previewCharsPerSection: 500,
  maxSections: 20,
  verbatimThreshold: 5000,
};

export function mergeConfig(config: Partial<CompactionConfig> = {}): CompactionConfig {
  return { ...DEFAULT_COMPACTION_CONFIG, ...config };
}

export function compactBySection(
  content: string,
  previewCharsPerSection = 500,
  maxSections = 20
): string {
  const sections = content.split(/(?=^#{1,6}\s+)/m).filter((s) => s.trim());

  if (sections.length <= 1) {
    return truncateWithEllipsis(content, previewCharsPerSection * 4);
  }

  const limitedSections = sections.slice(0, maxSections);
  const hasMoreSections = sections.length > maxSections;

  const compacted = limitedSections
    .map((section) => {
      const lines = section.trim().split("\n");
      const heading = lines[0];
      const body = lines.slice(1).join("\n").trim();

      if (body.length <= previewCharsPerSection) {
        return section.trim();
      }

      return `${heading}\n${truncateWithEllipsis(body, previewCharsPerSection)}`;
    })
    .join("\n\n");

  if (hasMoreSections) {
    return `${compacted}\n\n[... ${sections.length - maxSections} more sections omitted ...]`;
  }

  return compacted;
}

export function truncateWithEllipsis(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  const truncated = text.slice(0, maxLength);

  const sentenceEndPattern = /[.!?]\s+/g;
  let lastSentenceEnd = -1;
  let match;
  while ((match = sentenceEndPattern.exec(truncated)) !== null) {
    if (match.index > maxLength * 0.5) {
      lastSentenceEnd = match.index + 1;
    }
  }
  if (lastSentenceEnd > 0) {
    return truncated.slice(0, lastSentenceEnd) + " ...";
  }

  const lastParagraph = truncated.lastIndexOf("\n\n");
  if (lastParagraph > maxLength * 0.5) {
    return truncated.slice(0, lastParagraph) + "\n\n...";
  }

  const lastSpace = truncated.lastIndexOf(" ");
  if (lastSpace > maxLength * 0.8) {
    return truncated.slice(0, lastSpace) + " ...";
  }

  return truncated + "...";
}

export function escapeXmlAttr(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
