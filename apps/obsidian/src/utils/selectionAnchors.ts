export interface SelectionAnchors {
  bottomPos: number;
  topPos: number;
  focusPos: number;
}

export function computeSelectionAnchors(
  selection: { from: number; to: number; head: number; empty: boolean },
  doc: { lineAt(pos: number): { from: number } }
): SelectionAnchors {
  const topPos = selection.from;
  let bottomPos = selection.to;
  let focusPos = selection.head;

  if (!selection.empty && bottomPos > 0) {
    if (doc.lineAt(bottomPos).from === bottomPos) {
      bottomPos = bottomPos - 1;
    }
  }

  if (!selection.empty && focusPos > 0 && focusPos === selection.to) {
    if (doc.lineAt(focusPos).from === focusPos) {
      focusPos = focusPos - 1;
    }
  }

  return { bottomPos, topPos, focusPos };
}
