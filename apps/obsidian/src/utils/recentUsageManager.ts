export const SORT_STRATEGIES = ["recent", "created", "name", "manual"] as const;

export type SortStrategy = (typeof SORT_STRATEGIES)[number];

export interface RecentUsageSortGetters<T> {
  getName: (item: T) => string;

  getCreatedAtMs: (item: T) => number;

  getLastUsedAtMs: (item: T) => number | null | undefined;

  getManualOrder?: (item: T) => number;
}

export function isSortStrategy(value: unknown): value is SortStrategy {
  return typeof value === "string" && (SORT_STRATEGIES as readonly string[]).includes(value);
}

function normalizeName(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

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

function createSortComparator<T>(
  strategy: SortStrategy,
  getters: RecentUsageSortGetters<T>
): (a: T, b: T) => number {
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

  const effectiveStrategy: SortStrategy =
    strategy === "manual" && !getManualOrder ? "name" : strategy;

  return (a: T, b: T) => {
    const aName = getName(a);
    const bName = getName(b);

    const aCreated = getCreatedAtMs(a);
    const bCreated = getCreatedAtMs(b);

    const aRecent = getEffectiveLastUsedAtMs(a);
    const bRecent = getEffectiveLastUsedAtMs(b);

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
      const recentDiff = bRecent - aRecent;
      if (recentDiff !== 0) return recentDiff;
    }

    const fallbackNameDiff = collator.compare(aName, bName);
    if (fallbackNameDiff !== 0) return fallbackNameDiff;

    const fallbackCreatedDiff = bCreated - aCreated;
    if (fallbackCreatedDiff !== 0) return fallbackCreatedDiff;

    const fallbackRecentDiff = bRecent - aRecent;
    if (fallbackRecentDiff !== 0) return fallbackRecentDiff;

    return 0;
  };
}

export function sortByStrategy<T>(
  items: readonly T[],
  strategy: SortStrategy,
  getters: RecentUsageSortGetters<T>
): T[] {
  return [...items].sort(createSortComparator(strategy, getters));
}

export interface TouchThrottleOptions {
  minIntervalMs?: number;

  nowMs?: () => number;
}

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

  private notifyChange(): void {
    this.revision += 1;
    for (const listener of this.listeners) {
      listener();
    }
  }

  getRevision(): number {
    return this.revision;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  touch(key: Key): number {
    const now = this.nowMs();
    this.lastTouchedAtMsByKey.set(key, now);
    this.notifyChange();
    return now;
  }

  shouldPersist(key: Key, persistedLastUsedAtMs?: number | null): number | null {
    const lastTouched = this.lastTouchedAtMsByKey.get(key);
    if (!lastTouched) {
      return null;
    }

    const persisted = normalizeTimestampMs(persistedLastUsedAtMs);
    const lastPersisted = this.lastPersistedAtMsByKey.get(key);

    const effectiveLastPersisted = Math.max(persisted ?? 0, lastPersisted ?? 0);

    if (effectiveLastPersisted === 0) {
      return lastTouched;
    }

    if (lastTouched - effectiveLastPersisted < this.minIntervalMs) {
      return null;
    }

    return lastTouched;
  }

  markPersisted(key: Key, persistedAtMs: number): void {
    const normalized = normalizeTimestampMs(persistedAtMs);
    if (!normalized) {
      return;
    }

    const existing = this.lastPersistedAtMsByKey.get(key) ?? 0;
    this.lastPersistedAtMsByKey.set(key, Math.max(existing, normalized));
  }

  getLastTouchedAt(key: Key): number | null {
    return this.lastTouchedAtMsByKey.get(key) ?? null;
  }

  getEffectiveLastUsedAt(key: Key, persistedLastUsedAtMs?: number | null): number {
    const memoryValue = this.lastTouchedAtMsByKey.get(key);
    const persistedValue = normalizeTimestampMs(persistedLastUsedAtMs);
    return Math.max(memoryValue ?? 0, persistedValue ?? 0);
  }
}
