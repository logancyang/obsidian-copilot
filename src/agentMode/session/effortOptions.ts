import { sortEffortOptions } from "@/lib/model-effort";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import type { BackendId, EffortOption } from "@/agentMode/session/types";

export const EMPTY_EFFORT_OPTIONS = Object.freeze([]) as unknown as EffortOption[];

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
