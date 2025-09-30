export const MIN_PARALLEL_CONCURRENCY = 1;
export const MAX_PARALLEL_CONCURRENCY = 10;
export const DEFAULT_PARALLEL_CONCURRENCY = 10;

export function clampParallelConcurrency(
  value: number | undefined,
  fallback: number = DEFAULT_PARALLEL_CONCURRENCY
): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback;
  }

  const floored = Math.floor(value);
  if (floored < MIN_PARALLEL_CONCURRENCY) {
    return MIN_PARALLEL_CONCURRENCY;
  }

  if (floored > MAX_PARALLEL_CONCURRENCY) {
    return MAX_PARALLEL_CONCURRENCY;
  }

  return floored;
}
