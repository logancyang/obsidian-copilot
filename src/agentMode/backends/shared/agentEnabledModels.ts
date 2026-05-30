import type { CopilotSettings } from "@/settings/model";
import type { ConfiguredModel } from "@/modelManagement";
import type { EnabledModelEntry } from "@/agentMode/session/types";

/** See AGENTS.md → "Referential stability". */
const EMPTY_ENABLED_ENTRIES: readonly EnabledModelEntry[] = Object.freeze([]);

/** A descriptor's own `wire.decode`, accepted as a parameter so this backend-layer helper needn't import the session-domain codec type. */
export type WireDecode = (wireId: string) => { selection: { baseModelId: string } };

/**
 * The enabled-model entries for a claude / codex backend — each enabled
 * `ConfiguredModel.info.id` decoded via the descriptor's `wire.decode` to the
 * baseModelId the picker compares against `ModelEntry.baseModelId`, enriched
 * with the model's display name/description. These backends are all
 * agent-origin (auth is CLI-owned, no Copilot-side keys), so every entry is
 * `credentialState: "ok"`.
 *
 * Only for all-agent-origin backends; opencode mixes in BYOK/Plus models and
 * uses `opencodeEnabledModelEntries` instead.
 */
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
    });
  }

  return entries.length === 0 ? EMPTY_ENABLED_ENTRIES : entries;
}
