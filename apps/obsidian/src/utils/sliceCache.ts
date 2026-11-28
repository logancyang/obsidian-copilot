export function sliceMemo<S extends object, V>(compute: (source: S) => V): (source: S) => V {
  let cache: { source: S; value: V } | null = null;
  return (source) => {
    if (cache && cache.source === source) return cache.value;
    const value = compute(source);
    cache = { source, value };
    return value;
  };
}

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

export function frozenOr<T>(arr: readonly T[], empty: readonly T[]): readonly T[] {
  return arr.length === 0 ? empty : Object.freeze(arr.slice());
}
