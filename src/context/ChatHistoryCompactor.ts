/**
 * ChatHistoryCompactor - Compacts tool results in chat history.
 *
 * When assistant responses contain large tool results (localSearch, readNote, etc.),
 * this compactor replaces them with compact summaries to prevent memory bloat.
 *
 * This is applied at save time in MemoryManager.saveContext() so that
 * both LangChain memory and LLM payloads contain compacted content.
 */

import {
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

/**
 * Build regex patterns for all registered block types that appear in tool results.
 * These are XML blocks embedded in assistant responses.
 */
function buildToolResultPatterns(): Array<{ pattern: RegExp; tag: string }> {
  // Tags that commonly appear as tool results in chat history
  const toolResultTags = [
    "localSearch",
    "note_context",
    "active_note",
    "retrieved_document",
    "url_content",
    "youtube_video_context",
  ];

  return toolResultTags.map((tag) => ({
    pattern: new RegExp(`<${tag}[^>]*>[\\s\\S]*?</${tag}>`, "g"),
    tag,
  }));
}

const TOOL_RESULT_PATTERNS = buildToolResultPatterns();

/**
 * Pattern to match readNote tool JSON results embedded in chat history.
 * Format: Tool 'readNote' result: {...json...}
 */
const READ_NOTE_RESULT_PATTERN = /Tool 'readNote' result: (\{[\s\S]*?\})(?=\n\n|\n<|$)/g;

/**
 * Compact an assistant's output before saving to memory.
 *
 * This is the main entry point - a simple function that takes the assistant's
 * response and returns a compacted version with large tool results summarized.
 *
 * @param output - The assistant's response (string or multimodal array)
 * @param config - Optional configuration overrides
 * @returns Compacted output
 */
export function compactAssistantOutput(
  output: string | any[],
  config: Partial<CompactionConfig> = {}
): string | any[] {
  if (Array.isArray(output)) {
    // Handle multimodal content - compact text parts
    return output.map((item) => {
      if (item.type === "text" && typeof item.text === "string") {
        return { ...item, text: compactOutputString(item.text, config) };
      }
      return item;
    });
  }

  if (typeof output === "string") {
    return compactOutputString(output, config);
  }

  return output;
}

/**
 * Compact a string that may contain tool results.
 */
function compactOutputString(content: string, config: Partial<CompactionConfig> = {}): string {
  const threshold = config.verbatimThreshold ?? DEFAULT_COMPACTION_CONFIG.verbatimThreshold;
  let result = content;

  // Compact XML-based tool results
  for (const { pattern, tag } of TOOL_RESULT_PATTERNS) {
    // Reset regex state for each use
    pattern.lastIndex = 0;

    result = result.replace(pattern, (match) => {
      // Only compact if the block is large
      if (match.length < threshold) {
        return match;
      }
      return compactToolResultBlock(match, tag, config);
    });
  }

  // Compact readNote JSON results
  result = result.replace(READ_NOTE_RESULT_PATTERN, (fullMatch, jsonStr) => {
    try {
      const parsed = JSON.parse(jsonStr);
      if (parsed.content && parsed.content.length > threshold) {
        const compactedResult = compactReadNoteResult(parsed, config);
        return `Tool 'readNote' result: ${JSON.stringify(compactedResult)}`;
      }
    } catch {
      // JSON parse failed, return original
    }
    return fullMatch;
  });

  return result;
}

/**
 * Compact an XML tool result block.
 */
function compactToolResultBlock(
  xmlBlock: string,
  tag: string,
  config: Partial<CompactionConfig> = {}
): string {
  // Never compact non-recoverable content
  if (!isRecoverable(tag)) {
    return xmlBlock;
  }

  const source = extractSourceFromBlock(xmlBlock, tag);
  const content = extractContentFromBlock(xmlBlock);
  const sourceType = getSourceType(tag);

  const previewChars =
    config.previewCharsPerSection ?? DEFAULT_COMPACTION_CONFIG.previewCharsPerSection;
  const maxSections = config.maxSections ?? DEFAULT_COMPACTION_CONFIG.maxSections;
  const compactedContent = compactBySection(content, previewChars, maxSections);

  return `<prior_context source="${escapeXmlAttr(source)}" type="${sourceType}">
${compactedContent}
</prior_context>`;
}

/**
 * Compact a readNote tool result by replacing full content with structure + preview.
 */
function compactReadNoteResult(
  result: {
    notePath?: string;
    noteTitle?: string;
    content?: string;
    chunkIndex?: number;
    totalChunks?: number;
    [key: string]: unknown;
  },
  config: Partial<CompactionConfig> = {}
): Record<string, unknown> {
  const { content, notePath, noteTitle, ...rest } = result;

  if (!content || typeof content !== "string") {
    return result;
  }

  const previewChars =
    config.previewCharsPerSection ?? DEFAULT_COMPACTION_CONFIG.previewCharsPerSection;
  const maxSections = config.maxSections ?? DEFAULT_COMPACTION_CONFIG.maxSections;
  const compactedContent = compactBySection(content, previewChars, maxSections);

  return {
    ...rest,
    notePath,
    noteTitle,
    content: `[COMPACTED - use readNote to get full content]\n\n${compactedContent}`,
    _wasCompacted: true,
  };
}

// Re-export for backwards compatibility during transition
export { compactAssistantOutput as compactChatHistoryContent };
