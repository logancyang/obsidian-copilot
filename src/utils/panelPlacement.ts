export interface Rect {
  top: number;
  bottom: number;
}

export interface VerticalPlacementInput {
  scrollRect: Rect;
  visibleBottom: Rect | null;
  visibleTop: Rect | null;
  panelHeight: number;
  margin: number;
  gap: number;
  viewportHeight: number;
}

export interface VerticalPlacementResult {
  top: number;
  anchorBottomY?: number;
}

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

  top = Math.max(margin, Math.min(top, viewportHeight - margin - panelHeight));

  return anchorBottomY !== undefined ? { top, anchorBottomY } : { top };
}
