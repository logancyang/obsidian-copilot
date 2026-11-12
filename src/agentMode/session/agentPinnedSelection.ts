import type { BackendId, ModelSelection } from "@/agentMode/session/types";

export interface AgentPins {
  backendId: string | null;
  modelId: string | null;
  effort: string | null;
}

export function resolveAgentPinnedSelection(
  pins: AgentPins | null,
  backendId: BackendId,
  fallback: ModelSelection | null
): ModelSelection | null {
  if (!pins) return null;
  if (pins.backendId && pins.backendId !== backendId) return null;
  if (!pins.modelId && !pins.effort) return null;
  if (pins.modelId) return { baseModelId: pins.modelId, effort: pins.effort };
  if (!fallback) return null;
  return { baseModelId: fallback.baseModelId, effort: pins.effort };
}
