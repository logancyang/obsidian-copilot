import type { CopilotSettings } from "@/settings/model";

import type { BackendDescriptor, ModelSelection } from "./types";

type BackendKey = keyof CopilotSettings["backends"];

export function readStoredDefault(
  settings: CopilotSettings,
  backendId: string
): { configuredModelId: string; effort?: string | null } | undefined {
  return settings.backends?.[backendId as BackendKey]?.default;
}

// Independent of `enabledModels`: a turned-off default must still render so the user can clear it.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/540
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

export function readBackendDefault(
  descriptor: BackendDescriptor,
  settings: CopilotSettings
): ModelSelection | null {
  const stored = readStoredDefault(settings, descriptor.id);
  if (!stored) return null;
  const baseModelId = wireBaseIdFor(descriptor, stored.configuredModelId, settings);
  return baseModelId ? { baseModelId, effort: stored.effort ?? null } : null;
}

export function findConfiguredModelId(
  descriptor: BackendDescriptor,
  baseModelId: string,
  settings: CopilotSettings
): string | null {
  const config = settings.backends?.[descriptor.id as BackendKey];
  const stored = config?.default?.configuredModelId;
  // The stored default can sit outside the enabled list; re-writing it must keep its row.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/540
  if (stored && wireBaseIdFor(descriptor, stored, settings) === baseModelId) return stored;
  for (const configuredModelId of config?.enabledModels ?? []) {
    if (wireBaseIdFor(descriptor, configuredModelId, settings) === baseModelId) {
      return configuredModelId;
    }
  }
  return null;
}
