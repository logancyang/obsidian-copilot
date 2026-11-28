// A saved Azure row can never build a client again; the embedding half is Azure's alone:
// https://github.com/logancyang/obsidian-copilot/issues/2932

import type { ModelManagementApi } from "@/modelManagement";
import type { CopilotSettings } from "@/settings/model";
import {
  executeRetiredProviderRemoval,
  planRetiredProviderRemoval,
  referencesRetiredProvider,
  type RetiredProviderRemovalPlan,
} from "./retiredProviderRemovalMigration";

const REMOVED_PROVIDER_TYPE = "azure";

const REMOVED_LEGACY_PROVIDERS = ["azure openai", "azure_openai"] as const;

const REMOVED_LEGACY_SECRET_FIELD = "azureOpenAIApiKey";

export type AzureRemovalPlan = RetiredProviderRemovalPlan;

interface LegacyAzureSettings extends CopilotSettings {
  embeddingModelKey?: string;
}

interface LegacyAzurePatch extends Partial<CopilotSettings> {
  embeddingModelKey?: string;
}

export function planAzureRemoval(settings: CopilotSettings): AzureRemovalPlan | null {
  const sharedPlan = planRetiredProviderRemoval(
    settings,
    REMOVED_PROVIDER_TYPE,
    REMOVED_LEGACY_PROVIDERS
  );
  const patch: LegacyAzurePatch = { ...sharedPlan?.patch };
  const legacySettings = settings as LegacyAzureSettings;

  // An Azure embedding selection outlives the provider that served it, and
  // `EmbeddingManager.getEmbeddingsAPI` throws `No embedding model found for:
  // <key>` on a key its map does not hold, with no fallback, so the vault stops
  // indexing outright. Repointing at the default restores indexing for a vault
  // that already has an OpenRouter key, and for one that does not it asks for a
  // key instead of naming a provider that no longer exists.
  // https://github.com/logancyang/obsidian-copilot/issues/2932
  if (referencesRetiredProvider(legacySettings.embeddingModelKey ?? "", REMOVED_LEGACY_PROVIDERS)) {
    patch.embeddingModelKey = "";
  }

  const providerIds = sharedPlan?.providerIds ?? [];
  return providerIds.length > 0 || Object.keys(patch).length > 0 ? { providerIds, patch } : null;
}

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
