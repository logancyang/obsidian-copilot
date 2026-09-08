/** One advertised reasoning effort; null represents an unset wire value. */
export interface EffortOption {
  value: string | null;
  label: string;
}

/**
 * Every thinking-effort level our backends speak, ascending — least thinking first.
 *
 * Canonical in two directions. It ranks a reported menu so the picker's slider always
 * runs the same way, and it is the vocabulary a backend checks a level against, so an
 * agent-reported string that is not in here is one we cannot place. Agents report their
 * levels in whatever order they please, and one that ranks them by its own rules will
 * hand back a menu that runs backwards.
 * https://github.com/logancyang/obsidian-copilot/issues/2917
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

/**
 * Offer concrete efforts in increasing reasoning order. Unknown levels retain
 * backend order after known levels; an unset preference is not an effort level.
 * @param options Efforts advertised for one model.
 */
export function sortEffortOptions(options: readonly EffortOption[]): EffortOption[] {
  const concrete = options.filter((option) => option.value !== null);
  if (concrete.length === 0) return EMPTY_EFFORT_OPTIONS;
  return concrete.sort((a, b) => effortRank(a.value!) - effortRank(b.value!));
}

function effortRank(value: string): number {
  const rank = EFFORT_LEVELS_ASCENDING.indexOf(value);
  return rank < 0 ? Number.MAX_SAFE_INTEGER : rank;
}

/**
 * Keep a supported preference, otherwise use the lowest advertised effort.
 * Missing catalogs preserve intent until discovery; an empty catalog means no effort control.
 * @param preferred Previously chosen effort, or no preference.
 * @param options Known choices for the selected model; undefined means not discovered yet.
 */
export function resolveEffort(
  preferred: string | null | undefined,
  options: readonly EffortOption[] | undefined
): string | null {
  // Do not erase a saved choice just because discovery has not completed.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/219
  if (options === undefined) return preferred ?? null;
  if (preferred != null && options.some((option) => option.value === preferred)) return preferred;
  // A changed model or removed level must not leave a stale or unset effort.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/219
  return sortEffortOptions(options)[0]?.value ?? null;
}
