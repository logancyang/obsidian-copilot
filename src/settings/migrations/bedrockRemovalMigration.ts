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

import type { ModelManagementApi } from "@/modelManagement";
import type { CopilotSettings } from "@/settings/model";
import {
  executeRetiredProviderRemoval,
  planRetiredProviderRemoval,
  type RetiredProviderRemovalPlan,
} from "./retiredProviderRemovalMigration";

/**
 * `Provider.providerType` of the removed rows. A plain string rather than a
 * `ProviderType` member because the union no longer has one to name.
 */
const REMOVED_PROVIDER_TYPE = "bedrock";

/** Value the removed provider used in `CustomModel.provider` and in model keys. */
const REMOVED_LEGACY_PROVIDERS = ["amazon-bedrock"] as const;

/**
 * Settings field that held the Bedrock key before BYOK moved credentials onto
 * provider rows. The BYOK migration copies it without clearing it, so the
 * entry outlives the row it seeded, and the field is gone from the schema now —
 * nothing else can name its keychain id, so this migration is its last chance
 * to be deleted.
 */
const REMOVED_LEGACY_SECRET_FIELD = "amazonBedrockApiKey";

/** What `planBedrockRemoval` found: the rows to cascade and the patch to write. */
export type BedrockRemovalPlan = RetiredProviderRemovalPlan;

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
  return planRetiredProviderRemoval(settings, REMOVED_PROVIDER_TYPE, REMOVED_LEGACY_PROVIDERS);
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
  await executeRetiredProviderRemoval(
    api,
    planBedrockRemoval(settings),
    REMOVED_LEGACY_SECRET_FIELD,
    "bedrock-removal"
  );
}
