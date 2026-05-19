import { getBackendModelOverrides } from "@/agentMode/session/backendSettingsAccess";
import type { BackendDescriptor, BackendId, BackendModelInfo } from "@/agentMode/session/types";
import { getSettings, updateAgentModeBackendFields, type CopilotSettings } from "@/settings/model";

/**
 * User overrides win; absent overrides fall through to the descriptor's
 * default policy; absent policy = default-enabled.
 */
export function isAgentModelEnabled(
  descriptor: BackendDescriptor,
  model: BackendModelInfo,
  overrides: Record<string, boolean> | undefined
): boolean {
  const override = overrides?.[model.modelId];
  if (typeof override === "boolean") return override;
  return descriptor.isModelEnabledByDefault?.(model) ?? true;
}

/**
 * `keepModelId` carves out the user's current selection so curation never
 * strands it.
 */
export function isAgentModelEnabledOrKept(
  descriptor: BackendDescriptor,
  model: BackendModelInfo,
  overrides: Record<string, boolean> | undefined,
  keepModelId: string | null
): boolean {
  if (keepModelId && model.modelId === keepModelId) return true;
  return isAgentModelEnabled(descriptor, model, overrides);
}

/**
 * Atomic per-backend slice update for a single model toggle. Composes the
 * next `modelEnabledOverrides` map by reading the previous one off current
 * settings; `updateAgentModeBackendFields` merges it back in. Shared by
 * the Agents-tab selected list and the catalog modal so both surfaces
 * agree on the persistence path.
 */
export function writeAgentModelOverride(
  backendId: BackendId,
  baseModelId: string,
  enabled: boolean
): void {
  const prev = getBackendModelOverrides(getSettings(), backendId) ?? {};
  const next: Record<string, boolean> = { ...prev, [baseModelId]: enabled };
  type BackendKey = keyof CopilotSettings["agentMode"]["backends"];
  updateAgentModeBackendFields(backendId as BackendKey, { modelEnabledOverrides: next });
}
