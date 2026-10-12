import type { App } from "obsidian";

export type MarkdownBlockType = "code" | "heading" | "table" | "text";

export interface MarkdownBlock {
  type: MarkdownBlockType;
  text: string;
}

export interface MarkdownSplit {
  frontmatter: string | null;
  blocks: readonly MarkdownBlock[];
}

interface ParsedSection {
  type: string;
  position: { start: { line: number }; end: { line: number } };
}

interface MetadataParser {
  computeMetadataAsync?: (buffer: ArrayBuffer) => Promise<{ sections?: ParsedSection[] }>;
}

const EMPTY_BLOCKS: readonly MarkdownBlock[] = Object.freeze([]);
const SECTION_BLOCK_TYPES: Readonly<Record<string, MarkdownBlockType>> = {
  code: "code",
  heading: "heading",
  table: "table",
};

// Obsidian indents list content with tabs, so its parser keeps a fence nested in a list item inside
// the list section; the fence still has to stay out of word diffs.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/349
const LIST_FENCE = /^[ \t]*(?:`{3,}|~{3,})/m;

// Sections come from Obsidian's own parser, through the undocumented computeMetadataAsync, so the
// split matches what the editor renders. A missing method rejects and the caller falls back to a line diff.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/348
export async function splitMarkdown(app: App, source: string): Promise<MarkdownSplit> {
  const parser = app.metadataCache as unknown as MetadataParser;
  if (typeof parser.computeMetadataAsync !== "function") {
    throw new Error("Obsidian's Markdown parser is unavailable");
  }
  const buffer = new TextEncoder().encode(source).buffer as ArrayBuffer;
  const metadata = await parser.computeMetadataAsync(buffer);
  const lines = source.split("\n");
  const blocks: MarkdownBlock[] = [];
  let frontmatter: string | null = null;
  for (const { type, position } of metadata.sections ?? []) {
    const text = lines.slice(position.start.line, position.end.line + 1).join("\n");
    if (type === "yaml" && position.start.line === 0) {
      frontmatter = text;
    } else if (type === "list" && LIST_FENCE.test(text)) {
      blocks.push({ type: "code", text });
    } else {
      blocks.push({ type: SECTION_BLOCK_TYPES[type] ?? "text", text });
    }
  }
  return { frontmatter, blocks: blocks.length === 0 ? EMPTY_BLOCKS : blocks };
}
