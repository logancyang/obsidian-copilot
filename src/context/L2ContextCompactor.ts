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

export type { ContextSourceType } from "./contextBlockRegistry";
export type { CompactionConfig as L2CompactorConfig } from "./compactionUtils";
export { compactBySection, truncateWithEllipsis } from "./compactionUtils";
export { getSourceType as detectSourceType } from "./contextBlockRegistry";

export { compactChatHistoryContent } from "./ChatHistoryCompactor";

function extractSourceFromCommonTags(xmlBlock: string): string {
  const pathMatch = /<path>([^<]+)<\/path>/.exec(xmlBlock);
  if (pathMatch) return pathMatch[1];

  const urlMatch = /<url>([^<]+)<\/url>/.exec(xmlBlock);
  if (urlMatch) return urlMatch[1];

  const nameMatch = /<name>([^<]+)<\/name>/.exec(xmlBlock);
  if (nameMatch) return nameMatch[1];

  return "";
}

export function extractSource(xmlBlock: string): string {
  return extractSourceFromCommonTags(xmlBlock);
}

export function extractContent(xmlBlock: string): string {
  return extractContentFromBlock(xmlBlock);
}

export function compactL3ForL2(
  content: string,
  source: string,
  sourceType: ContextSourceType,
  config: Partial<CompactionConfig> = {}
): string {
  const threshold = config.verbatimThreshold ?? DEFAULT_COMPACTION_CONFIG.verbatimThreshold;

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

export function compactXmlBlock(
  xmlBlock: string,
  blockType: string,
  config: Partial<CompactionConfig> = {}
): string {
  if (!isRecoverable(blockType)) {
    return xmlBlock;
  }

  const threshold = config.verbatimThreshold ?? DEFAULT_COMPACTION_CONFIG.verbatimThreshold;

  if (xmlBlock.length <= threshold) {
    return xmlBlock;
  }

  const source =
    extractSourceFromBlock(xmlBlock, blockType) || extractSourceFromCommonTags(xmlBlock);
  const content = extractContentFromBlock(xmlBlock);
  const sourceType = getSourceType(blockType);

  return compactL3ForL2(content, source, sourceType, config);
}

export function getL2RefetchInstruction(): string {
  return `<prior_context_note>
The above prior_context blocks contain previews of content from earlier turns.
To access full content: use [[note title]] for notes, or ask to read a specific URL/video.
</prior_context_note>`;
}
