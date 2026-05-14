import { Button } from "@/components/ui/button";
import { SettingItem } from "@/components/ui/setting-item";
import { ObsidianNativeSelect } from "@/components/ui/obsidian-native-select";
import { useApp } from "@/context";
import { logFileManager } from "@/logFileManager";
import { flushRecordedPromptPayloadToLog } from "@/LLMProviders/chainRunner/utils/promptPayloadRecorder";
import { KeychainService } from "@/services/keychainService";
import {
  canClearDiskSecrets,
  hasDiskSecretsToMigrate,
  migrateDiskSecretsToKeychain,
  refreshDiskHasSecrets,
  refreshLastPersistedSettings,
  runPersistenceTransaction,
  suppressNextPersistOnce,
} from "@/services/settingsPersistence";
import { hasPersistedSecrets, isKeychainOnly } from "@/services/settingsSecretTransforms";
import { logError } from "@/logger";
import {
  type CopilotSettings,
  setSettings,
  updateSetting,
  useSettingsValue,
} from "@/settings/model";
import { ArrowUpRight, Info, Plus, ShieldCheck, Trash2, Unlock } from "lucide-react";
import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { MigrateConfirmModal } from "@/components/modals/MigrateConfirmModal";
import { type App, Notice } from "obsidian";
import React, { useCallback, useState } from "react";
import { getPromptFilePath, SystemPromptAddModal } from "@/system-prompts";
import { useSystemPrompts } from "@/system-prompts/state";

/**
 * Returns a `saveData` callback bound to the loaded Copilot plugin instance.
 *
 * Reason: settings React components don't have direct access to the plugin,
 * so persistence transactions look it up via the Obsidian `App`. Kept as a
 * single helper to centralise the `app.plugins` cast (untyped in the Obsidian
 * API) and the "plugin not found" guard at every call site.
 */
function getCopilotSaveData(app: App): (data: CopilotSettings) => Promise<void> {
  return async (data: CopilotSettings) => {
    const { plugins } = app as unknown as {
      plugins: {
        getPlugin: (id: string) => { saveData: (data: CopilotSettings) => Promise<void> } | null;
      };
    };
    const copilotPlugin = plugins.getPlugin("copilot");
    if (!copilotPlugin) throw new Error("Copilot plugin not found");
    await copilotPlugin.saveData(data);
  };
}

export const AdvancedSettings: React.FC = () => {
  const app = useApp();
  const settings = useSettingsValue();
  const prompts = useSystemPrompts();
  const [forgetting, setForgetting] = useState(false);
  const [migrating, setMigrating] = useState(false);

  const keychainAvailable = KeychainService.getInstance().isAvailable();
  const keychainOnly = isKeychainOnly(settings);
  // Reason: `hasDiskSecretsToMigrate()` only refreshes after persist runs,
  // so React doesn't re-render when the user types a new key. Union with
  // current in-memory `settings` presence so the Migrate / Delete CTAs
  // appear immediately. Matches the gate used in `canClearDiskSecrets()`.
  const diskHasSecrets =
    hasDiskSecretsToMigrate() || (!keychainOnly && hasPersistedSecrets(settings));
  const canMigrate = canClearDiskSecrets(settings);

  // Reason: a single status string is easier to reason about and debug than
  // a constellation of booleans. Order matters — earlier branches short-circuit.
  // The mode itself is `_keychainOnly`, not the absence of disk secrets — an
  // existing user with no keys configured is still in disk mode and would write
  // any newly entered key back to data.json. The "blocked" state is reserved
  // for the genuine "has keys but cannot migrate" case so its warning copy
  // remains accurate. The "stranded" state is reserved for a keychain-only
  // vault opened on a build without SecretStorage — saves silently strip
  // secrets (Fix 2), so the user MUST be told their inputs won't persist here.
  const storageStatus: "unavailable" | "stranded" | "active" | "standard" | "blocked" =
    !keychainAvailable
      ? keychainOnly
        ? "stranded"
        : "unavailable"
      : keychainOnly
        ? "active"
        : diskHasSecrets && !canMigrate
          ? "blocked"
          : "standard";

  // Reason: keychain-only mode + keychain available but this device has no
  // secrets persisted yet. Hits three real scenarios: (1) desktop migrated
  // then Sync shipped a stripped data.json to mobile; (2) backup restore of a
  // _keychainOnly vault to a new device; (3) synced vault opened on a third
  // device for the first time. Without surfacing this, the green "active"
  // pill misleads the user into thinking everything is fine.
  const keychainAppearsEmpty = storageStatus === "active" && !hasPersistedSecrets(settings);

  // Check if the default system prompt exists in the current prompts list
  const defaultPromptExists = prompts.some(
    (prompt) => prompt.title === settings.defaultSystemPromptTitle
  );

  const displayValue = defaultPromptExists ? settings.defaultSystemPromptTitle : "";

  const handleSelectChange = (value: string) => {
    updateSetting("defaultSystemPromptTitle", value);
  };

  const handleOpenSourceFile = () => {
    if (!displayValue) return;
    const filePath = getPromptFilePath(displayValue);
    // Close the settings modal before opening the file
    (app as unknown as { setting: { close: () => void } }).setting.close();
    void app.workspace.openLinkText(filePath, "", true);
  };

  const handleAddPrompt = () => {
    const modal = new SystemPromptAddModal(app, prompts);
    modal.open();
  };

  const handleForgetAllSecrets = useCallback(async () => {
    if (forgetting) return;

    // Reason: double-confirm destructive action via project ConfirmModal
    const confirmed = await new Promise<boolean>((resolve) => {
      new ConfirmModal(
        app,
        () => resolve(true),
        "This will remove all API keys for this vault from the Obsidian Keychain, data.json, " +
          "and memory. You will need to re-enter them.",
        "\u26A0\uFE0F Forget All Secrets",
        "Remove",
        "Cancel",
        () => resolve(false)
      ).open();
    });
    if (!confirmed) return;

    setForgetting(true);
    try {
      const keychain = KeychainService.getInstance();
      const saveData = getCopilotSaveData(app);

      // Reason: run inside the persistence queue to prevent interleaving
      // with normal saves that could restore old secrets.
      let skipSuppress = false;
      await runPersistenceTransaction(() =>
        keychain.forgetAllSecrets(
          saveData,
          refreshDiskHasSecrets,
          (nextSettings) => {
            refreshLastPersistedSettings(nextSettings as CopilotSettings);
            if (!skipSuppress) {
              suppressNextPersistOnce();
            }
            setSettings(nextSettings);
          },
          // Reason: disk save failed → forgetAllSecrets is a no-op (no memory
          // or keychain changes). This callback is reserved for future retry logic.
          () => {
            skipSuppress = true;
          }
        )
      );
    } catch (error) {
      logError("Failed to forget secrets.", error);
      new Notice("Failed to remove API keys. Please try again.");
    } finally {
      setForgetting(false);
    }
  }, [app, forgetting]);

  /**
   * Move all secrets to the Keychain in a single transaction:
   * write keychain → strip data.json → set _keychainOnly=true.
   *
   * The MigrateConfirmModal gates the action behind a checkbox so the
   * multi-device trade-off is acknowledged before any destructive write.
   */
  const handleMigrate = useCallback(async () => {
    if (migrating) return;

    // DESIGN NOTE — `migrating` only flips true after the confirm modal
    // closes, so a fast double-click can open two modals. Intentionally not
    // pre-gating because the second confirmed run is already serialized by
    // `runPersistenceTransaction` and short-circuited by `canClearDiskSecrets`
    // (returns "no secrets left to migrate"), producing a benign error
    // Notice. Adding a pre-modal guard adds state for a cosmetic UX wart.
    // If a future review flags this again, point them at this note.
    const confirmed = await new Promise<boolean>((resolve) => {
      new MigrateConfirmModal(
        app,
        () => resolve(true),
        () => resolve(false)
      ).open();
    });
    if (!confirmed) return;

    setMigrating(true);
    try {
      const saveData = getCopilotSaveData(app);
      // Reason: migrateDiskSecretsToKeychain owns the full transaction —
      // write keychain, strip disk, flip _keychainOnly, with rollback on
      // partial failure. Returns the list of legacy enc_* fields that could
      // not be decrypted and were cleared instead of migrated; the user
      // needs to re-enter those keys.
      const result = await migrateDiskSecretsToKeychain(saveData);
      if (result.fieldsRequiringReentry.length > 0) {
        const fieldList = result.fieldsRequiringReentry.map((f) => `  • ${f}`).join("\n");
        new Notice(
          `API keys moved to Obsidian Keychain.\n\n${result.fieldsRequiringReentry.length} key(s) could not be decrypted and need to be re-entered:\n${fieldList}`,
          // Reason: duration=0 keeps the notice up until the user dismisses
          // it. The default 10s is too short to read a field list and act on
          // it. Do NOT shorten — see TERMINOLOGY/PARTIAL-SUCCESS note below.
          0
        );
      } else {
        new Notice("API keys moved to Obsidian Keychain.");
      }
    } catch (error) {
      logError("Failed to migrate secrets to Obsidian Keychain.", error);
      new Notice("Failed to migrate to Obsidian Keychain. Please try again.");
    } finally {
      setMigrating(false);
    }
  }, [app, migrating]);

  // DESIGN NOTE — do NOT "fix" the migration UX by making it fail closed when
  // undecryptable enc_* fields exist:
  //   - End state is identical (user re-enters the listed keys either way).
  //   - Partial-success takes 2 user steps (Migrate → re-enter).
  //     Fail-closed takes 3 (try Migrate → re-enter → retry Migrate).
  //   - The multi-device "ciphertext recoverability" argument is already
  //     handled by MigrateConfirmModal's explicit "Other devices will need to
  //     re-enter their API keys" disclosure.
  // See the matching note above `collectUndecryptableFields` in
  // settingsPersistence.ts.
  //
  // TERMINOLOGY NOTE — user-facing copy uses "Obsidian Keychain" / "Obsidian's
  // Keychain" (or bare "Keychain" inside a Keychain-context paragraph). It is
  // vault-scoped storage managed by Obsidian via SecretStorage. Do NOT change
  // to "OS Keychain" (overpromises OS-level guarantees) or "Secure Storage"
  // (too generic, loses the Keychain mental model). See the matching note in
  // MigrateConfirmModal.tsx.

  return (
    <div className="tw-space-y-4">
      {/* User System Prompt Section */}
      <section className="tw-space-y-4 tw-rounded-lg tw-border tw-p-4">
        <div className="tw-text-xl tw-font-bold">User System Prompt</div>

        <SettingItem
          type="custom"
          title="Default System Prompt"
          description="Customize the system prompt for all messages, may result in unexpected behavior!"
        >
          <div className="tw-flex tw-items-center tw-gap-2">
            <ObsidianNativeSelect
              value={displayValue}
              onChange={(e) => handleSelectChange(e.target.value)}
              options={[
                { label: "None (use built-in prompt)", value: "" },
                ...prompts.map((prompt) => ({
                  label:
                    prompt.title === settings.defaultSystemPromptTitle
                      ? `${prompt.title} (Default)`
                      : prompt.title,
                  value: prompt.title,
                })),
              ]}
              containerClassName="tw-flex-1"
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={handleOpenSourceFile}
              className="tw-size-5 tw-shrink-0 tw-p-0"
              title="Open the source file"
              disabled={!displayValue}
            >
              <ArrowUpRight className="tw-size-5" />
            </Button>
            <Button variant="default" size="icon" onClick={handleAddPrompt} title="Add new prompt">
              <Plus className="tw-size-4" />
            </Button>
          </div>
        </SettingItem>

        <SettingItem
          type="text"
          title="System Prompts Folder Name"
          description="Folder where system prompts are stored."
          value={settings.userSystemPromptsFolder}
          onChange={(value) => updateSetting("userSystemPromptsFolder", value)}
          placeholder="copilot/system-prompts"
        />
      </section>

      {/* Others Section */}
      <section className="tw-space-y-4 tw-rounded-lg tw-border tw-p-4">
        <div className="tw-text-xl tw-font-bold">Others</div>

        {/* API Key Storage — five-state UI driven by storageStatus.
            Right column stacks pill + buttons vertically. Blocked state reuses
            standard's visual shape but disables Migrate and exposes the reason
            via the button's tooltip. Stranded state is for keychain-only vaults
            opened on a build without SecretStorage: saves silently strip
            secrets, so we warn the user and hide the Migrate/Delete buttons. */}
        <SettingItem
          type="custom"
          title="API Key Storage"
          description={
            storageStatus === "unavailable" ? (
              <>
                Update Obsidian to <code>1.11.4+</code> to enable the{" "}
                <strong className="tw-font-semibold tw-text-normal">Obsidian Keychain</strong>. Keys
                are stored in <code>data.json</code>.
              </>
            ) : storageStatus === "stranded" ? (
              <>
                This vault uses the{" "}
                <strong className="tw-font-semibold tw-text-normal">Obsidian Keychain</strong>, but
                this Obsidian build cannot access it. Keys you enter here won&apos;t persist. Update
                Obsidian to <code>1.11.4+</code>, or re-enter keys on a supported device.
              </>
            ) : storageStatus === "active" ? (
              keychainAppearsEmpty ? (
                <span className="tw-text-warning">
                  No API keys found in this device&apos;s{" "}
                  <strong className="tw-font-semibold tw-text-normal">Obsidian Keychain</strong>.
                  Re-enter your API keys in the relevant settings sections — this device&apos;s
                  keychain is separate from other devices.
                </span>
              ) : (
                <>
                  API keys are stored in this device&apos;s{" "}
                  <strong className="tw-font-semibold tw-text-normal">Obsidian Keychain</strong>.
                </>
              )
            ) : (
              <>
                Your API keys are stored in <code>data.json</code>. Move them to the{" "}
                <strong className="tw-font-semibold tw-text-normal">Obsidian Keychain</strong> for
                stronger protection.
              </>
            )
          }
        >
          <div className="tw-flex tw-flex-col tw-items-start tw-gap-2 sm:tw-items-end">
            {storageStatus === "active" && (
              <div className="tw-inline-flex tw-items-center tw-gap-1.5 tw-rounded-md tw-bg-success tw-px-3 tw-py-1 tw-text-smallest tw-font-semibold tw-text-success">
                <ShieldCheck className="tw-size-4" />
                Obsidian Keychain
              </div>
            )}
            {(storageStatus === "standard" || storageStatus === "blocked") && (
              <div className="tw-inline-flex tw-items-center tw-gap-1.5 tw-rounded-md tw-border tw-border-border tw-bg-callout-warning/20 tw-px-3 tw-py-1 tw-text-smallest tw-font-semibold tw-text-warning">
                <Unlock className="tw-size-4" />
                Standard Storage
              </div>
            )}
            {storageStatus === "unavailable" && (
              <div className="tw-inline-flex tw-items-center tw-gap-1.5 tw-rounded-md tw-border tw-border-border tw-bg-secondary tw-px-3 tw-py-1 tw-text-smallest tw-font-semibold tw-text-muted">
                <Info className="tw-size-4" />
                Unavailable
              </div>
            )}
            {storageStatus === "stranded" && (
              <div className="tw-inline-flex tw-items-center tw-gap-1.5 tw-rounded-md tw-border tw-border-border tw-bg-callout-warning/20 tw-px-3 tw-py-1 tw-text-smallest tw-font-semibold tw-text-warning">
                <Info className="tw-size-4" />
                Obsidian Keychain unavailable
              </div>
            )}

            {storageStatus === "blocked" && (
              // Reason: visible explanation for the blocked state — disabled
              // button `title` alone is unreliable on mobile and assistive tech.
              <div className="tw-text-smallest tw-text-muted sm:tw-text-right">
                Save your settings once, then try again.
              </div>
            )}

            {(storageStatus === "standard" || storageStatus === "blocked") && diskHasSecrets && (
              <Button
                variant="default"
                size="sm"
                onClick={handleMigrate}
                disabled={migrating || forgetting || storageStatus !== "standard"}
                className="tw-gap-1.5"
              >
                <ShieldCheck className="tw-size-4" />
                {migrating ? "Migrating..." : "Migrate to Obsidian Keychain"}
              </Button>
            )}

            {/* Reason: only show Delete when secrets actually exist somewhere.
                Hiding it in standard/no-secret state prevents accidentally
                flipping the vault to keychain-only mode with no real cleanup.
                In "stranded" state the action is disabled — this build can't
                reach the Obsidian Keychain to actually clear the entries, so
                pretending to delete them would let secrets resurface after
                upgrading. The button stays visible (rather than hidden) so the
                user understands why the action is unavailable here. */}
            {(keychainOnly || diskHasSecrets) && (
              <Button
                variant="destructive"
                size="sm"
                onClick={handleForgetAllSecrets}
                disabled={forgetting || migrating || storageStatus === "stranded"}
                title={
                  storageStatus === "stranded"
                    ? "Update Obsidian to 1.11.4+ (or open this vault on a device with Keychain access) to delete the Keychain entries."
                    : undefined
                }
                className="tw-gap-1.5"
              >
                <Trash2 className="tw-size-4" />
                {forgetting ? "Removing..." : "Delete All Keys"}
              </Button>
            )}
          </div>
        </SettingItem>

        <SettingItem
          type="switch"
          title="Debug Mode"
          description="Debug mode will log some debug message to the console."
          checked={settings.debug}
          onCheckedChange={(checked) => updateSetting("debug", checked)}
        />

        <SettingItem
          type="custom"
          title="Create Log File"
          description={`Open the Copilot log file (${logFileManager.getLogPath()}) for easy sharing when reporting issues.`}
        >
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              void (async () => {
                await flushRecordedPromptPayloadToLog();
                await logFileManager.flush();
                await logFileManager.openLogFile();
              })();
            }}
          >
            Create Log File
          </Button>
        </SettingItem>
      </section>
    </div>
  );
};
