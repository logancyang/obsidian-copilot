import type { CustomModel } from "@/aiParams";
import { logWarn } from "@/logger";
import type { ModelManagementApi } from "@/modelManagement";
import { KeychainService } from "@/services/keychainService";
import { type CopilotSettings, setSettings } from "@/settings/model";

export interface RetiredProviderRemovalPlan {
  providerIds: readonly string[];
  patch: Partial<CopilotSettings>;
}

export function referencesRetiredProvider(
  modelKey: string,
  legacyProviders: readonly string[]
): boolean {
  return legacyProviders.some((provider) => modelKey.endsWith(`|${provider}`));
}

/** Plan the chat-model state shared by retired-provider migrations. */
export function planRetiredProviderRemoval(
  settings: CopilotSettings,
  providerType: string,
  legacyProviders: readonly string[]
): RetiredProviderRemovalPlan | null {
  const providerIds = Object.values(settings.providers ?? {})
    .filter((provider) => String(provider.providerType) === providerType)
    .map((provider) => provider.providerId);
  const removedProviderIds = new Set(providerIds);
  const removedModelIds = new Set(
    (settings.configuredModels ?? [])
      .filter((model) => removedProviderIds.has(model.providerId))
      .map((model) => model.configuredModelId)
  );
  const isRemovedSelection = (modelKey: string | undefined): boolean =>
    !!modelKey &&
    (removedModelIds.has(modelKey) || referencesRetiredProvider(modelKey, legacyProviders));

  const patch: Partial<CopilotSettings> = {};
  const models = settings.activeModels ?? [];
  const keptLegacyModels = models.filter(
    (model: CustomModel) => !legacyProviders.includes(model.provider)
  );
  if (keptLegacyModels.length !== models.length) patch.activeModels = keptLegacyModels;
  if (isRemovedSelection(settings.defaultModelKey)) patch.defaultModelKey = "";
  if (isRemovedSelection(settings.quickCommandModelKey)) patch.quickCommandModelKey = undefined;

  const projects = settings.projectList ?? [];
  if (projects.some((project) => isRemovedSelection(project.projectModelKey))) {
    patch.projectList = projects.map((project) =>
      isRemovedSelection(project.projectModelKey) ? { ...project, projectModelKey: "" } : project
    );
  }

  return providerIds.length > 0 || Object.keys(patch).length > 0 ? { providerIds, patch } : null;
}

/** Apply a retired-provider plan through the existing settings and provider-removal owners. */
export async function executeRetiredProviderRemoval(
  api: ModelManagementApi,
  plan: RetiredProviderRemovalPlan | null,
  legacySecretField: string,
  logLabel: string
): Promise<void> {
  try {
    const keychain = KeychainService.getInstance();
    if (keychain.isAvailable()) keychain.deleteSecret(legacySecretField);
  } catch (error) {
    logWarn(`[${logLabel}] could not delete the legacy stored API key`, error);
  }

  if (!plan) return;
  if (Object.keys(plan.patch).length > 0) setSettings(plan.patch);
  for (const providerId of plan.providerIds) {
    await api.coordinator.removeProvider(providerId);
  }
}
