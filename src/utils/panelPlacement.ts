/**
 * Pure vertical placement logic for selection-anchored panels
 * (Quick Command, Custom Command, etc.).
 *
 * Extracted so the branching can be tested without DOM / CodeMirror dependencies.
 */

export interface Rect {
  top: number;
  bottom: number;
}

export interface VerticalPlacementInput {
  /** Editor visible scroll area. */
  scrollRect: Rect;
  /** Coords of the bottom selection anchor (null if not visible). */
  visibleBottom: Rect | null;
  /** Coords of the top selection anchor (null if not visible). */
  visibleTop: Rect | null;
  /** Estimated panel height. */
  panelHeight: number;
  /** Minimum margin from viewport edge. */
  margin: number;
  /** Gap between anchor and panel. */
  gap: number;
  /** Viewport height (window.innerHeight). */
  viewportHeight: number;
}

export interface VerticalPlacementResult {
  top: number;
  /** Set only when panel is placed above, for upward-growth anchoring. */
  anchorBottomY?: number;
}

/**
 * Decides the vertical position for a selection-anchored panel.
 *
 * Priority:
 * 1. Both anchors visible → below > above > center
 * 2. Only bottom visible → below if fits, otherwise center
 * 3. Only top visible → above > center
 * 4. Neither → center
 */
export function computeVerticalPlacement(input: VerticalPlacementInput): VerticalPlacementResult {
  const { scrollRect, visibleBottom, visibleTop, panelHeight, margin, gap, viewportHeight } = input;

  const editorCenter = (scrollRect.top + scrollRect.bottom) / 2 - panelHeight / 2;
  const requiredSpace = panelHeight + margin;

  let top: number;
  let anchorBottomY: number | undefined;

  if (visibleBottom && visibleTop) {
    const spaceBelow = scrollRect.bottom - visibleBottom.bottom - gap;
    const spaceAbove = visibleTop.top - scrollRect.top - gap;

    if (spaceBelow >= requiredSpace) {
      top = visibleBottom.bottom + gap;
    } else if (spaceAbove >= requiredSpace) {
      anchorBottomY = visibleTop.top - gap;
      top = anchorBottomY - panelHeight;
    } else {
      top = editorCenter;
    }
  } else if (visibleBottom) {
    // Reason: Never flip above — that would place panel inside the invisible selection.
    // If below doesn't fit either, center in editor (consistent with other fallbacks).
    const spaceBelow = scrollRect.bottom - visibleBottom.bottom - gap;

    if (spaceBelow >= requiredSpace) {
      top = visibleBottom.bottom + gap;
    } else {
      top = editorCenter;
    }
  } else if (visibleTop) {
    const spaceAbove = visibleTop.top - scrollRect.top - gap;

    if (spaceAbove >= requiredSpace) {
      anchorBottomY = visibleTop.top - gap;
      top = anchorBottomY - panelHeight;
    } else {
      top = editorCenter;
    }
  } else {
    top = editorCenter;
  }

  // Clamp within viewport
  top = Math.max(margin, Math.min(top, viewportHeight - margin - panelHeight));

  return anchorBottomY !== undefined ? { top, anchorBottomY } : { top };
}
