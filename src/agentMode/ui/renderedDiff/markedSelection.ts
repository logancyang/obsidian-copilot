import type { Change } from "@/agentMode/ui/renderedDiff/applySentinels";

// Strikethrough and highlight are styling only, so selected diff text carries <del>/<ins> tags the agent reads as
// removed and added; rendered text shows a note's own HTML as styling, never as tags.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/824
const TAG: Record<Change, string> = { deleted: "del", inserted: "ins" };
const LINE_ELEMENTS =
  "p, li, tr, h1, h2, h3, h4, h5, h6, blockquote, pre, dt, dd, div, ul, ol, table, thead, tbody";
const CELL_ELEMENTS = "td, th";
const BLOCK_ELEMENTS = `${LINE_ELEMENTS}, ${CELL_ELEMENTS}`;

export function markedSelectionText(range: Range): string {
  const common = range.commonAncestorContainer;
  const commonElement =
    common.nodeType === Node.ELEMENT_NODE ? (common as Element) : common.parentElement;
  const enclosing = changeOf(commonElement?.closest("[data-change]") ?? null);
  return mark(textOf(range.cloneContents(), enclosing), enclosing)
    .replace(/<\/(del|ins)>([ \t]*)<\1>/g, "$2")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/^\s*\n/, "")
    .trimEnd();
}

function textOf(node: Node, enclosing: Change | null): string {
  // Obsidian's renderer leaves whitespace between table cells and list items, which would split a row, and writes a
  // soft line break as <br> plus a newline; whitespace between a code block's highlighted tokens is the code's own.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/824
  if (node.nodeType === Node.TEXT_NODE) {
    const raw = node.nodeValue ?? "";
    const value = node.previousSibling?.nodeName === "BR" ? raw.replace(/^\n/, "") : raw;
    return !value.trim() && [node.previousSibling, node.nextSibling].some(isBlock) ? "" : value;
  }
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : null;
  // A selection across a run also spans its Revoke button, whose label is not note text.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/824
  if (element?.matches("button")) return "";
  if (element?.matches("br")) return "\n";
  const change = changeOf(element) ?? enclosing;
  const inner = Array.from(node.childNodes, (child) => textOf(child, change)).join("");
  const text = change === enclosing ? inner : mark(inner, change);
  if (element?.matches(CELL_ELEMENTS)) return `${text}\t`;
  // A block nested in another ends the line once, so the only blank lines left are the code's own.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/824
  if (!element?.matches(LINE_ELEMENTS) || text === "" || text.endsWith("\n")) return text;
  return `${text}\n`;
}

function mark(text: string, change: Change | null): string {
  const body = text.trim();
  if (change === null || body === "") return text;
  const start = text.indexOf(body);
  const tag = TAG[change];
  return `${text.slice(0, start)}<${tag}>${body}</${tag}>${text.slice(start + body.length)}`;
}

function isBlock(node: Node | null): boolean {
  return node?.nodeType === Node.ELEMENT_NODE && (node as Element).matches(BLOCK_ELEMENTS);
}

function changeOf(element: Element | null): Change | null {
  const change = element?.getAttribute("data-change");
  return change === "inserted" || change === "deleted" ? change : null;
}
