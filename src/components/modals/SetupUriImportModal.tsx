/**
 * Obsidian Modal shell for importing Copilot configuration from an encrypted .copilot file.
 * Renders the ImportStepperContent React component inside the modal.
 *
 * Business logic methods (persist, restore, reload) are kept on this class
 * and passed as callbacks to the React component, ensuring async operations
 * are not interrupted by React unmount.
 */

import { ImportStepperContent } from "@/components/setup-uri/ImportStepperContent";
import { DEFAULT_SETTINGS } from "@/constants";
import { KeychainService } from "@/services/keychainService";
import { persistSettings, suppressNextPersistOnce } from "@/services/settingsPersistence";
import type { CopilotSettings } from "@/settings/model";
import { getSettings, replaceSettings } from "@/settings/model";
import {
  restoreVaultFiles,
  rollbackVaultFiles,
  type CollectedVaultFiles,
  type RestoreRollbackEntry,
} from "@/setupUri/vaultFiles";
import { logError } from "@/logger";
import { App, Modal, Notice } from "obsidian";
import React from "react";
import { createRoot, Root } from "react-dom/client";

export class SetupUriImportModal extends Modal {
  private root?: Root;
  /** Injected saveData callback to avoid reaching into app.plugins at runtime. */
  private readonly saveDataFn: (data: CopilotSettings) => Promise<void>;
  /** Tracks written files for rollback if a later import step fails. */
  private pendingRestoreRollback: RestoreRollbackEntry[] = [];

  /**
   * @param app Obsidian App instance.
   * @param saveData Callback to persist data.json (typically `plugin.saveData`).
   */
  constructor(app: App, saveData: (data: CopilotSettings) => Promise<void>) {
    super(app);
    this.saveDataFn = saveData;
  }

  onOpen(): void {
    this.root = createRoot(this.contentEl);
    this.root.render(
      <ImportStepperContent
        app={this.app}
        onPersistSettings={(settings) => this.persistImportedSettings(settings)}
        onRestoreVaultFiles={(files, settings) => this.restoreFiles(files, settings)}
        onReloadPlugin={() => this.reloadPlugin()}
        onClose={() => this.close()}
      />
    );
  }

  onClose(): void {
    this.root?.unmount();
    this.root = undefined;
  }

  /**
   * Restore vault files (custom commands, system prompts, memory) to the vault.
   *
   * Reason: must run before persistImportedSettings so that when settings
   * subscribers react to folder path changes, the files are already in place.
   */
  private async restoreFiles(
    files: CollectedVaultFiles,
    importedSettings: CopilotSettings
  ): Promise<void> {
    const result = await restoreVaultFiles(this.app, files, importedSettings);
    this.pendingRestoreRollback = result.rollback;
    if (result.errors.length > 0) {
      await this.rollbackRestoredFiles();
      throw new Error(`Failed to write some files:\n${result.errors.join("\n")}`);
    }
  }

  /**
   * Undo vault file writes if a later import step fails.
   * @returns Paths that could not be rolled back (empty if fully successful).
   */
  private async rollbackRestoredFiles(): Promise<string[]> {
    if (this.pendingRestoreRollback.length === 0) return [];
    const rollback = this.pendingRestoreRollback;
    this.pendingRestoreRollback = [];
    try {
      const failedPaths = await rollbackVaultFiles(this.app, rollback);
      if (failedPaths.length > 0) {
        new Notice(
          "Some files could not be restored to their original state. " +
            "Please check: " +
            failedPaths.join(", ")
        );
      }
      return failedPaths;
    } catch (error) {
      logError("Failed to roll back imported vault files.", error);
      return rollback.map((e) => e.path);
    }
  }

  /**
   * Persist imported settings to disk and await completion before reload.
   *
   * Reason: decryptConfigFile() returns sanitized settings without calling
   * setSettings(), so there is no subscriber-triggered save. This is the
   * single persistence path, eliminating double-save races.
   */
  private async persistImportedSettings(settings: CopilotSettings): Promise<void> {
    const currentLocal = getSettings();

    // Reason: start from DEFAULT_SETTINGS so omitted secret fields become ""
    // and therefore emit keychain tombstones for stale entries.
    // Reason: preserve vault-local fields that were stripped during import.
    const merged = { ...DEFAULT_SETTINGS, ...settings } as Record<string, unknown>;
    const localRec = currentLocal as unknown as Record<string, unknown>;
    if (localRec._keychainVaultId) {
      merged._keychainVaultId = localRec._keychainVaultId;
    }

    // Reason: preserve the local vault's existing disk-secret policy.
    const keychainAvailable = KeychainService.getInstance().isAvailable();
    if (!keychainAvailable) {
      merged._diskSecretsCleared = false;
    } else if (localRec._diskSecretsCleared != null) {
      merged._diskSecretsCleared = localRec._diskSecretsCleared;
    }

    // Reason: when disk secrets are not yet cleared, importing introduces new
    // secrets into data.json. Reset the migration timer for a fresh 7-day window.
    if (merged._diskSecretsCleared !== true) {
      if (keychainAvailable) {
        merged._keychainMigratedAt = new Date().toISOString();
      }
      delete merged._migrationModalDismissed;
    } else {
      if (localRec._keychainMigratedAt) {
        merged._keychainMigratedAt = localRec._keychainMigratedAt;
      }
      if (localRec._migrationModalDismissed === true) {
        merged._migrationModalDismissed = true;
      }
    }
    const mergedSettings = merged as unknown as CopilotSettings;

    // Reason: persistSettings now handles keychain rollback internally on
    // failure, so no need to track reachedDiskSave or sync partial state here.
    try {
      await persistSettings(mergedSettings, async (data) => this.saveDataFn(data), currentLocal);
    } catch (error) {
      // Reason: rollback vault files written in restoreFiles() so the vault
      // is not left half-imported when settings persistence fails.
      await this.rollbackRestoredFiles();
      throw error;
    }

    // Reason: import fully succeeded — clear rollback entries.
    this.pendingRestoreRollback = [];

    // Reason: sync in-memory settings to imported values so reload failure
    // doesn't leave stale settings that could overwrite the persisted config.
    suppressNextPersistOnce();
    replaceSettings(mergedSettings);
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
