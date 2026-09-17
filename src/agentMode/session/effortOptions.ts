import { sortEffortOptions } from "@/lib/model-effort";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import type { BackendId, EffortOption } from "@/agentMode/session/types";

/** Frozen empty effort list — referential stability for the "no effort" case. */
export const EMPTY_EFFORT_OPTIONS = Object.freeze([]) as unknown as EffortOption[];

/**
 * Effort options for one (backend, model). Prefer options carried by shared
 * model discovery, then fall back to the preloader's per-model effort
 * prefetch. Returns {@link EMPTY_EFFORT_OPTIONS} when the model has none.
 *
 * @param manager - Holder of both probed catalogs.
 * @param backendId - Backend whose catalogs are read.
 * @param baseModelId - Model whose advertised levels are wanted.
 */
export function resolveEffortOptions(
  manager: AgentSessionManager,
  backendId: BackendId,
  baseModelId: string
): EffortOption[] {
  const models = manager.getCachedModelCatalog(backendId)?.availableModels ?? null;
  const found = models?.find((m) => m.baseModelId === baseModelId);
  const reported = found?.effortOptions ?? [];
  if (reported.length > 0) return sortEffortOptions(reported);
  return sortEffortOptions(
    manager.getEffortCatalog(backendId)?.[baseModelId] ?? EMPTY_EFFORT_OPTIONS
  );
}
