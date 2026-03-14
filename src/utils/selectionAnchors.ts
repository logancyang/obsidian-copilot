/**
 * Shared utility for computing dual-anchor positions from a CodeMirror selection.
 * Used by Quick Ask and Quick Command to determine panel placement relative to selection.
 */

export interface SelectionAnchors {
  /** Normalized selection.to — visual bottom of the selection (line-start trap applied) */
  bottomPos: number;
  /** selection.from — visual top of the selection */
  topPos: number;
  /** selection.head — the user's focus end (for horizontal anchor in reverse selections) */
  focusPos: number;
}

/**
 * Computes dual-anchor positions from a CodeMirror selection.
 *
 * The "line-start trap" fix handles the case where selecting text that includes
 * a newline causes `selection.to` to land on the next line's start. In this case,
 * `coordsAtPos(to)` would return coordinates for the next line, causing the panel
 * to anchor one line too low. We fix this by backing up to `to - 1`.
 *
 * @param selection - CodeMirror selection with from, to, and empty fields
 * @param doc - Document object with lineAt() for line-start detection
 * @returns Dual anchors: bottomPos for "place below", topPos for "place above"
 */
export function computeSelectionAnchors(
  selection: { from: number; to: number; head: number; empty: boolean },
  doc: { lineAt(pos: number): { from: number } }
): SelectionAnchors {
  const topPos = selection.from;
  let bottomPos = selection.to;
  let focusPos = selection.head;

  // Reason: Line-start trap — only applies to non-empty selections with to > 0.
  // When selection.to lands exactly at a line's start (after selecting a newline),
  // back up one character so coordsAtPos returns the previous line's bottom.
  if (!selection.empty && bottomPos > 0) {
    if (doc.lineAt(bottomPos).from === bottomPos) {
      bottomPos = bottomPos - 1;
    }
  }

  // Reason: Apply the same line-start trap to focusPos when it equals selection.to,
  // so reverse selections still anchor near the user's focus end.
  if (!selection.empty && focusPos > 0 && focusPos === selection.to) {
    if (doc.lineAt(focusPos).from === focusPos) {
      focusPos = focusPos - 1;
    }
  }

  return { bottomPos, topPos, focusPos };
}
