import type { CustomModel } from "@/aiParams";
import { getModelKeyFromModel } from "@/lib/model-key";
import { getLegacyChatModelKeys, isEmbeddingModel, opencodeWireBaseId } from "@/modelManagement";
import { EMPTY_CONFIGURED_MODELS, type CopilotSettings } from "@/settings/model";
import { LEGACY_PROVIDER_MAP } from "./byokMigration";

const EMPTY_LEGACY_MODELS = Object.freeze([]) as unknown as CustomModel[];
const EMPTY_MODEL_IDS = Object.freeze([]) as unknown as string[];

/** Remove unsupported BYOK models and their selections in one settings update. */
export function planByokEmbeddingRemoval(
  settings: CopilotSettings
): Partial<CopilotSettings> | null {
  const removedIds = new Set<string>();
  const removedKeys = new Set<string>();
  const retainedKeys = new Set<string>();
  const configuredModels = settings.configuredModels.filter((configuredModel) => {
    const provider = settings.providers[configuredModel.providerId];
    const remove = provider?.origin.kind === "byok" && isEmbeddingModel(configuredModel.info);
    if (remove) removedIds.add(configuredModel.configuredModelId);
    const keys = remove ? removedKeys : retainedKeys;
    keys.add(configuredModel.configuredModelId);
    if (provider)
      getLegacyChatModelKeys({ provider, configuredModel }).forEach((key) => keys.add(key));
    return !remove;
  });
  const activeModels = settings.activeModels.filter((model) => {
    const remove =
      Object.hasOwn(LEGACY_PROVIDER_MAP, model.provider) &&
      isEmbeddingModel({ id: model.name, isEmbedding: model.isEmbeddingModel });
    (remove ? removedKeys : retainedKeys).add(getModelKeyFromModel(model));
    return !remove;
  });
  // Legacy-only upgrades must run too; untouched slices keep their original identity.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/386
  const patch: Partial<CopilotSettings> = {};
  if (activeModels.length !== settings.activeModels.length) {
    patch.activeModels = activeModels.length ? activeModels : EMPTY_LEGACY_MODELS;
  }
  if (removedIds.size > 0) {
    patch.configuredModels = configuredModels.length ? configuredModels : EMPTY_CONFIGURED_MODELS;
    for (const [key, config] of Object.entries(settings.backends)) {
      if (!config.enabledModels.some((id) => removedIds.has(id))) continue;
      const enabledModels = config.enabledModels.filter((id) => !removedIds.has(id));
      patch.backends ??= { ...settings.backends };
      patch.backends[key as keyof typeof settings.backends] = {
        ...config,
        enabledModels: enabledModels.length ? enabledModels : EMPTY_MODEL_IDS,
      };
    }
  }
  if (!patch.activeModels && !patch.configuredModels) return null;
  const removedSelection = (selection: string | undefined): boolean =>
    !!selection && removedKeys.has(selection) && !retainedKeys.has(selection);
  if (removedSelection(settings.defaultModelKey)) patch.defaultModelKey = "";
  if (removedSelection(settings.quickCommandModelKey)) patch.quickCommandModelKey = undefined;
  if (settings.projectList.some((project) => removedSelection(project.projectModelKey))) {
    patch.projectList = settings.projectList.map((project) =>
      removedSelection(project.projectModelKey) ? { ...project, projectModelKey: "" } : project
    );
  }
  const opencode = settings.agentMode.backends?.opencode;
  const defaultWireId = opencode?.defaultModel?.baseModelId;
  const matchesWire = (model: (typeof configuredModels)[number]) =>
    opencodeWireBaseId(settings.providers[model.providerId], model) === defaultWireId;
  if (
    defaultWireId &&
    settings.configuredModels.some(
      (model) => removedIds.has(model.configuredModelId) && matchesWire(model)
    ) &&
    !configuredModels.some(matchesWire)
  ) {
    patch.agentMode = {
      ...settings.agentMode,
      backends: { ...settings.agentMode.backends, opencode: { ...opencode, defaultModel: null } },
    };
  }
  return patch;
}
