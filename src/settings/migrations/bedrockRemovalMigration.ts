/**
 * One-time migration (settings v11): erase Amazon Bedrock from a vault that
 * configured it.
 * https://github.com/logancyang/obsidian-copilot/issues/2928
 *
 * Copilot no longer ships a `bedrock` adapter, so a saved Bedrock provider can
 * never build a client again. Left alone the row keeps its place in the model
 * list and stays selectable, and the user only finds out when a message fails.
 * Its API key is keychain-backed and reachable only through the row's
 * `apiKeyKeychainId`, so deleting the row without the entry would strand a
 * credential nothing can name any more.
 *
 * Split so the mapping logic stays trivially unit-testable:
 *  - `planBedrockRemoval` is PURE — settings in, plan out.
 *  - `executeBedrockRemoval` applies the patch and deletes the keychain
 *    entries.
 */

import type { CustomModel } from "@/aiParams";
import { logWarn } from "@/logger";
import type { BackendConfig, BackendType, Provider } from "@/modelManagement";
import { KeychainService } from "@/services/keychainService";
import { type CopilotSettings, setSettings } from "@/settings/model";

/**
 * `Provider.providerType` of the removed rows. A plain string rather than a
 * `ProviderType` member because the union no longer has one to name.
 */
const REMOVED_PROVIDER_TYPE = "bedrock";

/** Value the removed provider used in `CustomModel.provider` and in model keys. */
const REMOVED_LEGACY_PROVIDER = "amazon-bedrock";

/**
 * Whether a persisted model key names the removed provider. Legacy keys are
 * `name|provider`, optionally prefixed with an agent backend id, so the
 * provider is always the trailing segment.
 */
function referencesRemovedProvider(modelKey: string | undefined): boolean {
  return modelKey?.endsWith(`|${REMOVED_LEGACY_PROVIDER}`) ?? false;
}

/** What `planBedrockRemoval` found: the settings to write and the keys to drop. */
export interface BedrockRemovalPlan {
  /** Settings patch dropping the provider rows, their models and enrollments. */
  patch: Partial<CopilotSettings>;
  /** `apiKeyKeychainId` of every removed row, for the executor to delete. */
  keychainIds: readonly string[];
}

/**
 * Pure planner: the plan that removes every Bedrock provider and everything
 * pointing at one, or `null` when the vault never configured Bedrock (so the
 * caller can skip a redundant write — referential stability, see AGENTS.md).
 *
 * Four slices reference a provider and each is cleaned here. The provider row
 * itself; the `ConfiguredModel`s belonging to it; the `enabledModels` lists
 * that enrolled those models into a backend's picker; and any stored selection
 * naming one.
 *
 * The legacy `activeModels` list is cleaned too, in both its model rows and the
 * `name|amazon-bedrock` selections that point at them. A vault upgrading from
 * v3 never gets a provider row at all, because `planByokMigration` no longer
 * maps Bedrock, so `activeModels` is the only place its models exist. That list
 * still feeds a model picker: `ChatInput` and the quick-command modal both fall
 * back to it, so a row left behind stays on screen and fails when chosen.
 *
 * Clearing a selection does not change which model a chat lands on:
 * `resolveChatBackendModel` already falls back to the first enabled entry for a
 * selection it cannot resolve. What it changes is that nothing stays stored
 * naming a provider with no adapter.
 *
 * @param settings - Hydrated settings snapshot to plan against.
 */
export function planBedrockRemoval(settings: CopilotSettings): BedrockRemovalPlan | null {
  const providers = settings.providers ?? {};
  const removedProviderIds = new Set(
    Object.values(providers)
      .filter((provider) => String(provider.providerType) === REMOVED_PROVIDER_TYPE)
      .map((provider) => provider.providerId)
  );

  const models = settings.activeModels ?? [];
  const keptLegacyModels = models.filter(
    (model: CustomModel) => model.provider !== REMOVED_LEGACY_PROVIDER
  );
  const hasLegacyModels = keptLegacyModels.length !== models.length;

  const patch: Partial<CopilotSettings> = {};
  const keychainIds: string[] = [];

  if (hasLegacyModels) patch.activeModels = keptLegacyModels;

  if (removedProviderIds.size > 0) {
    const keptProviders: Record<string, Provider> = {};
    for (const [key, provider] of Object.entries(providers)) {
      if (removedProviderIds.has(provider.providerId)) {
        if (provider.apiKeyKeychainId) keychainIds.push(provider.apiKeyKeychainId);
        continue;
      }
      keptProviders[key] = provider;
    }
    patch.providers = keptProviders;

    const configuredModels = settings.configuredModels ?? [];
    const removedModelIds = new Set(
      configuredModels
        .filter((model) => removedProviderIds.has(model.providerId))
        .map((model) => model.configuredModelId)
    );
    const keptModels = configuredModels.filter(
      (model) => !removedProviderIds.has(model.providerId)
    );
    if (keptModels.length !== configuredModels.length) patch.configuredModels = keptModels;

    const backends = settings.backends ?? {};
    const nextBackends: Partial<Record<BackendType, BackendConfig>> = {};
    let backendsChanged = false;
    for (const [backend, config] of Object.entries(backends)) {
      if (!config) continue;
      const enabledModels = config.enabledModels.filter((id) => !removedModelIds.has(id));
      if (enabledModels.length !== config.enabledModels.length) {
        backendsChanged = true;
        nextBackends[backend as BackendType] = { ...config, enabledModels };
      } else {
        nextBackends[backend as BackendType] = config;
      }
    }
    if (backendsChanged) patch.backends = nextBackends;

    if (removedModelIds.has(settings.defaultModelKey)) patch.defaultModelKey = "";
    if (settings.quickCommandModelKey && removedModelIds.has(settings.quickCommandModelKey)) {
      patch.quickCommandModelKey = undefined;
    }
    const projects = settings.projectList ?? [];
    if (projects.some((project) => removedModelIds.has(project.projectModelKey))) {
      patch.projectList = projects.map((project) =>
        removedModelIds.has(project.projectModelKey) ? { ...project, projectModelKey: "" } : project
      );
    }
  }

  // Legacy-form selections are checked whether or not a provider row existed:
  // a vault whose BYOK migration never ran has the key without the row.
  if (referencesRemovedProvider(settings.defaultModelKey)) patch.defaultModelKey = "";
  if (referencesRemovedProvider(settings.quickCommandModelKey)) {
    patch.quickCommandModelKey = undefined;
  }
  const projects = patch.projectList ?? settings.projectList ?? [];
  if (projects.some((project) => referencesRemovedProvider(project.projectModelKey))) {
    patch.projectList = projects.map((project) =>
      referencesRemovedProvider(project.projectModelKey)
        ? { ...project, projectModelKey: "" }
        : project
    );
  }

  return Object.keys(patch).length > 0 ? { patch, keychainIds } : null;
}

/**
 * Side-effecting executor. Applies the plan, then deletes the stored API keys.
 * The keychain half never throws: a build without SecretStorage, or a keychain
 * locked at load time, leaves the entries in place rather than wedging plugin
 * load — the version bump in the caller is unconditional either way, so the
 * cost of a failure here is an orphaned entry.
 *
 * @param settings - Hydrated settings snapshot the plan is computed from.
 */
export function executeBedrockRemoval(settings: CopilotSettings): void {
  const plan = planBedrockRemoval(settings);
  if (!plan) return;
  setSettings(plan.patch);

  if (plan.keychainIds.length === 0) return;
  try {
    const keychain = KeychainService.getInstance();
    if (!keychain.isAvailable()) return;
    for (const keychainId of plan.keychainIds) {
      keychain.deleteSecretById(keychainId);
    }
  } catch (error) {
    logWarn("[bedrock-removal] could not delete the stored API key", error);
  }
}
