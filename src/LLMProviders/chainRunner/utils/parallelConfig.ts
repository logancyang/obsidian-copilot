import { getSettings } from "@/settings/model";
import {
  DEFAULT_PARALLEL_CONCURRENCY,
  clampParallelConcurrency,
} from "@/utils/parallelConcurrency";

export { clampParallelConcurrency as clampConcurrency } from "@/utils/parallelConcurrency";

export interface ParallelToolConfig {
  useParallel: boolean;
  concurrency: number;
}

export function resolveParallelToolConfig(toolCount: number): ParallelToolConfig {
  const settings = getSettings();
  const config = settings.parallelToolCalls ?? {
    enabled: false,
    concurrency: DEFAULT_PARALLEL_CONCURRENCY,
  };
  const concurrency = clampParallelConcurrency(config.concurrency);
  const useParallel = Boolean(config.enabled) && concurrency > 1 && toolCount > 1;

  return { useParallel, concurrency };
}
