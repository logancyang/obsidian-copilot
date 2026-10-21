import type { App } from "obsidian";

export interface MarkdownSection {
  type: string;
  position: { start: { line: number; offset: number }; end: { line: number; offset: number } };
}

export interface MarkdownListItem {
  parent: number;
  position: { start: { line: number } };
}

export interface MarkdownSections {
  sections: readonly MarkdownSection[];
  listItems: readonly MarkdownListItem[];
}

interface ParsedMetadata {
  sections?: MarkdownSection[];
  listItems?: MarkdownListItem[];
}

interface MetadataParser {
  computeMetadataAsync?: (buffer: ArrayBuffer) => Promise<ParsedMetadata>;
}

const EMPTY_LIST_ITEMS: readonly MarkdownListItem[] = Object.freeze([]);

// Sections come from Obsidian's own parser, through the undocumented computeMetadataAsync, so a
// split matches what the editor renders. A missing method rejects so each caller picks its fallback.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/348
export async function parseMarkdownSections(app: App, source: string): Promise<MarkdownSections> {
  const parser = app.metadataCache as unknown as MetadataParser;
  if (typeof parser.computeMetadataAsync !== "function") {
    throw new Error("Obsidian's Markdown parser is unavailable");
  }
  const buffer = new TextEncoder().encode(source).buffer as ArrayBuffer;
  const metadata = await parser.computeMetadataAsync(buffer);
  return {
    // After a note ending in a footnote definition Obsidian appends empty sections past its end.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/348
    sections: (metadata.sections ?? []).filter(
      ({ position }) => position.start.offset !== position.end.offset
    ),
    listItems: metadata.listItems ?? EMPTY_LIST_ITEMS,
  };
}

export function extraBlankLinesBetween(previous: MarkdownSection, next: MarkdownSection): number {
  return Math.max(0, next.position.start.line - previous.position.end.line - 2);
}

// Markdown merges a run of blank lines into one paragraph break, while Live Preview shows each one,
// so every blank line past the first becomes a <br> line between the two sections.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/751
export async function withBlankLineBreaks(app: App, markdown: string): Promise<string> {
  const { sections } = await parseMarkdownSections(app, markdown);
  const lines = markdown.split("\n");
  const kept: string[] = [];
  let copied = 0;
  for (let index = 1; index < sections.length; index++) {
    const previous = sections[index - 1];
    const extra = extraBlankLinesBetween(previous, sections[index]);
    if (extra === 0) continue;
    kept.push(...lines.slice(copied, previous.position.end.line + 1), "");
    kept.push(...Array<string>(extra).fill("<br>"), "");
    copied = sections[index].position.start.line;
  }
  return copied === 0 ? markdown : [...kept, ...lines.slice(copied)].join("\n");
}
