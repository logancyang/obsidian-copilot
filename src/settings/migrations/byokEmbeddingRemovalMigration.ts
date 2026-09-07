import { opencodeWireBaseIdFor } from "@/agentMode";
import {
  isChatModelSelectionForEntry,
  isEmbeddingModel,
  type ResolvedChatBackendEntry,
} from "@/modelManagement";
import type { CopilotSettings } from "@/settings/model";

/** Remove unsupported BYOK models and their selections in one settings update. */
export function planByokEmbeddingRemoval(
  settings: CopilotSettings
): Partial<CopilotSettings> | null {
  const removed = settings.configuredModels.filter(
    (model) =>
      settings.providers[model.providerId]?.origin.kind === "byok" && isEmbeddingModel(model.info)
  );
  // Keep every unrelated slice and row reference intact when no migration is needed.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/386
  if (removed.length === 0) return null;
  const removedIds = new Set(removed.map((model) => model.configuredModelId));
  const configuredModels = settings.configuredModels.filter(
    (model) => !removedIds.has(model.configuredModelId)
  );
  const entries: ResolvedChatBackendEntry[] = settings.configuredModels.flatMap(
    (configuredModel) => {
      const provider = settings.providers[configuredModel.providerId];
      return provider
        ? [
            {
              state: "ok" as const,
              configuredModelId: configuredModel.configuredModelId,
              configuredModel,
              provider,
              needsSelfHostWarning: false,
            },
          ]
        : [];
    }
  );
  const removedSelection = (selection: string | undefined): boolean =>
    !!selection &&
    entries.some(
      (entry) =>
        removedIds.has(entry.configuredModelId) && isChatModelSelectionForEntry(entry, selection)
    ) &&
    !entries.some(
      (entry) =>
        !removedIds.has(entry.configuredModelId) && isChatModelSelectionForEntry(entry, selection)
    );
  const backends = { ...settings.backends };
  for (const [key, config] of Object.entries(backends)) {
    if (config.enabledModels.some((id) => removedIds.has(id))) {
      backends[key as keyof typeof backends] = {
        ...config,
        enabledModels: config.enabledModels.filter((id) => !removedIds.has(id)),
      };
    }
  }
  const patch: Partial<CopilotSettings> = { configuredModels, backends };
  if (removedSelection(settings.defaultModelKey)) patch.defaultModelKey = "";
  if (removedSelection(settings.quickCommandModelKey)) patch.quickCommandModelKey = undefined;
  if (settings.projectList.some((project) => removedSelection(project.projectModelKey))) {
    patch.projectList = settings.projectList.map((project) =>
      removedSelection(project.projectModelKey) ? { ...project, projectModelKey: "" } : project
    );
  }
  const opencode = settings.agentMode.backends?.opencode;
  const defaultWireId = opencode?.defaultModel?.baseModelId;
  if (
    defaultWireId &&
    removed.some(
      (model) => opencodeWireBaseIdFor(model.configuredModelId, settings) === defaultWireId
    ) &&
    !configuredModels.some(
      (model) => opencodeWireBaseIdFor(model.configuredModelId, settings) === defaultWireId
    )
  ) {
    patch.agentMode = {
      ...settings.agentMode,
      backends: { ...settings.agentMode.backends, opencode: { ...opencode, defaultModel: null } },
    };
  }
  return patch;
}
