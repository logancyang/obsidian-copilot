export interface QuickAskAnchorPositions {
  bottomAnchorPos: number | null;
  topAnchorPos: number | null;
  focusAnchorPos: number | null;
}

interface ChangeMapper {
  mapPos(pos: number, assoc?: number): number;
}

export function mapQuickAskAnchorPositions(
  anchors: QuickAskAnchorPositions,
  changes: ChangeMapper
): QuickAskAnchorPositions {
  const { bottomAnchorPos, topAnchorPos, focusAnchorPos } = anchors;

  if (bottomAnchorPos !== null && bottomAnchorPos === topAnchorPos) {
    const mapped = changes.mapPos(bottomAnchorPos, 1);
    return { bottomAnchorPos: mapped, topAnchorPos: mapped, focusAnchorPos: mapped };
  }

  const focusAssoc = focusAnchorPos === topAnchorPos ? 1 : -1;

  return {
    bottomAnchorPos: bottomAnchorPos !== null ? changes.mapPos(bottomAnchorPos, -1) : null,
    topAnchorPos: topAnchorPos !== null ? changes.mapPos(topAnchorPos, 1) : null,
    focusAnchorPos: focusAnchorPos !== null ? changes.mapPos(focusAnchorPos, focusAssoc) : null,
  };
}
