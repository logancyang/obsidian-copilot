import type { Change } from "@/agentMode/ui/renderedDiff/applySentinels";

// Strikethrough and highlight are styling only, so selected diff text carries <del>/<ins> tags the agent reads as
// removed and added; rendered text shows a note's own HTML as styling, never as tags.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/824
const TAG: Record<Change, string> = { deleted: "del", inserted: "ins" };
const LINE_ELEMENTS = "br, p, li, tr, h1, h2, h3, h4, h5, h6, blockquote, pre, dt, dd, div";
const CELL_ELEMENTS = "td, th";
const BLOCK_ELEMENTS = `${LINE_ELEMENTS}, ${CELL_ELEMENTS}`;
// Line breaks inside code stand in for this mark until the prose whitespace cleanup is done, so a code block keeps
// its blank lines. https://github.com/Brevilabs/obsidian-copilot-private/issues/824
const CODE_BREAK = "\uE000";

export function markedSelectionText(range: Range): string {
  const common = range.commonAncestorContainer;
  const commonElement =
    common.nodeType === Node.ELEMENT_NODE ? (common as Element) : common.parentElement;
  const enclosing = changeOf(commonElement?.closest("[data-change]") ?? null);
  const inCode = commonElement?.closest("pre") != null;
  return mark(textOf(range.cloneContents(), enclosing, inCode), enclosing)
    .replace(/<\/(del|ins)>([ \t]*)<\1>/g, "$2")
    .replace(/\n\s*\n/g, "\n")
    .replaceAll(CODE_BREAK, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/^\s*\n/, "")
    .trimEnd();
}

function textOf(node: Node, enclosing: Change | null, inCode: boolean): string {
  // Obsidian's renderer leaves whitespace between table cells and list items, which would split a row; whitespace
  // between a code block's highlighted tokens is the code's own line breaks and indentation.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/824
  if (node.nodeType === Node.TEXT_NODE) {
    const value = node.nodeValue ?? "";
    if (inCode) return value.replaceAll("\n", CODE_BREAK);
    return !value.trim() && [node.previousSibling, node.nextSibling].some(isBlock) ? "" : value;
  }
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : null;
  // A selection across a run also spans its Revoke button, whose label is not note text.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/824
  if (element?.matches("button")) return "";
  const change = changeOf(element) ?? enclosing;
  const childInCode = inCode || element?.matches("pre") === true;
  const inner = Array.from(node.childNodes, (child) => textOf(child, change, childInCode)).join("");
  const text = change === enclosing ? inner : mark(inner, change);
  if (element?.matches(CELL_ELEMENTS)) return `${text}\t`;
  if (!element?.matches(LINE_ELEMENTS)) return text;
  return inCode ? `${text}${CODE_BREAK}` : `${text.replace(/\uE000+$/, "")}\n`;
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
