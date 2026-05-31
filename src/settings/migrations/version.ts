/**
 * Settings schema version. Bumped by the one-time migrations in this folder.
 *
 * Kept in its own leaf module (no heavy imports) so low-level code like the
 * settings-persistence layer can stamp fresh installs without pulling in the
 * model-management barrel that `runSettingsMigrations` depends on.
 *
 * Gate is `(settingsVersion ?? 0) < CURRENT`, so pre-versioned installs (real
 * users → `0`) and the orphaned prototype `2` run every pending migration;
 * freshly-stamped installs skip. Each migration is individually version-gated
 * in `runSettingsMigrations`, so a vault already at an intermediate version
 * only runs the migrations newer than it.
 *
 *   ≤ 4 → legacy BYOK → model-management migration.
 *   5   → backfill `Provider.requiresApiKey` on flagless rows.
 *   6   → segment device-specific agent settings (binary paths, env overrides)
 *         under `agentMode.deviceProfiles[deviceId]` so a synced data.json no
 *         longer shares one device's paths globally (GitHub #2539).
 */
export const CURRENT_SETTINGS_VERSION = 6;

/**
 * Settings version at which per-device agent profiles were introduced. The
 * `dehydrateDeviceProfile` transform is a no-op below this version so legacy
 * vaults keep their flat agent fields on disk until the v6 migration runs.
 */
export const DEVICE_PROFILES_SETTINGS_VERSION = 6;
