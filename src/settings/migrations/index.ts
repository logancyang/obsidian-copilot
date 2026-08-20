/**
 * One-time settings migrations, run once on plugin load (from `Plugin.onload`,
 * after the settings-persistence subscriber is wired so every mutation is
 * persisted, and before agent/model-discovery init so OpenCode first sees the
 * migrated backends).
 *
 * Ordered runner: each migration is individually version-gated against the
 * vault's stored version, so a vault already at an intermediate version only
 * runs the migrations newer than it (the legacy BYOK migration never re-runs
 * for a v4 vault picking up the v5 backfill).
 */

import { DEFAULT_COPILOT_FOLDER } from "@/constants";
import { logInfo } from "@/logger";
import { seedDocProcessorBackend } from "@/miyo/miyoUtils";
import type { ModelManagementApi } from "@/modelManagement";
import { getSettings, normalizeRootFolders, setSettings } from "@/settings/model";

import { executeBedrockRemoval } from "./bedrockRemovalMigration";
import { executeByokMigration } from "./byokMigration";
import { executeGitHubCopilotRemoval } from "./githubCopilotRemovalMigration";
import { planOptionalCustomProviderAuthMigration } from "./optionalCustomProviderAuthMigration";
import { planRequiresApiKeyBackfill } from "./requiresApiKeyMigration";
import { CURRENT_SETTINGS_VERSION } from "./version";

export { CURRENT_SETTINGS_VERSION } from "./version";

/**
 * Run pending one-time migrations and stamp the new version. No-op when
 * settings are already at/above the target (migrated vaults, fresh installs).
 */
export async function runSettingsMigrations(api: ModelManagementApi): Promise<void> {
  const fromVersion = getSettings().settingsVersion ?? 0;
  if (fromVersion >= CURRENT_SETTINGS_VERSION) return;

  logInfo(`[settings-migration] migrating from v${fromVersion} to v${CURRENT_SETTINGS_VERSION}`);

  // v≤4: legacy BYOK models + keys → the model-management data model.
  if (fromVersion < 4) {
    await executeByokMigration(api, getSettings());
  }

  // v5: backfill the explicit `requiresApiKey` flag onto rows that predate it,
  // so the runtime read point no longer needs an identity heuristic.
  if (fromVersion < 5) {
    const backfilled = planRequiresApiKeyBackfill(getSettings().providers);
    if (backfilled) setSettings({ providers: backfilled });
  }

  // v6: seed the doc-processor backend field from today's effective Miyo /
  // self-host state, recording the current intent for the runtime accessor to
  // read. Uses the pure seed helper (not the accessor, which now reads this very
  // field and layers on live availability).
  if (fromVersion < 6) {
    const current = getSettings();
    setSettings({
      docProcessorBackend: seedDocProcessorBackend(current),
    });
  }

  // v7: seed the explicit `miyo-search` skill toggle from the user's persisted
  // Miyo intent, so an existing Miyo user isn't silently un-installed when the
  // implicit auto-seed becomes an opt-in switch. Keys off the persisted
  // `enableMiyo` field (not `getSearchBackend()`, which folds in
  // `Platform.isMobile` — a mobile-first upgrade would otherwise write `false`
  // and Sync it to desktop before desktop ever migrates).
  if (fromVersion < 7 && getSettings().enableMiyo === true) {
    setSettings({ enableMiyoSearchSkill: true });
  }

  // v8: seed the configurable `copilotFolder` root so the derived sub-folder
  // accessors have a concrete base to resolve against. Old vaults get the
  // historical hardcoded root, preserving their on-disk layout.
  if (fromVersion < 8) {
    setSettings({ copilotFolder: DEFAULT_COPILOT_FOLDER });

    // Seed the root-exclusion history with the legacy + current roots so both
    // stay permanently excluded from QA indexing after any future root change.
    const currentRoot = getSettings().copilotFolder;
    setSettings({
      copilotRootHistory: normalizeRootFolders([DEFAULT_COPILOT_FOLDER, currentRoot]),
    });

    // Capture, BEFORE the version bump below drops `fromVersion`, that this
    // vault predates v8 so WS-D can show the one-time folder-relocation prompt.
    // Every vault reaching this block is a pre-existing one: fresh installs are
    // stamped to the current version at bootstrap (settingsPersistence) and
    // never enter migration. That includes pre-versioned installs (real users
    // whose data.json predates the `settingsVersion` field → `fromVersion === 0`),
    // which are the oldest users and the most likely to have customized folders,
    // so they must get the flag too. WS-D still only prompts users who actually
    // customized a folder, so a default user is never shown the modal.
    setSettings({ upgradedToV8FromLegacy: true });
  }

  // v9: drop everything the retired GitHub Copilot chat provider owned —
  // its saved models, any selection still pointing at one, and its OAuth
  // tokens in the keychain. Reads the settings freshly so it sees whatever
  // the earlier migrations in this run left behind.
  if (fromVersion < 9) {
    executeGitHubCopilotRemoval(getSettings());
  }

  // v10: the custom OpenAI-compatible template now accepts keyless endpoints.
  // Existing rows persisted the old required-key default, so update those rows
  // while preserving any keychain pointer that records authenticated intent.
  if (fromVersion < 10) {
    const migrated = planOptionalCustomProviderAuthMigration(getSettings().providers);
    if (migrated) setSettings({ providers: migrated });
  }

  // v11: drop everything the removed Amazon Bedrock chat provider owned — its
  // provider rows, their models, the backend enrollments naming those models,
  // any selection still pointing at one, and its stored API keys. Reads the
  // settings freshly so it sees whatever the earlier migrations left behind.
  if (fromVersion < 11) {
    await executeBedrockRemoval(api, getSettings());
  }

  // Bump unconditionally after the migrations so a per-provider failure can't
  // wedge the gate into re-running on every load. Persists via the subscriber.
  setSettings({ settingsVersion: CURRENT_SETTINGS_VERSION });
}
