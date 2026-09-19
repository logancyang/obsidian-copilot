/**
 * Insertion and deletion boundaries are carried through the Markdown renderer as
 * reserved internal boundaries U+E000-U+E003. Callers must avoid sentinel-bearing
 * raw input: this post-pass cannot distinguish literal private-use characters
 * from deliberately inserted boundaries.
 */
const SENTINEL_BLOCK_START = 0xe000;
export const INS_OPEN = String.fromCharCode(SENTINEL_BLOCK_START);
export const INS_CLOSE = String.fromCharCode(SENTINEL_BLOCK_START + 1);
export const DEL_OPEN = String.fromCharCode(SENTINEL_BLOCK_START + 2);
export const DEL_CLOSE = String.fromCharCode(SENTINEL_BLOCK_START + 3);

export const INS_CLASS = "copilot-diff-ins";
export const DEL_CLASS = "copilot-diff-del";
export const ROW_INS_CLASS = "copilot-diff-row-ins";
export const ROW_DEL_CLASS = "copilot-diff-row-del";
export const TASK_INS_CLASS = "copilot-diff-task-ins";

const SENTINEL = new RegExp(`[${INS_OPEN}-${DEL_CLOSE}]`);

type Mode = "ins" | "del" | null;
type CellChange = "ins" | "del" | "empty" | "mixed";

/**
 * Replaces the sentinel boundaries left in rendered Markdown with `<ins>` and
 * `<del>` elements and strips the sentinels themselves.
 *
 * The open/close state is carried across element boundaries on purpose: a
 * deletion that starts in a paragraph and runs through a `<strong>` arrives as
 * several text nodes, and every one of them has to be marked for the strike to
 * look continuous.
 * @param root - Container holding one rendered Markdown fragment.
 */
export function applySentinels(root: HTMLElement): void {
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    textNodes.push(node as Text);
  }

  let mode: Mode = null;
  for (const node of textNodes) {
    const value = node.nodeValue ?? "";
    if (mode === null && !SENTINEL.test(value)) continue;
    const fragment = doc.win.createFragment();
    let buffer = "";
    const flush = (): void => {
      if (buffer === "") return;
      fragment.appendChild(
        mode === null ? doc.createTextNode(buffer) : markedElement(doc, mode, buffer)
      );
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
        mode = null;
        continue;
      }
      buffer += character;
    }
    flush();
    node.parentNode?.replaceChild(fragment, node);
  }

  tagFullyChangedRows(root);
  tagInsertedTasks(root);
}

function markedElement(doc: Document, mode: Exclude<Mode, null>, text: string): HTMLElement {
  const element = doc.win.createEl(mode === "ins" ? "ins" : "del");
  element.className = mode === "ins" ? INS_CLASS : DEL_CLASS;
  element.appendChild(doc.createTextNode(text));
  return element;
}

/**
 * A table row whose every cell was replaced reads as a row-level change, not as a
 * string of coincidental cell edits, so it is tinted as a whole.
 */
function tagFullyChangedRows(root: HTMLElement): void {
  for (const row of Array.from(root.querySelectorAll("tr"))) {
    const cells = Array.from(row.querySelectorAll("td, th"));
    if (cells.length === 0) continue;
    const changes = cells.map(cellChange);
    if (changes.some((change) => change === "mixed")) continue;
    const changed = changes.filter((change) => change !== "empty");
    if (changed.length === 0) continue;
    if (changed.every((change) => change === "ins")) row.classList.add(ROW_INS_CLASS);
    else if (changed.every((change) => change === "del")) row.classList.add(ROW_DEL_CLASS);
  }
}

/**
 * The reading view strikes a completed task through. Inside a diff a strike
 * means "removed", so a task the agent added and ticked in the same turn would
 * read as a deletion; the lines the diff inserted are marked so the stylesheet
 * can drop that decoration on them alone and leave untouched tasks looking
 * exactly as they do in the note.
 */
function tagInsertedTasks(root: HTMLElement): void {
  for (const item of Array.from(root.querySelectorAll("li.task-list-item.is-checked"))) {
    // Nested task insertions must not remove an untouched parent's completion strike.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/348
    const hasOwnInsertion = Array.from(item.querySelectorAll(`ins.${INS_CLASS}`)).some(
      (insertion) => insertion.closest("li") === item
    );
    if (!hasOwnInsertion) continue;
    item.classList.add(TASK_INS_CLASS);
  }
}

function cellChange(cell: Element): CellChange {
  let sawIns = false;
  let sawDel = false;
  const walker = cell.ownerDocument.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if ((node.nodeValue ?? "").trim() === "") continue;
    const marked = (node.parentElement as Element | null)?.closest(
      `ins.${INS_CLASS}, del.${DEL_CLASS}`
    );
    if (marked === null || marked === undefined || !cell.contains(marked)) return "mixed";
    if (marked.tagName === "INS") sawIns = true;
    else sawDel = true;
  }
  if (sawIns && sawDel) return "mixed";
  if (sawIns) return "ins";
  if (sawDel) return "del";
  return "empty";
}
