export interface OverflowPartition<T> {
  visible: T[];
  overflow: T[];
}

export function partitionOverflow<T>(
  items: readonly T[],
  visibleCount: number,
  activeKey: string | null,
  keyOf: (item: T) => string
): OverflowPartition<T> {
  const visible = items.slice(0, visibleCount);
  const overflow = items.slice(visibleCount);
  const active =
    activeKey === null ? undefined : overflow.find((item) => keyOf(item) === activeKey);
  if (!active || visible.length === 0) return { visible, overflow };
  const displaced = visible[visible.length - 1];
  const otherOverflow = overflow.filter((item) => item !== active);
  return {
    visible: [...visible.slice(0, -1), active],
    overflow: displaced ? [displaced, ...otherOverflow] : otherOverflow,
  };
}
