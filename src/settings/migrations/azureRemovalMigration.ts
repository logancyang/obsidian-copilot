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

import { DEFAULT_SETTINGS } from "@/constants";
import type { ModelManagementApi } from "@/modelManagement";
import type { CopilotSettings } from "@/settings/model";
import {
  executeRetiredProviderRemoval,
  planRetiredProviderRemoval,
  referencesRetiredProvider,
  type RetiredProviderRemovalPlan,
} from "./retiredProviderRemovalMigration";

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

/** What `planAzureRemoval` found: the rows to cascade and the patch to write. */
export type AzureRemovalPlan = RetiredProviderRemovalPlan;

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
 * needs no removal here because the client-side embedding settings remain inert
 * until their dedicated migration removes them.
 *
 * Re-indexing is unavoidable and deliberate: embeddings from one model are not
 * comparable with another's, so there is nothing to preserve.
 *
 * @param settings - Hydrated settings snapshot to plan against.
 */
export function planAzureRemoval(settings: CopilotSettings): AzureRemovalPlan | null {
  const sharedPlan = planRetiredProviderRemoval(
    settings,
    REMOVED_PROVIDER_TYPE,
    REMOVED_LEGACY_PROVIDERS
  );
  const patch: Partial<CopilotSettings> = { ...sharedPlan?.patch };

  // An Azure embedding selection outlives the provider that served it, and
  // `EmbeddingManager.getEmbeddingsAPI` throws `No embedding model found for:
  // <key>` on a key its map does not hold, with no fallback, so the vault stops
  // indexing outright. Repointing at the default restores indexing for a vault
  // that already has an OpenRouter key, and for one that does not it asks for a
  // key instead of naming a provider that no longer exists.
  // https://github.com/logancyang/obsidian-copilot/issues/2932
  if (referencesRetiredProvider(settings.embeddingModelKey ?? "", REMOVED_LEGACY_PROVIDERS)) {
    patch.embeddingModelKey = DEFAULT_SETTINGS.embeddingModelKey;
  }

  const providerIds = sharedPlan?.providerIds ?? [];
  return providerIds.length > 0 || Object.keys(patch).length > 0 ? { providerIds, patch } : null;
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
  await executeRetiredProviderRemoval(
    api,
    planAzureRemoval(settings),
    REMOVED_LEGACY_SECRET_FIELD,
    "azure-removal"
  );
}
