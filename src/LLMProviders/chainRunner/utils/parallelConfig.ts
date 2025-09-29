import { getSettings } from "@/settings/model";

const DEFAULT_CONCURRENCY = 4;
const MIN_CONCURRENCY = 1;
const MAX_CONCURRENCY = 10;

export function clampConcurrency(value: number | undefined): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return DEFAULT_CONCURRENCY;
  }

  const floored = Math.floor(value);
  if (floored < MIN_CONCURRENCY) {
    return MIN_CONCURRENCY;
  }
  if (floored > MAX_CONCURRENCY) {
    return MAX_CONCURRENCY;
  }
  return floored;
}

export interface ParallelToolConfig {
  useParallel: boolean;
  concurrency: number;
}

export function resolveParallelToolConfig(toolCount: number): ParallelToolConfig {
  const settings = getSettings();
  const config = settings.parallelToolCalls ?? { enabled: false, concurrency: DEFAULT_CONCURRENCY };
  const concurrency = clampConcurrency(config.concurrency);
  const useParallel = Boolean(config.enabled) && concurrency > 1 && toolCount > 1;

  return { useParallel, concurrency };
}
