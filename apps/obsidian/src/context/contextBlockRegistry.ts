export type ContextSourceType = "note" | "url" | "youtube" | "pdf" | "selected_text" | "unknown";

export type SourceExtractor = "path" | "url" | "name" | null;

export interface ContextBlockType {
  tag: string;
  sourceType: ContextSourceType;
  recoverable: boolean;
  sourceExtractor: SourceExtractor;
}

export const CONTEXT_BLOCK_TYPES: ContextBlockType[] = [
  { tag: "note_context", sourceType: "note", recoverable: true, sourceExtractor: "path" },
  { tag: "active_note", sourceType: "note", recoverable: true, sourceExtractor: "path" },
  { tag: "embedded_note", sourceType: "note", recoverable: true, sourceExtractor: "path" },
  { tag: "vault_note", sourceType: "note", recoverable: true, sourceExtractor: "path" },
  { tag: "retrieved_document", sourceType: "note", recoverable: true, sourceExtractor: "path" },

  { tag: "url_content", sourceType: "url", recoverable: true, sourceExtractor: "url" },
  { tag: "web_tab_context", sourceType: "url", recoverable: true, sourceExtractor: "url" },
  { tag: "active_web_tab", sourceType: "url", recoverable: true, sourceExtractor: "url" },

  {
    tag: "youtube_video_context",
    sourceType: "youtube",
    recoverable: true,
    sourceExtractor: "url",
  },

  { tag: "twitter_content", sourceType: "url", recoverable: true, sourceExtractor: "url" },

  { tag: "embedded_pdf", sourceType: "pdf", recoverable: true, sourceExtractor: "name" },

  { tag: "selected_text", sourceType: "selected_text", recoverable: false, sourceExtractor: null },
  {
    tag: "web_selected_text",
    sourceType: "selected_text",
    recoverable: false,
    sourceExtractor: null,
  },

  { tag: "localSearch", sourceType: "note", recoverable: true, sourceExtractor: null },
];

const blockTypeByTag = new Map<string, ContextBlockType>();
for (const blockType of CONTEXT_BLOCK_TYPES) {
  blockTypeByTag.set(blockType.tag, blockType);
}

export function getSourceType(tag: string): ContextSourceType {
  return blockTypeByTag.get(tag)?.sourceType ?? "unknown";
}

export function isRecoverable(tag: string): boolean {
  return blockTypeByTag.get(tag)?.recoverable ?? false;
}

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

export function extractContentFromBlock(xmlBlock: string): string {
  const contentMatch = /<content>([\s\S]*?)<\/content>/.exec(xmlBlock);
  return contentMatch ? contentMatch[1] : xmlBlock;
}
