/**
 * One-time migration (settings v11): erase Amazon Bedrock from a vault that
 * configured it.
 * https://github.com/logancyang/obsidian-copilot/issues/2928
 *
 * Copilot no longer ships a `bedrock` adapter, so a saved Bedrock provider can
 * never build a client again. Left alone the row keeps its place in the model
 * list and stays selectable, and the user only finds out when a message fails.
 *
 * Split so the mapping logic stays trivially unit-testable:
 *  - `planBedrockRemoval` is PURE — settings in, plan out.
 *  - `executeBedrockRemoval` applies the patch, runs each provider row through
 *    the shared removal cascade, and deletes the legacy top-level API key.
 */

import type { CustomModel } from "@/aiParams";
import { logWarn } from "@/logger";
import type { ModelManagementApi } from "@/modelManagement";
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
 * Settings field that held the Bedrock key before BYOK moved credentials onto
 * provider rows. The BYOK migration copies it without clearing it, so the
 * entry outlives the row it seeded, and the field is gone from the schema now —
 * nothing else can name its keychain id, so this migration is its last chance
 * to be deleted.
 */
const REMOVED_LEGACY_SECRET_FIELD = "amazonBedrockApiKey";

/**
 * Whether a persisted model key names the removed provider. Legacy keys are
 * `name|provider`, optionally prefixed with an agent backend id, so the
 * provider is always the trailing segment.
 */
function referencesRemovedProvider(modelKey: string): boolean {
  return modelKey.endsWith(`|${REMOVED_LEGACY_PROVIDER}`);
}

/** What `planBedrockRemoval` found: the rows to cascade and the patch to write. */
export interface BedrockRemovalPlan {
  /** Every Bedrock `providerId`, for the caller to run through the cascade. */
  providerIds: readonly string[];
  /** Patch for the slices the cascade does not own: legacy models, selections. */
  patch: Partial<CopilotSettings>;
}

/**
 * Pure planner: what it takes to remove every Bedrock provider and everything
 * pointing at one, or `null` when the vault never configured Bedrock (so the
 * caller can skip a redundant write — referential stability, see AGENTS.md).
 *
 * The provider row, its `ConfiguredModel`s, the `enabledModels` lists that
 * enrolled them and the row's own API key are named here only by
 * `providerIds`: `ModelManagementCoordinator.removeProvider` already owns that
 * four-step cascade, so this plan carries the ids rather than a second copy of
 * the traversal.
 *
 * What the cascade does not reach is planned as a patch. The legacy
 * `activeModels` list matters more than it looks: a vault upgrading from v3
 * never gets a provider row at all, because `planByokMigration` no longer maps
 * Bedrock, so `activeModels` is the only place its models exist. That list
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
  // `name|amazon-bedrock` key that has no row behind it.
  const isRemovedSelection = (modelKey: string | undefined): boolean =>
    !!modelKey && (removedModelIds.has(modelKey) || referencesRemovedProvider(modelKey));

  const patch: Partial<CopilotSettings> = {};

  const models = settings.activeModels ?? [];
  const keptLegacyModels = models.filter(
    (model: CustomModel) => model.provider !== REMOVED_LEGACY_PROVIDER
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

  const hasWork = providerIds.length > 0 || Object.keys(patch).length > 0;
  return hasWork ? { providerIds, patch } : null;
}

/**
 * Delete the pre-BYOK top-level Bedrock key. Never throws: a build without
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
    logWarn("[bedrock-removal] could not delete the legacy stored API key", error);
  }
}

/**
 * Side-effecting executor. Writes the patch, then hands each Bedrock row to the
 * shared provider cascade, which drops the backend enrollments, the configured
 * models, the row and its keychain entry in the order those slices tolerate.
 *
 * The legacy key is deleted whether or not there was a plan: a vault that typed
 * a Bedrock key but never enabled a model has the keychain entry and nothing
 * else, and after this release no code path can name it again.
 *
 * @param api - Model-management API owning the provider-removal cascade.
 * @param settings - Hydrated settings snapshot the plan is computed from.
 */
export async function executeBedrockRemoval(
  api: ModelManagementApi,
  settings: CopilotSettings
): Promise<void> {
  deleteLegacyApiKey();

  const plan = planBedrockRemoval(settings);
  if (!plan) return;

  if (Object.keys(plan.patch).length > 0) setSettings(plan.patch);
  for (const providerId of plan.providerIds) {
    await api.coordinator.removeProvider(providerId);
  }
}
