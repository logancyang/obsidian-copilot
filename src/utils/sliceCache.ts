/**
 * Tiny memoization helpers for derived views over a settings slice.
 *
 * The pattern: given a source slice (e.g. `getSettings().providers`)
 * that callers re-read every access, cache the derived value (a
 * filtered list, a frozen empty, etc.) keyed on the source-slice
 * reference. `setSettings` always swaps the slice reference when it
 * writes, so a `===` match guarantees the underlying data is
 * unchanged. Returning the same reference on cache hits is what lets
 * downstream Jotai derived atoms and React memoization short-circuit.
 *
 * See AGENTS.md → "Referential stability" for the full rationale.
 */

/**
 * Memoize a single-arg derivation over a settings slice. Returns the
 * cached value when the source reference hasn't changed since the
 * previous call; recomputes otherwise.
 */
export function sliceMemo<S extends object, V>(compute: (source: S) => V): (source: S) => V {
  let cache: { source: S; value: V } | null = null;
  return (source) => {
    if (cache && cache.source === source) return cache.value;
    const value = compute(source);
    cache = { source, value };
    return value;
  };
}

/**
 * Memoize a two-arg derivation `(source, key) → value`. Stores one
 * cache entry per distinct `key`, each validated against the source
 * reference at read time.
 *
 * Note: the internal `Map` is unbounded — callers are responsible for
 * ensuring `K` has finite cardinality (an enum, a small fixed set) or
 * grows at most O(domain size). No LRU.
 */
export function sliceMemoByKey<S extends object, K, V>(
  compute: (source: S, key: K) => V
): (source: S, key: K) => V {
  const cache = new Map<K, { source: S; value: V }>();
  return (source, key) => {
    const hit = cache.get(key);
    if (hit && hit.source === source) return hit.value;
    const value = compute(source, key);
    cache.set(key, { source, value });
    return value;
  };
}

/**
 * Return the shared `empty` constant when `arr` is empty; otherwise
 * a frozen shallow copy of `arr`. The copy step is defensive — callers
 * commonly pass `someSettingsArr.filter(...)` (already a fresh array
 * that's safe to freeze), but accepting `readonly T[]` means we can't
 * assume that, and freezing the settings array itself would be a bug.
 */
export function frozenOr<T>(arr: readonly T[], empty: readonly T[]): readonly T[] {
  return arr.length === 0 ? empty : Object.freeze(arr.slice());
}
