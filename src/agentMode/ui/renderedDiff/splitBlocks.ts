import {
  extraBlankLinesBetween,
  parseMarkdownSections,
  type MarkdownSection,
} from "@/utils/markdownSections";
import type { App } from "obsidian";

export type MarkdownBlockType = "code" | "heading" | "table" | "text";

export interface MarkdownBlock {
  type: MarkdownBlockType;
  text: string;
  continuesList?: true;
  extraBlankLines?: number;
}

export interface MarkdownSplit {
  frontmatter: string | null;
  blocks: readonly MarkdownBlock[];
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

// Obsidian labels only block-form comments as comment sections; an inline %%comment%% hides its
// edit from a rendered word diff, so any block holding one gets a line diff.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/348
function blockOf(type: MarkdownBlockType, text: string): MarkdownBlock {
  return { type: text.includes("%%") ? "code" : type, text };
}

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
    const block = blockOf(LIST_FENCE.test(text) ? "code" : "text", text);
    return index > 0 ? { ...block, continuesList: true } : block;
  });
}

export async function splitMarkdown(app: App, source: string): Promise<MarkdownSplit> {
  const { sections, listItems } = await parseMarkdownSections(app, source);
  const lines = source.split("\n");
  const itemStarts = listItems
    .filter((item) => item.parent < 0)
    .map((item) => item.position.start.line);
  const blocks: MarkdownBlock[] = [];
  let frontmatter: string | null = null;
  let previous: MarkdownSection | null = null;
  for (const section of sections) {
    const { type, position } = section;
    const text = lines.slice(position.start.line, position.end.line + 1).join("\n");
    if (type === "yaml" && position.start.line === 0) {
      frontmatter = text;
      continue;
    }
    const sectionBlocks =
      type === "list"
        ? listBlocks(lines, position.start.line, position.end.line, itemStarts)
        : [blockOf(SECTION_BLOCK_TYPES[type] ?? "text", text)];
    const extraBlankLines = previous === null ? 0 : extraBlankLinesBetween(previous, section);
    if (extraBlankLines > 0) sectionBlocks[0] = { ...sectionBlocks[0], extraBlankLines };
    blocks.push(...sectionBlocks);
    previous = section;
  }
  return { frontmatter, blocks: blocks.length === 0 ? EMPTY_BLOCKS : blocks };
}
