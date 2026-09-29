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

function buildToolResultPatterns(): Array<{ pattern: RegExp; tag: string }> {
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

const READ_NOTE_PREFIX = "Tool 'readNote' result: ";

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

  return null;
}

export function compactAssistantOutput(
  output: string | unknown[],
  config: Partial<CompactionConfig> = {}
): string | unknown[] {
  if (Array.isArray(output)) {
    return output.map((item: { type?: string; text?: unknown }) => {
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

function compactOutputString(content: string, config: Partial<CompactionConfig> = {}): string {
  const threshold = config.verbatimThreshold ?? DEFAULT_COMPACTION_CONFIG.verbatimThreshold;
  let result = content;

  for (const { pattern, tag } of TOOL_RESULT_PATTERNS) {
    pattern.lastIndex = 0;

    result = result.replace(pattern, (match) => {
      if (match.length < threshold) {
        return match;
      }
      return compactToolResultBlock(match, tag, config);
    });
  }

  result = compactReadNoteResults(result, threshold, config);

  return result;
}

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

    result += content.slice(searchPos, prefixPos);

    const jsonStart = prefixPos + READ_NOTE_PREFIX.length;
    const extracted = extractBalancedJson(content, jsonStart);

    if (!extracted) {
      result += READ_NOTE_PREFIX;
      searchPos = jsonStart;
      continue;
    }

    try {
      const parsed = JSON.parse(extracted.json) as Parameters<typeof compactReadNoteResult>[0];
      if (parsed.content && parsed.content.length > threshold) {
        const compactedResult = compactReadNoteResult(parsed, config);
        result += `${READ_NOTE_PREFIX}${JSON.stringify(compactedResult)}`;
      } else {
        result += READ_NOTE_PREFIX + extracted.json;
      }
    } catch {
      result += READ_NOTE_PREFIX + extracted.json;
    }

    searchPos = extracted.endPos;
  }

  return result;
}

function compactToolResultBlock(
  xmlBlock: string,
  tag: string,
  config: Partial<CompactionConfig> = {}
): string {
  if (!isRecoverable(tag)) {
    return xmlBlock;
  }

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

function compactLocalSearchBlock(xmlBlock: string, config: Partial<CompactionConfig> = {}): string {
  const previewChars =
    config.previewCharsPerSection ?? DEFAULT_COMPACTION_CONFIG.previewCharsPerSection;

  const documentRegex = /<document>([\s\S]*?)<\/document>/g;
  const documents: Array<{ path: string; title: string; preview: string }> = [];

  let match;
  while ((match = documentRegex.exec(xmlBlock)) !== null) {
    const docContent = match[1];

    const pathMatch = /<path>([^<]+)<\/path>/.exec(docContent);
    const titleMatch = /<title>([^<]+)<\/title>/.exec(docContent);
    const contentMatch = /<content>([\s\S]*?)<\/content>/.exec(docContent);

    const path = pathMatch?.[1] ?? "";
    const title = titleMatch?.[1] ?? path.split("/").pop() ?? "Untitled";
    const content = contentMatch?.[1] ?? "";

    const preview =
      content.length > previewChars ? content.slice(0, previewChars) + "..." : content;

    documents.push({ path, title, preview: preview.trim() });
  }

  if (documents.length === 0) {
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

  const docList = documents
    .map((doc, i) => `${i + 1}. [[${doc.title}]] (${doc.path})\n   ${doc.preview}`)
    .join("\n\n");

  return `<prior_context source="localSearch" type="note">
[${documents.length} search results - use localSearch to re-query]

${docList}
</prior_context>`;
}

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

export { compactAssistantOutput as compactChatHistoryContent };
