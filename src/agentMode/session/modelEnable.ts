import type { ModelInfo } from "@agentclientprotocol/sdk";
import type { BackendDescriptor } from "@/agentMode/session/types";

/**
 * User overrides win; absent overrides fall through to the descriptor's
 * default policy; absent policy = default-enabled.
 */
export function isAgentModelEnabled(
  descriptor: BackendDescriptor,
  model: ModelInfo,
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
  model: ModelInfo,
  overrides: Record<string, boolean> | undefined,
  keepModelId: string | null
): boolean {
  if (keepModelId && model.modelId === keepModelId) return true;
  return isAgentModelEnabled(descriptor, model, overrides);
}
