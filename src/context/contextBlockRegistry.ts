/**
 * Unified registry for all context block types used in the plugin.
 *
 * This is the single source of truth for:
 * - XML tag names used for context blocks
 * - Source types (note, url, youtube, etc.)
 * - Whether content is recoverable (can LLM re-fetch it?)
 * - How to extract the source identifier from each block type
 */

/**
 * Context source types that determine which tool to use for re-fetching
 */
export type ContextSourceType = "note" | "url" | "youtube" | "pdf" | "selected_text" | "unknown";

/**
 * How to extract the source identifier from an XML block
 */
export type SourceExtractor = "path" | "url" | "name" | null;

/**
 * Metadata for a context block type
 */
export interface ContextBlockType {
  /** XML tag name (e.g., "note_context", "url_content") */
  tag: string;
  /** Category of source for re-fetching hints */
  sourceType: ContextSourceType;
  /** Whether the LLM can programmatically re-fetch this content */
  recoverable: boolean;
  /** Which XML child element contains the source identifier */
  sourceExtractor: SourceExtractor;
}

/**
 * All registered context block types
 */
export const CONTEXT_BLOCK_TYPES: ContextBlockType[] = [
  // Note-based content (recoverable via readNote or wiki-links)
  { tag: "note_context", sourceType: "note", recoverable: true, sourceExtractor: "path" },
  { tag: "active_note", sourceType: "note", recoverable: true, sourceExtractor: "path" },
  { tag: "embedded_note", sourceType: "note", recoverable: true, sourceExtractor: "path" },
  { tag: "vault_note", sourceType: "note", recoverable: true, sourceExtractor: "path" },
  { tag: "retrieved_document", sourceType: "note", recoverable: true, sourceExtractor: "path" },

  // Web content (recoverable via /url command)
  { tag: "url_content", sourceType: "url", recoverable: true, sourceExtractor: "url" },
  { tag: "web_tab_context", sourceType: "url", recoverable: true, sourceExtractor: "url" },
  { tag: "active_web_tab", sourceType: "url", recoverable: true, sourceExtractor: "url" },

  // YouTube (recoverable via /yt command)
  {
    tag: "youtube_video_context",
    sourceType: "youtube",
    recoverable: true,
    sourceExtractor: "url",
  },

  // PDF (partially recoverable - needs the file in vault)
  { tag: "embedded_pdf", sourceType: "pdf", recoverable: true, sourceExtractor: "name" },

  // Selected text (NOT recoverable - user must manually re-select)
  { tag: "selected_text", sourceType: "selected_text", recoverable: false, sourceExtractor: null },
  {
    tag: "web_selected_text",
    sourceType: "selected_text",
    recoverable: false,
    sourceExtractor: null,
  },

  // Tool results (recoverable by re-running the tool)
  { tag: "localSearch", sourceType: "note", recoverable: true, sourceExtractor: null },
];

// Pre-computed lookup maps for performance
const blockTypeByTag = new Map<string, ContextBlockType>();
for (const blockType of CONTEXT_BLOCK_TYPES) {
  blockTypeByTag.set(blockType.tag, blockType);
}

/**
 * Get block type metadata by tag name
 */
export function getBlockType(tag: string): ContextBlockType | undefined {
  return blockTypeByTag.get(tag);
}

/**
 * Get the source type for a given tag name
 */
export function getSourceType(tag: string): ContextSourceType {
  return blockTypeByTag.get(tag)?.sourceType ?? "unknown";
}

/**
 * Check if a block type is recoverable (can be re-fetched by the LLM)
 */
export function isRecoverable(tag: string): boolean {
  return blockTypeByTag.get(tag)?.recoverable ?? false;
}

/**
 * Get all tags that should never be compacted
 */
export function getNeverCompactTags(): Set<string> {
  const tags = new Set<string>();
  for (const blockType of CONTEXT_BLOCK_TYPES) {
    if (!blockType.recoverable) {
      tags.add(blockType.tag);
    }
  }
  return tags;
}

/**
 * Extract the source identifier from an XML block based on the block type
 */
export function extractSourceFromBlock(xmlBlock: string, tag: string): string {
  const blockType = blockTypeByTag.get(tag);
  if (!blockType?.sourceExtractor) {
    return "";
  }

  const extractorTag = blockType.sourceExtractor;
  const regex = new RegExp(`<${extractorTag}>([^<]+)</${extractorTag}>`);
  const match = regex.exec(xmlBlock);
  return match?.[1] ?? "";
}

/**
 * Extract the content from an XML block (inside <content> tags)
 */
export function extractContentFromBlock(xmlBlock: string): string {
  const contentMatch = /<content>([\s\S]*?)<\/content>/.exec(xmlBlock);
  return contentMatch ? contentMatch[1] : xmlBlock;
}

/**
 * Detect the XML tag name from a block string
 */
export function detectBlockTag(xmlBlock: string): string | null {
  const match = xmlBlock.match(/^<(\w+)[\s>]/);
  return match?.[1] ?? null;
}
