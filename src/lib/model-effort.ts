export interface EffortOption {
  value: string | null;
  label: string;
}

/**
 * Every thinking-effort level our backends speak, ascending. Agents report their levels in
 * whatever order they please, so this ranks a reported menu and is the vocabulary a level is
 * checked against. https://github.com/logancyang/obsidian-copilot/issues/2917
 */
export const EFFORT_LEVELS_ASCENDING: readonly string[] = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

const EMPTY_EFFORT_OPTIONS: EffortOption[] = Object.freeze([]) as unknown as EffortOption[];

export function sortEffortOptions(options: readonly EffortOption[]): EffortOption[] {
  const concrete = options.filter((option) => option.value !== null);
  if (concrete.length === 0) return EMPTY_EFFORT_OPTIONS;
  return concrete.sort((a, b) => effortRank(a.value!) - effortRank(b.value!));
}

function effortRank(value: string): number {
  const rank = EFFORT_LEVELS_ASCENDING.indexOf(value);
  return rank < 0 ? Number.MAX_SAFE_INTEGER : rank;
}

export function resolveEffort(
  preferred: string | null | undefined,
  options: readonly EffortOption[] | undefined
): string | null {
  // Do not erase a saved choice just because discovery has not completed.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/219
  if (options === undefined) return preferred ?? null;
  if (preferred != null && options.some((option) => option.value === preferred)) return preferred;
  return sortEffortOptions(options)[0]?.value ?? null;
}
