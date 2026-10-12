import type { App } from "obsidian";

export type MarkdownBlockType = "code" | "heading" | "table" | "text";

export interface MarkdownBlock {
  type: MarkdownBlockType;
  text: string;
  continuesList?: true;
}

export interface MarkdownSplit {
  frontmatter: string | null;
  blocks: readonly MarkdownBlock[];
}

interface ParsedSection {
  type: string;
  position: { start: { line: number; offset: number }; end: { line: number; offset: number } };
}

interface ParsedListItem {
  parent: number;
  position: { start: { line: number } };
}

interface ParsedMetadata {
  sections?: ParsedSection[];
  listItems?: ParsedListItem[];
}

interface MetadataParser {
  computeMetadataAsync?: (buffer: ArrayBuffer) => Promise<ParsedMetadata>;
}

const EMPTY_BLOCKS: readonly MarkdownBlock[] = Object.freeze([]);
// Comments and reference definitions render nothing, and math and raw HTML break when word marks land
// inside them, so these sections get a line diff like fenced code.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/348
const SECTION_BLOCK_TYPES: Readonly<Record<string, MarkdownBlockType>> = {
  code: "code",
  comment: "code",
  definition: "code",
  heading: "heading",
  html: "code",
  math: "code",
  table: "table",
};

// Obsidian indents list content with tabs, so its parser keeps a fence nested in a list item inside
// the list section; the fence still has to stay out of word diffs.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/349
const LIST_FENCE = /^[ \t]*(?:`{3,}|~{3,})/m;

// Items split only when no blank line separates them, so joining them with one newline restores the
// exact source and a loose list keeps its paragraph spacing.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/348
function listBlocks(
  lines: readonly string[],
  first: number,
  last: number,
  itemStarts: readonly number[]
): MarkdownBlock[] {
  const starts = itemStarts.filter((line) => line >= first && line <= last);
  const ends = starts.map((_, index) => (starts[index + 1] ?? last + 1) - 1);
  const spans =
    starts.length > 1 && ends.every((end) => lines[end].trim() !== "")
      ? starts.map((start, index) => [start, ends[index]])
      : [[first, last]];
  return spans.map(([start, end], index) => {
    const text = lines.slice(start, end + 1).join("\n");
    const block: MarkdownBlock = { type: LIST_FENCE.test(text) ? "code" : "text", text };
    return index > 0 ? { ...block, continuesList: true } : block;
  });
}

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
  const itemStarts = (metadata.listItems ?? [])
    .filter((item) => item.parent < 0)
    .map((item) => item.position.start.line);
  const blocks: MarkdownBlock[] = [];
  let frontmatter: string | null = null;
  for (const { type, position } of metadata.sections ?? []) {
    // After a note ending in a footnote definition Obsidian appends empty sections past its end.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/348
    if (position.start.offset === position.end.offset) continue;
    const text = lines.slice(position.start.line, position.end.line + 1).join("\n");
    if (type === "yaml" && position.start.line === 0) {
      frontmatter = text;
    } else if (type === "list") {
      blocks.push(...listBlocks(lines, position.start.line, position.end.line, itemStarts));
    } else {
      blocks.push({ type: SECTION_BLOCK_TYPES[type] ?? "text", text });
    }
  }
  return { frontmatter, blocks: blocks.length === 0 ? EMPTY_BLOCKS : blocks };
}
