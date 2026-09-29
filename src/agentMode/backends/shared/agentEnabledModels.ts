import type { CopilotSettings } from "@/settings/model";
import { type ConfiguredModel, capabilitiesFromConfiguredInfo } from "@/modelManagement";
import type { EnabledModelEntry } from "@/agentMode/session/types";

const EMPTY_ENABLED_ENTRIES: readonly EnabledModelEntry[] = Object.freeze([]);

export type WireDecode = (wireId: string) => { selection: { baseModelId: string } };

export function agentOriginEnabledModelEntries(
  settings: CopilotSettings,
  agentType: "claude" | "codex",
  wireDecode: WireDecode
): readonly EnabledModelEntry[] {
  const enabledIds = settings.backends[agentType]?.enabledModels ?? [];
  if (enabledIds.length === 0) return EMPTY_ENABLED_ENTRIES;

  const modelsById = new Map<string, ConfiguredModel>();
  for (const model of settings.configuredModels) {
    modelsById.set(model.configuredModelId, model);
  }

  const entries: EnabledModelEntry[] = [];
  for (const configuredModelId of enabledIds) {
    const configuredModel = modelsById.get(configuredModelId);
    if (!configuredModel) continue;
    entries.push({
      baseModelId: wireDecode(configuredModel.info.id).selection.baseModelId,
      name: configuredModel.info.displayName || configuredModel.info.id,
      description: configuredModel.info.description,
      credentialState: "ok",
      capabilities: capabilitiesFromConfiguredInfo(configuredModel.info),
    });
  }

  return entries.length === 0 ? EMPTY_ENABLED_ENTRIES : entries;
}
