/**
 * Obsidian Modal shell for importing Copilot settings from an encrypted Setup URI.
 * Renders the ImportStepperContent React component inside the modal.
 *
 * Business logic methods (persist, reload, notify) are kept on this class
 * and passed as callbacks to the React component, ensuring async operations
 * are not interrupted by React unmount.
 */

import { ImportStepperContent } from "@/components/setup-uri/ImportStepperContent";
import { DEFAULT_SETTINGS } from "@/constants";
import { KeychainService } from "@/services/keychainService";
import { persistSettings, suppressNextPersistOnce } from "@/services/settingsPersistence";
import type { CopilotSettings } from "@/settings/model";
import { getSettings, replaceSettings } from "@/settings/model";
import { App, Modal, Notice } from "obsidian";
import React from "react";
import { createRoot, Root } from "react-dom/client";

export class SetupUriImportModal extends Modal {
  private root?: Root;
  /** Optional pre-filled payload from the protocol handler. */
  private readonly prefillPayload?: string;
  /** Injected saveData callback to avoid reaching into app.plugins at runtime. */
  private readonly saveDataFn: (data: CopilotSettings) => Promise<void>;

  /**
   * @param app Obsidian App instance.
   * @param saveData Callback to persist data.json (typically `plugin.saveData`).
   * @param prefillPayload When provided (from protocol handler), the URI
   *   textarea is pre-filled and readonly.
   */
  constructor(
    app: App,
    saveData: (data: CopilotSettings) => Promise<void>,
    prefillPayload?: string
  ) {
    super(app);
    this.saveDataFn = saveData;
    this.prefillPayload = prefillPayload;
  }

  onOpen(): void {
    this.root = createRoot(this.contentEl);
    this.root.render(
      <ImportStepperContent
        prefillPayload={this.prefillPayload}
        onPersistSettings={(settings) => this.persistImportedSettings(settings)}
        onReloadPlugin={() => this.reloadPlugin()}
        onNotifyManualCopy={(folders) => this.notifyManualCopyNeeded(folders)}
        onClose={() => this.close()}
      />
    );
  }

  onClose(): void {
    this.root?.unmount();
    this.root = undefined;
  }

  /**
   * Persist imported settings to disk and await completion before reload.
   *
   * Reason: applySetupUri() returns sanitized settings without calling
   * setSettings(), so there is no subscriber-triggered save. This is the
   * single persistence path, eliminating the previous double-save race.
   */
  private async persistImportedSettings(settings: CopilotSettings): Promise<void> {
    // Reason: Use the unified persistence path so secrets are written to
    // keychain (when available) instead of being encrypted into data.json.
    // Pass current settings as prevSettings so deleted models get cleaned up from keychain.
    const currentLocal = getSettings();

    // Reason: start from DEFAULT_SETTINGS so omitted secret fields become ""
    // and therefore emit keychain tombstones for stale entries from the target
    // vault instead of silently preserving them.
    // Reason: preserve vault-local fields that were stripped during import.
    // Without this, the target vault loses its keychain namespace and clear state.
    const merged = { ...DEFAULT_SETTINGS, ...settings } as Record<string, unknown>;
    const localRec = currentLocal as unknown as Record<string, unknown>;
    if (localRec._keychainVaultId) {
      merged._keychainVaultId = localRec._keychainVaultId;
    }

    // Reason: preserve the local vault's existing disk-secret policy.
    // If the user already completed migration (_diskSecretsCleared=true),
    // respect that choice — imported secrets go to keychain only.
    // If the vault is still in transition (false/undefined), keep it so
    // secrets also persist to data.json for older synced devices.
    // Reason: when keychain is unavailable, imported secrets MUST go to
    // data.json. Reset _diskSecretsCleared to false so the persist path
    // keeps secrets on disk instead of stripping them.
    const keychainAvailable = KeychainService.getInstance().isAvailable();
    if (!keychainAvailable) {
      merged._diskSecretsCleared = false;
    } else if (localRec._diskSecretsCleared != null) {
      merged._diskSecretsCleared = localRec._diskSecretsCleared;
    }

    // Reason: when disk secrets are not yet cleared, importing introduces new
    // secrets into data.json. Reset the migration timer to now (fresh 7-day
    // window) so auto-clear doesn't fire immediately if the old timer was
    // already past the deadline. Also clear the modal dismissal so the user
    // gets re-prompted about the newly imported secrets.
    // Reason: only stamp the timer when keychain is actually available. If
    // unavailable, leave it unset so loadSettingsWithKeychain can stamp it
    // on the first real backfill, giving a correct 7-day window.
    if (merged._diskSecretsCleared !== true) {
      if (keychainAvailable) {
        merged._keychainMigratedAt = new Date().toISOString();
      }
      delete merged._migrationModalDismissedAt;
    } else {
      // Disk secrets already cleared — preserve existing migration metadata.
      if (localRec._keychainMigratedAt) {
        merged._keychainMigratedAt = localRec._keychainMigratedAt;
      }
      if (localRec._migrationModalDismissedAt) {
        merged._migrationModalDismissedAt = localRec._migrationModalDismissedAt;
      }
    }
    const mergedSettings = merged as unknown as CopilotSettings;

    // Reason: no diskSecretSource needed — the transition-period save path
    // (fix for stale rawDataSnapshot) now uses current settings directly,
    // which already contains the imported secrets.
    try {
      await persistSettings(mergedSettings, (data) => this.saveDataFn(data), currentLocal);
    } catch (error) {
      // Reason: persistSettings writes keychain BEFORE data.json. If data.json
      // save fails, keychain may already hold the imported secrets. We must sync
      // in-memory state to match keychain so restart doesn't produce a mixed state.
      // Reason: only sync memory when keychain is available — keychain writes may
      // have already succeeded before data.json failed. When keychain is unavailable,
      // nothing was written anywhere, so swapping memory would let the next
      // unrelated save silently commit a "failed" import.
      if (keychainAvailable) {
        suppressNextPersistOnce();
        replaceSettings(mergedSettings);
      }
      throw error;
    }

    // Reason: sync in-memory settings to the imported values so that if reload
    // fails, the running plugin doesn't hold stale settings that could overwrite
    // the freshly persisted config on the next save.
    // Reason: use replaceSettings (not setSettings) so that fields absent from
    // the imported payload (dropped by JSON.stringify for undefined values) are
    // reset to defaults instead of leaking old target-vault values.
    suppressNextPersistOnce();
    replaceSettings(mergedSettings);
  }

  /**
   * Show a reminder about vault files that are NOT included in Setup URI.
   *
   * Reason: custom commands, system prompts, and memory files live in the vault
   * filesystem, not in plugin settings. Users must copy these folders
   * manually from the source vault.
   */
  private notifyManualCopyNeeded(imported: {
    customPromptsFolder?: string;
    userSystemPromptsFolder?: string;
    memoryFolderName?: string;
  }): void {
    const folders = [
      imported.customPromptsFolder,
      imported.userSystemPromptsFolder,
      imported.memoryFolderName,
    ].filter(Boolean);

    if (folders.length === 0) return;

    const folderList = folders.map((f) => `  \u2022 ${f}`).join("\n");
    new Notice(
      "Note: Custom commands, system prompts, and memory files are not " +
        "included in the Setup URI. To complete the migration, manually " +
        `copy these folders from the source vault:\n${folderList}`,
      15_000
    );
  }

  /** Reload the Copilot plugin to apply imported settings. */
  private async reloadPlugin(): Promise<void> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const plugins = (this.app as any).plugins;
      await plugins.disablePlugin("copilot");
      await plugins.enablePlugin("copilot");
      new Notice("Plugin reloaded successfully.");
    } catch {
      new Notice("Please restart Obsidian to apply the imported settings.");
    }
  }
}
