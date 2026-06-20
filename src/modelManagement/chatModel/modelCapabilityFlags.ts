/**
 * Pure helpers bridging a `ModelInfo`'s modality/reasoning metadata and the
 * editable capability toggles surfaced in the BYOK "Advanced" panel.
 *
 * Single source of truth is `ModelInfo` itself: a user override is persisted by
 * overlaying it back onto `modalities.input` / `reasoning` (no new field). The
 * derivation here MUST match `configuredModelToCustomModel` so what the panel
 * shows equals what the chat bridge derives into `CustomModel.capabilities`.
 */
import { ModelCapability } from "@/constants";
import type { ModelInfo } from "@/modelManagement/types/catalog";

export interface CapFlags {
  vision: boolean;
  reasoning: boolean;
}

const IMAGE_MODALITY = "image";

const EMPTY_CAPABILITY_LIST: ModelCapability[] = Object.freeze([]) as unknown as ModelCapability[];

export function capsFromModelInfo(info: ModelInfo): CapFlags {
  return {
    vision: !!info.modalities?.input?.includes(IMAGE_MODALITY),
    reasoning: !!info.reasoning,
  };
}

export function capabilityListFromModelInfo(info: ModelInfo): ModelCapability[] {
  const caps = capsFromModelInfo(info);
  if (!caps.reasoning && !caps.vision) return EMPTY_CAPABILITY_LIST;
  const list: ModelCapability[] = [];
  if (caps.reasoning) list.push(ModelCapability.REASONING);
  if (caps.vision) list.push(ModelCapability.VISION);
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

/**
 * Return a NEW `ModelInfo` with `reasoning` and `modalities.input` adjusted to
 * reflect `caps`. Other input modalities (e.g. "text", "audio") and the
 * existing `output` array are preserved; the input object is never mutated.
 */
export function applyCapsToModelInfo(info: ModelInfo, caps: CapFlags): ModelInfo {
  const prevInput = info.modalities?.input ?? [];
  const withoutImage = prevInput.filter((m) => m !== IMAGE_MODALITY);
  const nextInput = caps.vision ? [...withoutImage, IMAGE_MODALITY] : withoutImage;

  const prevOutput = info.modalities?.output;
  // Only attach `modalities` when there's something to carry, so a plain model
  // doesn't grow an empty `{ input: [] }` that the bridge would treat as no-op
  // anyway — keeps the persisted snapshot minimal.
  const nextModalities =
    nextInput.length > 0 || prevOutput !== undefined
      ? {
          ...(nextInput.length > 0 ? { input: nextInput } : {}),
          ...(prevOutput !== undefined ? { output: prevOutput } : {}),
        }
      : undefined;

  const next: ModelInfo = { ...info, reasoning: caps.reasoning };
  if (nextModalities) {
    next.modalities = nextModalities;
  } else {
    delete next.modalities;
  }
  return next;
}
