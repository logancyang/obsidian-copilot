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
 * Pattern to find readNote tool result prefix in chat history.
 * The JSON is extracted separately using brace-balanced parsing.
 */
const READ_NOTE_PREFIX = "Tool 'readNote' result: ";

/**
 * Extract a brace-balanced JSON object starting at position.
 * Returns the JSON string and end position, or null if not valid.
 */
function extractBalancedJson(
  content: string,
  startPos: number
): { json: string; endPos: number } | null {
  if (content[startPos] !== "{") return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = startPos; i < content.length; i++) {
    const char = content[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (char === "\\" && inString) {
      escape = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === "{") depth++;
    else if (char === "}") {
      depth--;
      if (depth === 0) {
        return { json: content.slice(startPos, i + 1), endPos: i + 1 };
      }
    }
  }

  return null; // Unbalanced braces
}

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

  // Compact readNote JSON results using brace-balanced extraction
  result = compactReadNoteResults(result, threshold, config);

  return result;
}

/**
 * Find and compact all readNote JSON results in content using brace-balanced extraction.
 */
function compactReadNoteResults(
  content: string,
  threshold: number,
  config: Partial<CompactionConfig>
): string {
  let result = "";
  let searchPos = 0;

  while (searchPos < content.length) {
    const prefixPos = content.indexOf(READ_NOTE_PREFIX, searchPos);
    if (prefixPos === -1) {
      result += content.slice(searchPos);
      break;
    }

    // Add content before the prefix
    result += content.slice(searchPos, prefixPos);

    const jsonStart = prefixPos + READ_NOTE_PREFIX.length;
    const extracted = extractBalancedJson(content, jsonStart);

    if (!extracted) {
      // No valid JSON found, keep original prefix and continue
      result += READ_NOTE_PREFIX;
      searchPos = jsonStart;
      continue;
    }

    try {
      const parsed = JSON.parse(extracted.json);
      if (parsed.content && parsed.content.length > threshold) {
        const compactedResult = compactReadNoteResult(parsed, config);
        result += `${READ_NOTE_PREFIX}${JSON.stringify(compactedResult)}`;
      } else {
        // Keep original if under threshold
        result += READ_NOTE_PREFIX + extracted.json;
      }
    } catch {
      // JSON parse failed (shouldn't happen with balanced extraction), keep original
      result += READ_NOTE_PREFIX + extracted.json;
    }

    searchPos = extracted.endPos;
  }

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

  // Special handling for localSearch with multiple documents
  if (tag === "localSearch") {
    return compactLocalSearchBlock(xmlBlock, config);
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
 * Compact a localSearch block, preserving all documents with their paths.
 * Each document gets its content compacted but title/path are preserved.
 */
function compactLocalSearchBlock(xmlBlock: string, config: Partial<CompactionConfig> = {}): string {
  const previewChars =
    config.previewCharsPerSection ?? DEFAULT_COMPACTION_CONFIG.previewCharsPerSection;

  // Extract all document blocks
  const documentRegex = /<document>([\s\S]*?)<\/document>/g;
  const documents: Array<{ path: string; title: string; preview: string }> = [];

  let match;
  while ((match = documentRegex.exec(xmlBlock)) !== null) {
    const docContent = match[1];

    // Extract path and title from the document
    const pathMatch = /<path>([^<]+)<\/path>/.exec(docContent);
    const titleMatch = /<title>([^<]+)<\/title>/.exec(docContent);
    const contentMatch = /<content>([\s\S]*?)<\/content>/.exec(docContent);

    const path = pathMatch?.[1] ?? "";
    const title = titleMatch?.[1] ?? path.split("/").pop() ?? "Untitled";
    const content = contentMatch?.[1] ?? "";

    // Truncate content to preview length
    const preview =
      content.length > previewChars ? content.slice(0, previewChars) + "..." : content;

    documents.push({ path, title, preview: preview.trim() });
  }

  if (documents.length === 0) {
    // Fallback: no documents found, use generic compaction
    const content = extractContentFromBlock(xmlBlock);
    const compactedContent = compactBySection(
      content,
      previewChars,
      config.maxSections ?? DEFAULT_COMPACTION_CONFIG.maxSections
    );
    return `<prior_context source="localSearch" type="note">
${compactedContent}
</prior_context>`;
  }

  // Build compacted output with all documents listed
  const docList = documents
    .map((doc, i) => `${i + 1}. [[${doc.title}]] (${doc.path})\n   ${doc.preview}`)
    .join("\n\n");

  return `<prior_context source="localSearch" type="note">
[${documents.length} search results - use localSearch to re-query]

${docList}
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
