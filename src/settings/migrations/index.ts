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

import { logInfo } from "@/logger";
import { seedDocProcessorBackend } from "@/miyo/miyoUtils";
import type { ModelManagementApi } from "@/modelManagement";
import { getSettings, setSettings } from "@/settings/model";

import { executeByokMigration } from "./byokMigration";
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

  // Bump unconditionally after the migrations so a per-provider failure can't
  // wedge the gate into re-running on every load. Persists via the subscriber.
  setSettings({ settingsVersion: CURRENT_SETTINGS_VERSION });
}
