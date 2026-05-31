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
 */
export const CURRENT_SETTINGS_VERSION = 5;
