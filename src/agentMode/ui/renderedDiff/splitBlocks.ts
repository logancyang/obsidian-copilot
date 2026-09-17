/** The structural kinds the line-based splitter can recognise without a Markdown parser. */
export type MarkdownBlockType = "code" | "heading" | "table" | "thematicBreak" | "text";

/** One top-level chunk of a Markdown document, kept as its verbatim source. */
export interface MarkdownBlock {
  type: MarkdownBlockType;
  text: string;
}

/** A document separated into its leading YAML frontmatter and everything after it. */
export interface FrontmatterSplit {
  /** Frontmatter including both `---` fences, or null when the document has none. */
  frontmatter: string | null;
  body: string;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const HEADING = /^ {0,3}#{1,6}(?:\s|$)/;
const THEMATIC_BREAK = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const TABLE_DELIMITER = /^[ \t]*\|?[\s:|-]*-[\s:|-]*\|?[ \t]*$/;

/**
 * Separates a leading YAML frontmatter block so it never reaches the Markdown
 * renderer alongside diff markers: a marker next to a `---` fence would turn the
 * frontmatter into a thematic break and spill its keys into the document body.
 * @param source - Whole file content for one side of the diff.
 */
export function splitFrontmatter(source: string): FrontmatterSplit {
  const lines = source.split("\n");
  if (lines[0] !== "---") return { frontmatter: null, body: source };
  for (let index = 1; index < lines.length; index++) {
    if (lines[index] !== "---") continue;
    return {
      frontmatter: lines.slice(0, index + 1).join("\n"),
      body: lines
        .slice(index + 1)
        .join("\n")
        .replace(/^\n+/, ""),
    };
  }
  return { frontmatter: null, body: source };
}

/**
 * Splits a Markdown body into the top-level blocks the diff aligns against.
 * A line-based splitter is deliberate: a parser would hand back an AST we would
 * have to serialise again, and round-tripping Obsidian-flavoured syntax
 * (callouts, embeds, Dataview) loses fidelity the diff needs to preserve.
 * @param body - Document content with any frontmatter already removed.
 */
export function splitBlocks(body: string): MarkdownBlock[] {
  const lines = body.split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (line.trim() === "") {
      index++;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const start = index;
      index = skipFencedCode(lines, index, fence[1]);
      blocks.push({ type: "code", text: lines.slice(start, index).join("\n") });
      continue;
    }
    if (HEADING.test(line)) {
      blocks.push({ type: "heading", text: line });
      index++;
      continue;
    }
    if (THEMATIC_BREAK.test(line)) {
      blocks.push({ type: "thematicBreak", text: line });
      index++;
      continue;
    }
    if (startsTable(lines, index)) {
      const start = index;
      index += 2;
      while (index < lines.length && lines[index].trim() !== "" && lines[index].includes("|"))
        index++;
      blocks.push({ type: "table", text: lines.slice(start, index).join("\n") });
      continue;
    }
    const start = index;
    index++;
    while (index < lines.length && continuesTextBlock(lines, index)) index++;
    blocks.push({ type: "text", text: lines.slice(start, index).join("\n") });
  }
  return blocks;
}

function skipFencedCode(lines: string[], start: number, marker: string): number {
  const closing = new RegExp(`^ {0,3}${marker[0]}{${marker.length},}[ \\t]*$`);
  let index = start + 1;
  while (index < lines.length && !closing.test(lines[index])) index++;
  return Math.min(index + 1, lines.length);
}

function startsTable(lines: string[], index: number): boolean {
  const delimiter = lines[index + 1];
  return (
    lines[index].includes("|") &&
    delimiter !== undefined &&
    delimiter.includes("|") &&
    TABLE_DELIMITER.test(delimiter)
  );
}

function continuesTextBlock(lines: string[], index: number): boolean {
  const line = lines[index];
  return (
    line.trim() !== "" &&
    !HEADING.test(line) &&
    !THEMATIC_BREAK.test(line) &&
    !FENCE.test(line) &&
    !startsTable(lines, index)
  );
}
