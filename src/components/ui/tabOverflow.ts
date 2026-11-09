interface TabStripLayoutInput {
  widths: readonly number[];
  selectedIndex: number;
  available: number;
  gap: number;
  overflowWidth: number;
}

export function computeVisibleTabIndices({
  widths,
  selectedIndex,
  available,
  gap,
  overflowWidth,
}: TabStripLayoutInput): number[] {
  const rowWidth = (indices: readonly number[]) =>
    indices.reduce((sum, i) => sum + widths[i], 0) + gap * Math.max(0, indices.length - 1);

  const all = widths.map((_, i) => i);
  if (rowWidth(all) <= available) return all;

  const budget = available - overflowWidth - gap;
  const visible: number[] = [];
  for (const i of all) {
    if (rowWidth([...visible, i]) > budget) break;
    visible.push(i);
  }
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/891 The Agent Mode chat strip can have no active chat in the current scope, so there may be no selected tab to pin.
  if (selectedIndex < 0 || visible.includes(selectedIndex)) return visible;

  // https://github.com/Brevilabs/obsidian-copilot-private/issues/891 The selected tab must stay visible and highlighted, so it takes the last slot.
  while (visible.length > 0 && rowWidth([...visible, selectedIndex]) > budget) visible.pop();
  return [...visible, selectedIndex];
}
