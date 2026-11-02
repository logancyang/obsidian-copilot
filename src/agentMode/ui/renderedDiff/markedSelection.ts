import type { Change } from "@/agentMode/ui/renderedDiff/applySentinels";

// Strikethrough and highlight are styling only, so selected diff text carries <del>/<ins> tags the agent reads as
// removed and added; rendered text shows a note's own HTML as styling, never as tags.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/824
const TAG: Record<Change, string> = { deleted: "del", inserted: "ins" };
const LINE_ELEMENTS = "br, p, li, tr, h1, h2, h3, h4, h5, h6, blockquote, pre, dt, dd, div";
const CELL_ELEMENTS = "td, th";

export function markedSelectionText(range: Range): string {
  const common = range.commonAncestorContainer;
  const commonElement =
    common.nodeType === Node.ELEMENT_NODE ? (common as Element) : common.parentElement;
  const enclosing = changeOf(commonElement?.closest("[data-change]") ?? null);
  return mark(textOf(range.cloneContents(), enclosing), enclosing)
    .replace(/<\/(del|ins)>([ \t]*)<\1>/g, "$2")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n\s*\n/g, "\n")
    .trim();
}

function textOf(node: Node, enclosing: Change | null): string {
  // Obsidian's renderer leaves newline-only text between table cells and list items, which would split a row.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/824
  if (node.nodeType === Node.TEXT_NODE) {
    const value = node.nodeValue ?? "";
    return /^\s*\n\s*$/.test(value) ? "" : value;
  }
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : null;
  const change = changeOf(element) ?? enclosing;
  const inner = Array.from(node.childNodes, (child) => textOf(child, change)).join("");
  const text = change === enclosing ? inner : mark(inner, change);
  if (element?.matches(CELL_ELEMENTS)) return `${text}\t`;
  return element?.matches(LINE_ELEMENTS) ? `${text}\n` : text;
}

function mark(text: string, change: Change | null): string {
  const body = text.trim();
  if (change === null || body === "") return text;
  const start = text.indexOf(body);
  const tag = TAG[change];
  return `${text.slice(0, start)}<${tag}>${body}</${tag}>${text.slice(start + body.length)}`;
}

function changeOf(element: Element | null): Change | null {
  const change = element?.getAttribute("data-change");
  return change === "inserted" || change === "deleted" ? change : null;
}
