// Sentinel marks are private-use characters U+E000-U+E003 so they pass through the renderer as plain text;
// the post-pass cannot tell literal ones from inserted ones, so callers must keep them out of raw input.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/348
const SENTINEL_BLOCK_START = 0xe000;
export const INS_OPEN = String.fromCharCode(SENTINEL_BLOCK_START);
export const INS_CLOSE = String.fromCharCode(SENTINEL_BLOCK_START + 1);
export const DEL_OPEN = String.fromCharCode(SENTINEL_BLOCK_START + 2);
export const DEL_CLOSE = String.fromCharCode(SENTINEL_BLOCK_START + 3);

const INS_CLASS = "copilot-diff-ins";
const DEL_CLASS = "copilot-diff-del";
const ROW_INS_CLASS = "copilot-diff-row-ins";
const ROW_DEL_CLASS = "copilot-diff-row-del";
const DEL_END_CLASS = "copilot-diff-del-end";

const SENTINEL = new RegExp(`[${INS_OPEN}-${DEL_CLOSE}]`);

type Mode = "ins" | "del" | null;

const BLOCK_SELECTOR = "p, li, td, th, h1, h2, h3, h4, h5, h6, blockquote, pre, dt, dd, div";

export function applySentinels(root: HTMLElement): void {
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    textNodes.push(node as Text);
  }

  let mode: Mode = null;
  let lastDeleted = null as HTMLElement | null;
  let block: Element | null = null;
  for (const node of textNodes) {
    const nodeBlock = node.parentElement?.closest(BLOCK_SELECTOR) ?? null;
    // Marks never span lines, so a closing sentinel the renderer swallowed (comment, math, callout table)
    // must not leak the mark into every block after it.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/348
    if (nodeBlock !== block) mode = null;
    block = nodeBlock;
    const value = node.nodeValue ?? "";
    if (mode === null && !SENTINEL.test(value)) continue;
    const fragment = doc.win.createFragment();
    let buffer = "";
    const flush = (): void => {
      if (buffer === "") return;
      if (mode === null) fragment.appendChild(doc.createTextNode(buffer));
      else {
        const element = markedElement(doc, mode, buffer);
        if (mode === "del") lastDeleted = element;
        fragment.appendChild(element);
      }
      buffer = "";
    };
    for (const character of value) {
      if (character === INS_OPEN || character === DEL_OPEN) {
        flush();
        mode = character === INS_OPEN ? "ins" : "del";
        continue;
      }
      if (character === INS_CLOSE || character === DEL_CLOSE) {
        flush();
        if (mode === "del") lastDeleted?.classList.add(DEL_END_CLASS);
        mode = null;
        continue;
      }
      buffer += character;
    }
    flush();
    node.parentNode?.replaceChild(fragment, node);
  }

  for (const row of Array.from(root.querySelectorAll("tbody tr"))) {
    const change = rowChange(row);
    if (change !== null) row.classList.add(change === "ins" ? ROW_INS_CLASS : ROW_DEL_CLASS);
  }
}

function markedElement(doc: Document, mode: Exclude<Mode, null>, text: string): HTMLElement {
  const element = doc.win.createEl(mode === "ins" ? "ins" : "del");
  element.className = mode === "ins" ? INS_CLASS : DEL_CLASS;
  element.appendChild(doc.createTextNode(text));
  return element;
}

function rowChange(row: Element): Mode {
  let change: Mode = null;
  const walker = row.ownerDocument.createTreeWalker(row, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if ((node.nodeValue ?? "").trim() === "") continue;
    const marked = node.parentElement?.closest(`ins.${INS_CLASS}, del.${DEL_CLASS}`);
    if (!marked) return null;
    const kind = marked.tagName === "INS" ? "ins" : "del";
    if (change !== null && change !== kind) return null;
    change = kind;
  }
  return change;
}
