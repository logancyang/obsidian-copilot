/**
 * L2ContextCompactor - Compacts L3 context for inclusion in L2 (previous turn context).
 *
 * When context from previous turns (L3) flows into L2, we don't need the full verbatim
 * content. Instead, we extract structure and previews. A single instruction at the end
 * of L2 tells the LLM how to re-fetch full content if needed.
 *
 * This is NOT LLM-based summarization - it's deterministic extraction that:
 * 1. Preserves document structure (headings)
 * 2. Keeps preview content from each section
 * 3. Includes source path/URL for re-fetching
 *
 * Typical compression: 100KB -> 3-5KB (95%+ reduction)
 */

import {
  ContextSourceType,
  extractContentFromBlock,
  extractSourceFromBlock,
  getSourceType,
  isRecoverable,
} from "./contextBlockRegistry";
import {
  CompactionConfig,
  DEFAULT_COMPACTION_CONFIG,
  compactBySection,
  escapeXmlAttr,
} from "./compactionUtils";

// Re-export types and utilities for backwards compatibility
export type { ContextSourceType } from "./contextBlockRegistry";
export type { CompactionConfig as L2CompactorConfig } from "./compactionUtils";
export { compactBySection, truncateWithEllipsis } from "./compactionUtils";
export { getSourceType as detectSourceType } from "./contextBlockRegistry";

// Re-export chat history compaction for backwards compatibility
export { compactAssistantOutput, compactChatHistoryContent } from "./ChatHistoryCompactor";

/**
 * Extract the source identifier from an XML block.
 * @deprecated Use extractSourceFromBlock from contextBlockRegistry instead
 */
export function extractSource(xmlBlock: string): string {
  // Try common source extractors in order
  const pathMatch = /<path>([^<]+)<\/path>/.exec(xmlBlock);
  if (pathMatch) return pathMatch[1];

  const urlMatch = /<url>([^<]+)<\/url>/.exec(xmlBlock);
  if (urlMatch) return urlMatch[1];

  const nameMatch = /<name>([^<]+)<\/name>/.exec(xmlBlock);
  if (nameMatch) return nameMatch[1];

  return "";
}

/**
 * Extract the inner content from an XML block.
 * @deprecated Use extractContentFromBlock from contextBlockRegistry instead
 */
export function extractContent(xmlBlock: string): string {
  return extractContentFromBlock(xmlBlock);
}

/**
 * Compact a single L3 segment's content for inclusion in L2.
 *
 * @param content - The full content from the L3 segment
 * @param source - The source path/URL (for display and re-fetching)
 * @param sourceType - The type of source
 * @param config - Optional configuration overrides
 * @returns Compacted content with structure and previews
 */
export function compactL3ForL2(
  content: string,
  source: string,
  sourceType: ContextSourceType,
  config: Partial<CompactionConfig> = {}
): string {
  const threshold = config.verbatimThreshold ?? DEFAULT_COMPACTION_CONFIG.verbatimThreshold;

  // Keep small content verbatim
  if (content.length <= threshold) {
    return content;
  }

  const previewChars =
    config.previewCharsPerSection ?? DEFAULT_COMPACTION_CONFIG.previewCharsPerSection;
  const maxSections = config.maxSections ?? DEFAULT_COMPACTION_CONFIG.maxSections;
  const compactedContent = compactBySection(content, previewChars, maxSections);

  return `<prior_context source="${escapeXmlAttr(source)}" type="${sourceType}">
${compactedContent}
</prior_context>`;
}

/**
 * Compact an entire XML context block for L2.
 * This is the main entry point for compacting L3 segments.
 *
 * @param xmlBlock - The full XML block (e.g., <note_context>...</note_context>)
 * @param blockType - The XML tag type (e.g., "note_context")
 * @param config - Optional configuration overrides
 * @returns Compacted block ready for L2
 */
export function compactXmlBlock(
  xmlBlock: string,
  blockType: string,
  config: Partial<CompactionConfig> = {}
): string {
  // Never compact non-recoverable content (e.g., selected_text)
  if (!isRecoverable(blockType)) {
    return xmlBlock;
  }

  const threshold = config.verbatimThreshold ?? DEFAULT_COMPACTION_CONFIG.verbatimThreshold;

  // Keep small blocks verbatim
  if (xmlBlock.length <= threshold) {
    return xmlBlock;
  }

  const source = extractSourceFromBlock(xmlBlock, blockType) || extractSource(xmlBlock);
  const content = extractContentFromBlock(xmlBlock);
  const sourceType = getSourceType(blockType);

  return compactL3ForL2(content, source, sourceType, config);
}

/**
 * Returns a single instruction to append after all L2 context, explaining how to
 * re-fetch compacted content. This is more efficient than per-block hints.
 */
export function getL2RefetchInstruction(): string {
  return `<prior_context_note>
The above prior_context blocks contain previews of content from earlier turns.
To access full content: use [[note title]] for notes, or ask to read a specific URL/video.
</prior_context_note>`;
}
