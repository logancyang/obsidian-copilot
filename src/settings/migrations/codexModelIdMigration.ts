import type { ModelSelection } from "@/agentMode";
import type { ConfiguredModel } from "@/modelManagement";
import type { CopilotSettings } from "@/settings/model";
import { parseCodexModelId } from "@/utils/codexModelId";

const EMPTY_CONFIGURED_MODELS = Object.freeze([]) as unknown as ConfiguredModel[];
const EMPTY_ENABLED_MODELS = Object.freeze([]) as unknown as string[];

export interface CodexModelIdCollapsePlan {
  configuredModels: ConfiguredModel[];
  enabledModels: string[];
  defaultModel?: ModelSelection;
}

export function planCodexModelIdCollapse(
  settings: CopilotSettings
): CodexModelIdCollapsePlan | null {
  const codexProviderIds = new Set(
    Object.values(settings.providers ?? {})
      .filter((p) => p.origin.kind === "agent" && p.origin.agentType === "codex")
      .map((p) => p.providerId)
  );

  const previousModels = settings.configuredModels ?? EMPTY_CONFIGURED_MODELS;
  const configuredModels: ConfiguredModel[] = [];
  const survivorByBaseModel = new Map<string, ConfiguredModel>();
  const survivorByModelId = new Map<string, string>();
  let rowsChanged = false;

  for (const model of previousModels) {
    if (!codexProviderIds.has(model.providerId)) {
      configuredModels.push(model);
      continue;
    }
    const { baseModelId, effort } = parseCodexModelId(model.info.id);
    const key = `${model.providerId}\u0000${baseModelId}`;
    const survivor = survivorByBaseModel.get(key);
    if (survivor) {
      // Discovery keeps one row per base model; preserve enable references from
      // duplicate effort rows so the user's enabled model does not disappear.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/219
      survivorByModelId.set(model.configuredModelId, survivor.configuredModelId);
      rowsChanged = true;
      continue;
    }
    const kept: ConfiguredModel =
      effort === null
        ? model
        : {
            ...model,
            info: {
              ...model.info,
              id: baseModelId,
              displayName: stripEffortLabel(model.info.displayName, effort),
            },
          };
    if (kept !== model) rowsChanged = true;
    survivorByBaseModel.set(key, kept);
    survivorByModelId.set(model.configuredModelId, kept.configuredModelId);
    configuredModels.push(kept);
  }

  // Keep each model enabled once, including unresolved IDs whose rows may return.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/219
  const previousEnabled = settings.backends?.codex?.enabledModels ?? EMPTY_ENABLED_MODELS;
  const enabledModels: string[] = [];
  const alreadyEnabled = new Set<string>();
  for (const configuredModelId of previousEnabled) {
    const resolved = survivorByModelId.get(configuredModelId) ?? configuredModelId;
    if (alreadyEnabled.has(resolved)) continue;
    alreadyEnabled.add(resolved);
    enabledModels.push(resolved);
  }
  const enabledChanged =
    enabledModels.length !== previousEnabled.length ||
    enabledModels.some((id, i) => id !== previousEnabled[i]);

  // The sticky default holds a whole wire id in `baseModelId` (effort never
  // decoded, so it is null); the bracketed level is the one actually applied.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/219
  const previousDefault = settings.agentMode?.backends?.codex?.defaultModel;
  const parsedDefault = previousDefault ? parseCodexModelId(previousDefault.baseModelId) : null;
  const defaultModel =
    parsedDefault && parsedDefault.effort !== null
      ? { baseModelId: parsedDefault.baseModelId, effort: parsedDefault.effort }
      : undefined;

  if (!rowsChanged && !enabledChanged && !defaultModel) return null;
  return {
    configuredModels: rowsChanged ? configuredModels : previousModels,
    enabledModels: enabledChanged ? enabledModels : previousEnabled,
    ...(defaultModel ? { defaultModel } : {}),
  };
}

function stripEffortLabel(displayName: string, effort: string): string {
  const match = /^(.*?)\s*\(([^()]+)\)\s*$/.exec(displayName);
  if (!match || match[2].toLowerCase() !== effort.toLowerCase()) return displayName;
  return match[1].trim() || displayName;
}
