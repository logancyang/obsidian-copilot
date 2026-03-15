export interface QuickAskAnchorPositions {
  bottomAnchorPos: number | null;
  topAnchorPos: number | null;
  focusAnchorPos: number | null;
}

interface ChangeMapper {
  mapPos(pos: number, assoc?: number): number;
}

/**
 * Maps Quick Ask anchor positions across document changes.
 *
 * Uses explicit assoc to match ReplaceGuard semantics (replaceGuard.ts:159-160):
 * - `topAnchorPos` (selection.from) uses `assoc=1` so insertions before it push it right.
 * - `bottomAnchorPos` (selection.to) uses `assoc=-1` so insertions after it don't move it.
 * - `focusAnchorPos` follows whichever edge currently holds the user's head/focus:
 *   if focus == topPos (reverse selection), assoc=1; if focus == bottomPos (forward), assoc=-1.
 * - Cursor selections (all positions equal) map once to keep anchors identical.
 */
export function mapQuickAskAnchorPositions(
  anchors: QuickAskAnchorPositions,
  changes: ChangeMapper
): QuickAskAnchorPositions {
  const { bottomAnchorPos, topAnchorPos, focusAnchorPos } = anchors;

  // Cursor selection: map once to avoid divergence
  if (bottomAnchorPos !== null && bottomAnchorPos === topAnchorPos) {
    const mapped = changes.mapPos(bottomAnchorPos, 1);
    return { bottomAnchorPos: mapped, topAnchorPos: mapped, focusAnchorPos: mapped };
  }

  // Range selection: each anchor maps with its own assoc
  const focusAssoc = focusAnchorPos === topAnchorPos ? 1 : -1;

  return {
    bottomAnchorPos: bottomAnchorPos !== null ? changes.mapPos(bottomAnchorPos, -1) : null,
    topAnchorPos: topAnchorPos !== null ? changes.mapPos(topAnchorPos, 1) : null,
    focusAnchorPos: focusAnchorPos !== null ? changes.mapPos(focusAnchorPos, focusAssoc) : null,
  };
}
