import { DEFAULT_COPILOT_FOLDER } from "@/constants";
import { logInfo, logWarn } from "@/logger";
import { seedDocProcessorBackend } from "@/miyo/miyoUtils";
import type { ModelManagementApi } from "@/modelManagement";
import {
  getSettings,
  normalizeRootFolders,
  setSettings,
  updateAgentModeBackendFields,
} from "@/settings/model";

import { executeAzureRemoval } from "./azureRemovalMigration";
import { planBackendDefaultModels } from "./backendDefaultModelMigration";
import { executeBedrockRemoval } from "./bedrockRemovalMigration";
import { executeByokMigration } from "./byokMigration";
import { planCodexModelIdCollapse } from "./codexModelIdMigration";
import { executeGitHubCopilotRemoval } from "./githubCopilotRemovalMigration";
import { planOptionalCustomProviderAuthMigration } from "./optionalCustomProviderAuthMigration";
import { planRequiresApiKeyBackfill } from "./requiresApiKeyMigration";
import { CURRENT_SETTINGS_VERSION } from "./version";

export { CURRENT_SETTINGS_VERSION } from "./version";

export async function runSettingsMigrations(api: ModelManagementApi): Promise<void> {
  const fromVersion = getSettings().settingsVersion ?? 0;
  if (fromVersion >= CURRENT_SETTINGS_VERSION) return;

  logInfo(`[settings-migration] migrating from v${fromVersion} to v${CURRENT_SETTINGS_VERSION}`);

  if (fromVersion < 4) {
    await executeByokMigration(api, getSettings());
  }

  if (fromVersion < 5) {
    const backfilled = planRequiresApiKeyBackfill(getSettings().providers);
    if (backfilled) setSettings({ providers: backfilled });
  }

  if (fromVersion < 6) {
    const current = getSettings();
    setSettings({
      docProcessorBackend: seedDocProcessorBackend(current),
    });
  }

  if (fromVersion < 7 && getSettings().enableMiyo === true) {
    setSettings({ enableMiyoSearchSkill: true });
  }

  if (fromVersion < 8) {
    setSettings({ copilotFolder: DEFAULT_COPILOT_FOLDER });

    const currentRoot = getSettings().copilotFolder;
    setSettings({
      copilotRootHistory: normalizeRootFolders([DEFAULT_COPILOT_FOLDER, currentRoot]),
    });

    setSettings({ upgradedToV8FromLegacy: true });
  }

  if (fromVersion < 9) {
    executeGitHubCopilotRemoval(getSettings());
  }

  if (fromVersion < 10) {
    const migrated = planOptionalCustomProviderAuthMigration(getSettings().providers);
    if (migrated) setSettings({ providers: migrated });
  }

  if (fromVersion < 11) {
    await executeBedrockRemoval(api, getSettings());
  }

  if (fromVersion < 12) {
    await executeAzureRemoval(api, getSettings());
  }

  // v14: fold Codex's per-effort configured models (`gpt-5.6-sol[low]` …
  // `[ultra]`) into one row per base model. Must run before agent/model
  // discovery: once the codex codec reads the real `<base>[<effort>]` format,
  // the first probe reports base ids and would otherwise prune every bracketed
  // row the user's enabled set points at.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/219
  if (fromVersion < 14) {
    const collapse = planCodexModelIdCollapse(getSettings());
    if (collapse) {
      const backends = getSettings().backends;
      setSettings({
        configuredModels: collapse.configuredModels,
        backends: {
          ...backends,
          // `BackendConfig` also carries `default`; rewriting the row whole would drop it.
          // https://github.com/Brevilabs/obsidian-copilot-private/issues/540
          codex: { ...backends.codex, enabledModels: collapse.enabledModels },
        },
      });
      if (collapse.defaultModel) {
        updateAgentModeBackendFields("codex", { defaultModel: collapse.defaultModel });
      }
    }
  }

  // v15: move each backend's default model into `backends.<id>.default`, beside
  // the enabled list it has to be drawn from. Runs last so it sees the codex row
  // collapse above and every earlier provider removal, and so the chat key it
  // reads is whatever those left behind.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/540
  if (fromVersion < 15) {
    const plan = planBackendDefaultModels(getSettings());
    for (const entry of plan.unresolved) {
      logWarn(
        `[settings-migration] v15: ${entry.backend} default "${entry.saved}" is ${entry.reason}; ` +
          `left unset, so it falls back to the first enabled model`
      );
    }
    if (plan.backends) setSettings({ backends: plan.backends });
  }

  setSettings({ settingsVersion: CURRENT_SETTINGS_VERSION });
}
