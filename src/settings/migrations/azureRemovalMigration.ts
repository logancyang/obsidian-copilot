/**
 * One-time migration (settings v12): erase Azure OpenAI from a vault that
 * configured it, for chat and for embeddings.
 * https://github.com/logancyang/obsidian-copilot/issues/2932
 *
 * Copilot no longer ships an `azure` adapter or an Azure embedding provider, so
 * a saved Azure row can never build a client again. The chat half mirrors the
 * Bedrock removal; the embedding half is Azure's alone.
 *
 * Split so the mapping logic stays trivially unit-testable:
 *  - `planAzureRemoval` is PURE — settings in, plan out.
 *  - `executeAzureRemoval` applies the patch, runs each provider row through
 *    the shared removal cascade, and deletes the legacy top-level API key.
 */

import type { CustomModel } from "@/aiParams";
import { DEFAULT_SETTINGS } from "@/constants";
import { logWarn } from "@/logger";
import type { ModelManagementApi } from "@/modelManagement";
import { KeychainService } from "@/services/keychainService";
import { type CopilotSettings, setSettings } from "@/settings/model";

/**
 * `Provider.providerType` of the removed rows. A plain string rather than a
 * `ProviderType` member because the union no longer has one to name.
 */
const REMOVED_PROVIDER_TYPE = "azure";

/**
 * Values the removed provider used in `CustomModel.provider` and in model keys.
 * `azure_openai` predates the rename to a space-separated value and still sits
 * in vaults old enough to have it, on embedding rows in particular.
 */
const REMOVED_LEGACY_PROVIDERS = ["azure openai", "azure_openai"] as const;

/**
 * Settings field that held the Azure key before BYOK moved credentials onto
 * provider rows. The BYOK migration copies it without clearing it, so the entry
 * outlives the row it seeded, and the field is gone from the schema now —
 * nothing else can name its keychain id, so this migration is its last chance
 * to be deleted.
 */
const REMOVED_LEGACY_SECRET_FIELD = "azureOpenAIApiKey";

/**
 * Whether a persisted model key names the removed provider. Legacy keys are
 * `name|provider`, optionally prefixed with an agent backend id, so the
 * provider is always the trailing segment.
 */
function referencesRemovedProvider(modelKey: string): boolean {
  return REMOVED_LEGACY_PROVIDERS.some((provider) => modelKey.endsWith(`|${provider}`));
}

/** What `planAzureRemoval` found: the rows to cascade and the patch to write. */
export interface AzureRemovalPlan {
  /** Every Azure `providerId`, for the caller to run through the cascade. */
  providerIds: readonly string[];
  /** Patch for the slices the cascade does not own: legacy models, selections. */
  patch: Partial<CopilotSettings>;
}

/**
 * Pure planner: what it takes to remove every Azure provider and everything
 * pointing at one, or `null` when the vault never configured Azure.
 *
 * The provider row, its `ConfiguredModel`s, the `enabledModels` lists that
 * enrolled them and the row's own API key are named here only by
 * `providerIds`: `ModelManagementCoordinator.removeProvider` already owns that
 * four-step cascade.
 *
 * The embedding selection is the slice unique to Azure, and the one whose
 * absence would break a vault rather than degrade it. The embedding row itself
 * needs no removal: `filterUnsupportedEmbeddingModels` already drops any row
 * whose provider left `EmbeddingModelProviders`, on every settings write.
 *
 * Re-indexing is unavoidable and deliberate: embeddings from one model are not
 * comparable with another's, so there is nothing to preserve.
 *
 * @param settings - Hydrated settings snapshot to plan against.
 */
export function planAzureRemoval(settings: CopilotSettings): AzureRemovalPlan | null {
  const providerIds = Object.values(settings.providers ?? {})
    .filter((provider) => String(provider.providerType) === REMOVED_PROVIDER_TYPE)
    .map((provider) => provider.providerId);

  const removedProviderIds = new Set(providerIds);
  const removedModelIds = new Set(
    (settings.configuredModels ?? [])
      .filter((model) => removedProviderIds.has(model.providerId))
      .map((model) => model.configuredModelId)
  );

  // A stored selection names a removed model either by its configured-model id
  // or, in a vault whose BYOK migration never ran, by the legacy
  // `name|azure openai` key that has no row behind it.
  const isRemovedSelection = (modelKey: string | undefined): boolean =>
    !!modelKey && (removedModelIds.has(modelKey) || referencesRemovedProvider(modelKey));

  const patch: Partial<CopilotSettings> = {};

  const models = settings.activeModels ?? [];
  const keptLegacyModels = models.filter(
    (model: CustomModel) =>
      !REMOVED_LEGACY_PROVIDERS.some((provider) => model.provider === provider)
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

  // An Azure embedding selection outlives the provider that served it, and
  // `EmbeddingManager.getEmbeddingsAPI` throws `No embedding model found for:
  // <key>` on a key its map does not hold, with no fallback, so the vault stops
  // indexing outright. Repointing at the default restores indexing for a vault
  // that already has an OpenRouter key, and for one that does not it asks for a
  // key instead of naming a provider that no longer exists.
  // https://github.com/logancyang/obsidian-copilot/issues/2932
  if (referencesRemovedProvider(settings.embeddingModelKey ?? "")) {
    patch.embeddingModelKey = DEFAULT_SETTINGS.embeddingModelKey;
  }

  const hasWork = providerIds.length > 0 || Object.keys(patch).length > 0;
  return hasWork ? { providerIds, patch } : null;
}

/**
 * Delete the pre-BYOK top-level Azure key. Never throws: a build without
 * SecretStorage, or a keychain locked at load time, leaves the entry in place
 * rather than wedging plugin load — the version bump in the caller is
 * unconditional either way, so the cost of a failure here is an orphaned entry.
 */
function deleteLegacyApiKey(): void {
  try {
    const keychain = KeychainService.getInstance();
    if (!keychain.isAvailable()) return;
    keychain.deleteSecret(REMOVED_LEGACY_SECRET_FIELD);
  } catch (error) {
    logWarn("[azure-removal] could not delete the legacy stored API key", error);
  }
}

/**
 * Side-effecting executor. Writes the patch, then hands each Azure row to the
 * shared provider cascade, which drops the backend enrollments, the configured
 * models, the row and its keychain entry in the order those slices tolerate.
 *
 * The legacy key is deleted whether or not there was a plan: a vault that typed
 * an Azure key but never enabled a model has the keychain entry and nothing
 * else, and after this release no code path can name it again.
 *
 * @param api - Model-management API owning the provider-removal cascade.
 * @param settings - Hydrated settings snapshot the plan is computed from.
 */
export async function executeAzureRemoval(
  api: ModelManagementApi,
  settings: CopilotSettings
): Promise<void> {
  deleteLegacyApiKey();

  const plan = planAzureRemoval(settings);
  if (!plan) return;

  if (Object.keys(plan.patch).length > 0) setSettings(plan.patch);
  for (const providerId of plan.providerIds) {
    await api.coordinator.removeProvider(providerId);
  }
}
