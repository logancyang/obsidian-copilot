export const SORT_STRATEGIES = ["recent", "created", "name", "manual"] as const;

/**
 * Supported sort strategies for lists that can be ordered by "recent usage".
 */
export type SortStrategy = (typeof SORT_STRATEGIES)[number];

export interface RecentUsageSortGetters<T> {
  /**
   * Human-readable name used for alphabetical sorting and tie-breaking.
   */
  getName: (item: T) => string;

  /**
   * Creation time in epoch milliseconds.
   */
  getCreatedAtMs: (item: T) => number;

  /**
   * Last-used/accessed time in epoch milliseconds.
   * When missing, callers should treat it as unknown.
   */
  getLastUsedAtMs: (item: T) => number | null | undefined;

  /**
   * Manual sort order (lower comes first). Only used when strategy is `manual`.
   */
  getManualOrder?: (item: T) => number;
}

/**
 * Type guard for {@link SortStrategy}.
 */
export function isSortStrategy(value: unknown): value is SortStrategy {
  return typeof value === "string" && (SORT_STRATEGIES as readonly string[]).includes(value);
}

/**
 * Normalize a name for consistent sorting.
 */
function normalizeName(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Normalize an epoch timestamp (ms) from unknown values.
 */
function normalizeTimestampMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }

  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric;
    }

    const parsedDate = Date.parse(value);
    if (Number.isFinite(parsedDate)) {
      return parsedDate;
    }
  }

  return null;
}

/**
 * Create a comparator for sorting items by {@link SortStrategy}.
 *
 * - `recent`: descending by `lastUsedAt` (falls back to `createdAt` when missing)
 * - `created`: descending by `createdAt`
 * - `name`: ascending by `name` (using default locale comparison via Intl.Collator)
 * - `manual`: ascending by `manualOrder` (falls back to `name` when unavailable)
 */
export function createSortComparator<T>(
  strategy: SortStrategy,
  getters: RecentUsageSortGetters<T>
): (a: T, b: T) => number {
  // Use default Intl.Collator to match localeCompare behavior for backwards compatibility
  const collator = new Intl.Collator(undefined);

  const getName = (item: T): string => normalizeName(getters.getName(item));

  const getCreatedAtMs = (item: T): number => {
    const createdAtMs = getters.getCreatedAtMs(item);
    return Number.isFinite(createdAtMs) ? createdAtMs : 0;
  };

  const getEffectiveLastUsedAtMs = (item: T): number => {
    const createdAtMs = getCreatedAtMs(item);
    const lastUsedAtMs = normalizeTimestampMs(getters.getLastUsedAtMs(item));
    return lastUsedAtMs ?? createdAtMs;
  };

  const getManualOrder =
    typeof getters.getManualOrder === "function"
      ? (item: T): number => {
          const order = getters.getManualOrder?.(item);
          return typeof order === "number" && Number.isFinite(order) ? order : 0;
        }
      : null;

  // Fallback to name sorting if manual strategy requested but no getManualOrder provided
  const effectiveStrategy: SortStrategy =
    strategy === "manual" && !getManualOrder ? "name" : strategy;

  return (a: T, b: T) => {
    const aName = getName(a);
    const bName = getName(b);

    const aCreated = getCreatedAtMs(a);
    const bCreated = getCreatedAtMs(b);

    const aRecent = getEffectiveLastUsedAtMs(a);
    const bRecent = getEffectiveLastUsedAtMs(b);

    // Primary sort based on strategy
    if (effectiveStrategy === "manual") {
      const aOrder = getManualOrder!(a);
      const bOrder = getManualOrder!(b);
      if (aOrder !== bOrder) {
        return aOrder - bOrder;
      }
    } else if (effectiveStrategy === "name") {
      const nameDiff = collator.compare(aName, bName);
      if (nameDiff !== 0) return nameDiff;
    } else if (effectiveStrategy === "created") {
      const createdDiff = bCreated - aCreated;
      if (createdDiff !== 0) return createdDiff;
    } else {
      // recent
      const recentDiff = bRecent - aRecent;
      if (recentDiff !== 0) return recentDiff;
    }

    // Tie-breakers: name -> created -> recent
    const fallbackNameDiff = collator.compare(aName, bName);
    if (fallbackNameDiff !== 0) return fallbackNameDiff;

    const fallbackCreatedDiff = bCreated - aCreated;
    if (fallbackCreatedDiff !== 0) return fallbackCreatedDiff;

    const fallbackRecentDiff = bRecent - aRecent;
    if (fallbackRecentDiff !== 0) return fallbackRecentDiff;

    return 0;
  };
}

/**
 * Return a new array sorted by the provided {@link SortStrategy}.
 */
export function sortByStrategy<T>(
  items: readonly T[],
  strategy: SortStrategy,
  getters: RecentUsageSortGetters<T>
): T[] {
  return [...items].sort(createSortComparator(strategy, getters));
}

export interface TouchThrottleOptions {
  /**
   * Minimum time between two persisted touches for the same key (per session).
   * Defaults to 30 seconds.
   */
  minIntervalMs?: number;

  /**
   * Clock source for testing.
   */
  nowMs?: () => number;
}

/**
 * In-memory "touch" manager with throttled persistence.
 *
 * Key design: separates "memory update" from "persistence decision":
 * - `touch()` always updates memory and returns current timestamp (for UI sorting)
 * - `shouldPersist()` decides if persistence is needed (throttled, side-effect free)
 * - `markPersisted()` records a successful persistence after the side-effect succeeds
 * - `getLastTouchedAt()` returns memory value (for sorting, takes priority over persisted)
 * - `subscribe()` / `getRevision()` enable UI re-sorting when memory changes
 *
 * This ensures UI always reflects the latest access order, while disk writes are throttled.
 */
export class RecentUsageManager<Key extends string = string> {
  private readonly minIntervalMs: number;
  private readonly nowMs: () => number;
  private readonly lastTouchedAtMsByKey: Map<Key, number> = new Map();
  private readonly lastPersistedAtMsByKey: Map<Key, number> = new Map();
  private revision = 0;
  private readonly listeners: Set<() => void> = new Set();

  constructor(options: TouchThrottleOptions = {}) {
    this.minIntervalMs = options.minIntervalMs ?? 30_000;
    this.nowMs = options.nowMs ?? (() => Date.now());
  }

  /**
   * Notify subscribers after in-memory state changes.
   */
  private notifyChange(): void {
    this.revision += 1;
    for (const listener of this.listeners) {
      listener();
    }
  }

  /**
   * Return a monotonically increasing revision number that changes whenever
   * in-memory touch timestamps change. Useful as a React dependency.
   */
  getRevision(): number {
    return this.revision;
  }

  /**
   * Subscribe to in-memory changes (touch/clear).
   *
   * @param listener - Invoked after a change is recorded.
   * @returns Unsubscribe function.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Record a touch for the given key. Always updates memory and returns current timestamp.
   * Use this value for UI sorting to ensure immediate feedback.
   *
   * @param key - Stable key for the item (e.g. file path, project id).
   * @returns Current timestamp (always returns a value, never null).
   */
  touch(key: Key): number {
    const now = this.nowMs();
    this.lastTouchedAtMsByKey.set(key, now);
    this.notifyChange();
    return now;
  }

  /**
   * Decide whether the last touch should be persisted.
   *
   * This method is intentionally side-effect free. Call {@link markPersisted}
   * only after the persistence side-effect succeeds.
   *
   * @param key - Stable key for the item.
   * @param persistedLastUsedAtMs - The last-used timestamp already stored on disk.
   * @returns Timestamp to persist, or null if throttled.
   */
  shouldPersist(key: Key, persistedLastUsedAtMs?: number | null): number | null {
    const lastTouched = this.lastTouchedAtMsByKey.get(key);
    if (!lastTouched) {
      return null;
    }

    const persisted = normalizeTimestampMs(persistedLastUsedAtMs);
    const lastPersisted = this.lastPersistedAtMsByKey.get(key);

    // Use the most recent of persisted value and our last persistence record
    const effectiveLastPersisted = Math.max(persisted ?? 0, lastPersisted ?? 0);

    // If never persisted before, always allow first persistence
    if (effectiveLastPersisted === 0) {
      return lastTouched;
    }

    // Throttle: don't persist if within minIntervalMs of last persistence
    if (lastTouched - effectiveLastPersisted < this.minIntervalMs) {
      return null;
    }

    return lastTouched;
  }

  /**
   * Mark that a touch was successfully persisted for throttling purposes.
   * Call this only after the persistence side-effect succeeds.
   *
   * @param key - Stable key for the item.
   * @param persistedAtMs - The timestamp that was persisted (epoch ms).
   */
  markPersisted(key: Key, persistedAtMs: number): void {
    const normalized = normalizeTimestampMs(persistedAtMs);
    if (!normalized) {
      return;
    }

    const existing = this.lastPersistedAtMsByKey.get(key) ?? 0;
    this.lastPersistedAtMsByKey.set(key, Math.max(existing, normalized));
  }

  /**
   * Get the in-memory last touched timestamp for a key.
   * Use this for sorting to ensure UI reflects the latest access order.
   *
   * @param key - Stable key for the item.
   * @returns In-memory timestamp, or null if never touched in this session.
   */
  getLastTouchedAt(key: Key): number | null {
    return this.lastTouchedAtMsByKey.get(key) ?? null;
  }

  /**
   * Get the effective last used timestamp for sorting.
   * Prefers in-memory value over persisted value.
   *
   * @param key - Stable key for the item.
   * @param persistedLastUsedAtMs - The persisted timestamp from storage.
   * @returns The most recent timestamp (memory or persisted).
   */
  getEffectiveLastUsedAt(key: Key, persistedLastUsedAtMs?: number | null): number {
    const memoryValue = this.lastTouchedAtMsByKey.get(key);
    const persistedValue = normalizeTimestampMs(persistedLastUsedAtMs);
    return Math.max(memoryValue ?? 0, persistedValue ?? 0);
  }

  /**
   * Clear state for a specific key or for all keys.
   */
  clear(key?: Key): void {
    if (key) {
      this.lastTouchedAtMsByKey.delete(key);
      this.lastPersistedAtMsByKey.delete(key);
      this.notifyChange();
      return;
    }
    this.lastTouchedAtMsByKey.clear();
    this.lastPersistedAtMsByKey.clear();
    this.notifyChange();
  }
}
