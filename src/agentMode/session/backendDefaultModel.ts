/**
 * Translation between the persisted per-backend default
 * (`settings.backends.<id>.default`, a `configuredModelId`) and the wire-form
 * `ModelSelection` the session layer, the descriptors and the pickers speak.
 *
 * The two id spaces exist for different reasons and neither replaces the other:
 * the store needs an id it can check against `enabledModels`, while the agent
 * only understands the id its own codec produces. Converting here means a
 * backend row is the only thing that has to know both.
 */

import type { CopilotSettings } from "@/settings/model";

import type { BackendDescriptor, ModelSelection } from "./types";

/**
 * Key of the persisted backend map, taken from the settings type rather than
 * imported from `@/modelManagement`, which `session/` may not reach.
 */
type BackendKey = keyof CopilotSettings["backends"];

/** The stored default for `backendId` exactly as persisted, without translation. */
export function readStoredDefault(
  settings: CopilotSettings,
  backendId: string
): { configuredModelId: string; effort?: string | null } | undefined {
  return settings.backends?.[backendId as BackendKey]?.default;
}

/**
 * The id `descriptor`'s agent addresses one configured model by, or `null` when
 * that model has no id on this backend.
 *
 * Deliberately independent of `enabledModels`: a default whose model the user
 * later turned off still has to render in settings so they can clear it.
 *
 * A backend that routes Copilot-side providers (opencode) owns the whole
 * mapping, prefix included, so its `getWireBaseId` answers. An agent-native one
 * serves only its own models, whose stored `info.id` already is the wire id up
 * to its codec.
 *
 * @param descriptor - Backend asking; supplies both the routing hook and the codec.
 * @param configuredModelId - Row to translate.
 * @param settings - Snapshot holding the configured-model rows.
 */
function wireBaseIdFor(
  descriptor: BackendDescriptor,
  configuredModelId: string,
  settings: CopilotSettings
): string | null {
  const routed = descriptor.getWireBaseId?.(configuredModelId, settings);
  if (routed !== undefined) return routed;
  const info = settings.configuredModels.find(
    (model) => model.configuredModelId === configuredModelId
  )?.info;
  return info ? descriptor.wire.decode(info.id).selection.baseModelId : null;
}

/**
 * The backend's stored default in wire form, or `null` when nothing is stored
 * or the stored row no longer exists (deleting a provider takes its models with
 * it, leaving a pointer to nothing).
 */
export function readBackendDefault(
  descriptor: BackendDescriptor,
  settings: CopilotSettings
): ModelSelection | null {
  const stored = readStoredDefault(settings, descriptor.id);
  if (!stored) return null;
  const baseModelId = wireBaseIdFor(descriptor, stored.configuredModelId, settings);
  return baseModelId ? { baseModelId, effort: stored.effort ?? null } : null;
}

/**
 * The configured model a wire base id names on this backend, or `null` when
 * none does.
 *
 * The stored default is checked before the enabled list because it can
 * legitimately sit outside it — the settings picker keeps a turned-off default
 * selectable so its effort can still be changed and so it can be cleared — and
 * re-writing it must not lose which row it was.
 */
export function findConfiguredModelId(
  descriptor: BackendDescriptor,
  baseModelId: string,
  settings: CopilotSettings
): string | null {
  const config = settings.backends?.[descriptor.id as BackendKey];
  const stored = config?.default?.configuredModelId;
  if (stored && wireBaseIdFor(descriptor, stored, settings) === baseModelId) return stored;
  for (const configuredModelId of config?.enabledModels ?? []) {
    if (wireBaseIdFor(descriptor, configuredModelId, settings) === baseModelId) {
      return configuredModelId;
    }
  }
  return null;
}
