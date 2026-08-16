/**
 * One-time migration (settings v9): erase the retired GitHub Copilot chat
 * provider from a vault that used it.
 * https://github.com/logancyang/obsidian-copilot-preview/issues/316
 *
 * Copilot no longer ships a `github-copilot` chat adapter, so a saved model
 * naming that provider can never be instantiated again: it would sit
 * permanently broken in the Quick Chat model list, and a selection still
 * pointing at it would silently resolve to some other model on every chat.
 * The OAuth tokens it needed are keychain-backed, so they also have to be
 * deleted explicitly — once the settings fields are gone, the normal
 * persistence path no longer sees them and would leave the entries behind.
 *
 * Split so the mapping logic stays trivially unit-testable:
 *  - `planGitHubCopilotRemoval` is PURE — settings in, settings patch out.
 *  - `executeGitHubCopilotRemoval` applies the patch and deletes the keychain
 *    entries.
 */

import { logWarn } from "@/logger";
import { KeychainService } from "@/services/keychainService";
import { type CopilotSettings, setSettings } from "@/settings/model";

/** Value the retired provider used in `CustomModel.provider` and in model keys. */
const REMOVED_PROVIDER = "github-copilot";

/**
 * Keychain-backed settings fields that held the GitHub Copilot OAuth tokens.
 * `githubCopilotTokenExpiresAt` is a number and was never keychain-covered; it
 * is dropped from `data.json` by `cleanupLegacyFields` along with these two.
 */
const REMOVED_SECRET_KEYS = ["githubCopilotAccessToken", "githubCopilotToken"] as const;

/**
 * Whether a persisted model key names the retired provider. Keys are
 * `name|provider`, optionally prefixed with an agent backend id, so the
 * provider is always the trailing segment.
 */
function referencesRemovedProvider(modelKey: string | undefined): boolean {
  return modelKey?.endsWith(`|${REMOVED_PROVIDER}`) ?? false;
}

/**
 * Pure planner: the settings patch that removes every GitHub Copilot model and
 * every selection pointing at one, or `null` when the vault never had any (so
 * the caller can skip a redundant write — referential stability, see AGENTS.md).
 *
 * Clearing a selection does not change which model a chat lands on:
 * `findChatBackendEntry` already falls back to the first enabled entry for any
 * selection it cannot resolve, which is what the stale `…|github-copilot` key
 * hit. What it changes is that nothing stays stored naming a provider that has
 * no constructor — so the value the user later picks is the only one on disk.
 *
 * Each field is cleared to its own "no stored choice" value: `""` for
 * `defaultModelKey` and `projectModelKey`, `undefined` for
 * `quickCommandModelKey`. Quick Ask and the quick-command modals read that
 * field as `quickCommandModelKey ?? defaultModelKey`, so only `undefined`
 * restores "inherit the chat default"; `""` would read as a deliberate choice
 * and pin them away from it.
 */
export function planGitHubCopilotRemoval(
  settings: CopilotSettings
): Partial<CopilotSettings> | null {
  const patch: Partial<CopilotSettings> = {};

  const models = settings.activeModels ?? [];
  const keptModels = models.filter((model) => model.provider !== REMOVED_PROVIDER);
  if (keptModels.length !== models.length) patch.activeModels = keptModels;

  if (referencesRemovedProvider(settings.defaultModelKey)) patch.defaultModelKey = "";

  if (referencesRemovedProvider(settings.quickCommandModelKey))
    patch.quickCommandModelKey = undefined;

  const projects = settings.projectList ?? [];
  if (projects.some((project) => referencesRemovedProvider(project.projectModelKey))) {
    patch.projectList = projects.map((project) =>
      referencesRemovedProvider(project.projectModelKey)
        ? { ...project, projectModelKey: "" }
        : project
    );
  }

  return Object.keys(patch).length > 0 ? patch : null;
}

/**
 * Side-effecting executor. Applies the plan, then deletes the OAuth keychain
 * entries. The keychain half never throws: a build without SecretStorage, or a
 * keychain that is locked at load time, leaves the entries in place rather than
 * wedging plugin load — the version bump in the caller is unconditional either
 * way, so the retry cost of a failure here is two orphaned entries.
 *
 * @param settings - Hydrated settings snapshot the plan is computed from.
 */
export function executeGitHubCopilotRemoval(settings: CopilotSettings): void {
  const patch = planGitHubCopilotRemoval(settings);
  if (patch) setSettings(patch);

  try {
    const keychain = KeychainService.getInstance();
    if (!keychain.isAvailable()) return;
    for (const key of REMOVED_SECRET_KEYS) {
      keychain.deleteSecret(key);
    }
  } catch (error) {
    logWarn("[github-copilot-removal] could not delete the stored OAuth tokens", error);
  }
}
