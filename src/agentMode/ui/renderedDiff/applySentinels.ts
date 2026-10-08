import { cn } from "@/lib/utils";

// Sentinel marks are private-use characters U+E000-U+E003 so they pass through the renderer as plain text;
// the post-pass cannot tell literal ones from inserted ones, so callers must keep them out of raw input.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/348
const SENTINEL_BLOCK_START = 0xe000;
export const INS_OPEN = String.fromCharCode(SENTINEL_BLOCK_START);
export const INS_CLOSE = String.fromCharCode(SENTINEL_BLOCK_START + 1);
export const DEL_OPEN = String.fromCharCode(SENTINEL_BLOCK_START + 2);
export const DEL_CLOSE = String.fromCharCode(SENTINEL_BLOCK_START + 3);

export const SENTINEL = new RegExp(`[${INS_OPEN}-${DEL_CLOSE}]`);

type Change = "inserted" | "deleted";
type Mode = Change | null;

// A wholly changed row carries the tint on its cells, so word tints inside it would stack into patches.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/348
const MARK_CLASS: Record<Change, string> = {
  inserted: cn("tw-bg-success tw-no-underline [tr[data-change]_&]:tw-bg-transparent"),
  deleted: cn("tw-bg-error tw-text-muted tw-line-through [tr[data-change]_&]:tw-bg-transparent"),
};
const ROW_CLASS: Record<Change, string> = {
  inserted: cn("[&>td]:tw-bg-overlay-success"),
  deleted: cn("[&>td]:tw-bg-overlay-error"),
};
// A replaced link puts the old and new text in separate anchors, so the gap that keeps them from
// reading as one word sits on the last segment of a deletion that an insertion directly follows.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/348
const DELETION_END_CLASS = "tw-me-1";

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
  let endedDeletion = null as HTMLElement | null;
  let block: Element | null = null;
  for (const node of textNodes) {
    const nodeBlock = node.parentElement?.closest(BLOCK_SELECTOR) ?? null;
    // Marks never span lines, so a closing sentinel the renderer swallowed (comment, math, callout table)
    // must not leak the mark into every block after it.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/348
    if (nodeBlock !== block) {
      mode = null;
      endedDeletion = null;
    }
    block = nodeBlock;
    const value = node.nodeValue ?? "";
    if (mode === null && !SENTINEL.test(value)) {
      endedDeletion = null;
      continue;
    }
    const fragment = doc.win.createFragment();
    let buffer = "";
    const flush = (): void => {
      if (buffer === "") return;
      if (mode === null) fragment.appendChild(doc.createTextNode(buffer));
      else {
        const element = markedElement(doc, mode, buffer);
        if (mode === "deleted") lastDeleted = element;
        fragment.appendChild(element);
      }
      buffer = "";
    };
    for (const character of value) {
      if (character === INS_OPEN || character === DEL_OPEN) {
        flush();
        if (character === INS_OPEN) endedDeletion?.classList.add(DELETION_END_CLASS);
        endedDeletion = null;
        mode = character === INS_OPEN ? "inserted" : "deleted";
        continue;
      }
      if (character === INS_CLOSE || character === DEL_CLOSE) {
        flush();
        endedDeletion = mode === "deleted" ? lastDeleted : null;
        mode = null;
        continue;
      }
      endedDeletion = null;
      buffer += character;
    }
    flush();
    node.parentNode?.replaceChild(fragment, node);
  }

  for (const row of Array.from(root.querySelectorAll("tbody tr"))) {
    const change = rowChange(row);
    if (change === null) continue;
    row.setAttribute("data-change", change);
    row.classList.add(ROW_CLASS[change]);
  }
}

function markedElement(doc: Document, change: Change, text: string): HTMLElement {
  return doc.win.createEl(change === "inserted" ? "ins" : "del", {
    cls: MARK_CLASS[change],
    attr: { "data-change": change },
    text,
  });
}

function rowChange(row: Element): Mode {
  let change: Mode = null;
  const walker = row.ownerDocument.createTreeWalker(row, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if ((node.nodeValue ?? "").trim() === "") continue;
    const marked = node.parentElement?.closest("ins[data-change], del[data-change]");
    if (!marked) return null;
    const kind = marked.tagName === "INS" ? "inserted" : "deleted";
    if (change !== null && change !== kind) return null;
    change = kind;
  }
  return change;
}
