/**
 * Pure helpers deriving a model's capabilities from its `ModelInfo`
 * modality/reasoning metadata. `ModelInfo` is the single source of truth:
 * vision is `modalities.input` containing `"image"`, reasoning is the
 * `reasoning` flag. The derivation here MUST match `configuredModelToCustomModel`
 * so what the pickers show equals what the chat bridge derives into
 * `CustomModel.capabilities`.
 */
import { ModelCapability } from "@/constants";
import type { ModelInfo } from "@/modelManagement/types/catalog";

const IMAGE_MODALITY = "image";

const EMPTY_CAPABILITY_LIST: ModelCapability[] = Object.freeze([]) as unknown as ModelCapability[];

export function capabilityListFromModelInfo(info: ModelInfo): ModelCapability[] {
  const reasoning = !!info.reasoning;
  const vision = !!info.modalities?.input?.includes(IMAGE_MODALITY);
  if (!reasoning && !vision) return EMPTY_CAPABILITY_LIST;
  const list: ModelCapability[] = [];
  if (reasoning) list.push(ModelCapability.REASONING);
  if (vision) list.push(ModelCapability.VISION);
  return list;
}

/**
 * Capabilities for a persisted/configured model, or `undefined` when the
 * snapshot carries no modality data at all. The presence of `modalities`
 * is what distinguishes "known to lack vision" (returns a list without
 * `VISION`) from "unknown" (`undefined`) — the latter lets a caller fall
 * back to the live catalog instead of asserting no vision. Used by the agent
 * pickers so a model's vision icon comes from its own `info` first.
 */
export function capabilitiesFromConfiguredInfo(info: ModelInfo): ModelCapability[] | undefined {
  return info.modalities ? capabilityListFromModelInfo(info) : undefined;
}
