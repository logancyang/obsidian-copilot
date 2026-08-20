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
 *   6   → seed `docProcessorBackend` from effective Miyo state.
 *   7   → seed `enableMiyoSearchSkill` from persisted `enableMiyo` intent.
 *   8   → seed `copilotFolder` root so derived sub-folder accessors resolve.
 *   9   → drop models, selections, and tokens of the retired GitHub Copilot
 *         chat provider.
 *   10  → make auth optional on existing custom OpenAI-compatible BYOK rows.
 *   11  → drop the providers, models, enrollments and keys of the removed
 *         Amazon Bedrock chat provider.
 */
export const CURRENT_SETTINGS_VERSION = 11;
