import { DEFAULT_COPILOT_FOLDER } from "@/constants";
import { logInfo } from "@/logger";
import type { ModelManagementApi } from "@/modelManagement";
import {
  getSettings,
  normalizeRootFolders,
  setSettings,
  updateAgentModeBackendFields,
} from "@/settings/model";

import { executeAzureRemoval } from "./azureRemovalMigration";
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
      setSettings({
        configuredModels: collapse.configuredModels,
        backends: {
          ...getSettings().backends,
          codex: { enabledModels: collapse.enabledModels },
        },
      });
      if (collapse.defaultModel) {
        updateAgentModeBackendFields("codex", { defaultModel: collapse.defaultModel });
      }
    }
  }

  // v15: the Plus/Miyo `docProcessorBackend` choice became an on/off switch; only "plus" turns it off.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/654
  if (fromVersion < 15) {
    const { docProcessorBackend } = getSettings() as unknown as Record<string, unknown>;
    setSettings({ enableMiyoDocumentProcessing: docProcessorBackend !== "plus" });
  }

  // v16: "Semantic search for agents" defaults on once Miyo connects. Installs that are not connected
  // persisted the old default (off) while the switch was locked, so they take the new default; connected
  // installs keep what they have.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/716
  if (fromVersion < 16 && getSettings().enableMiyo !== true) {
    setSettings({ enableMiyoSearchSkill: true });
  }

  setSettings({ settingsVersion: CURRENT_SETTINGS_VERSION });
}
