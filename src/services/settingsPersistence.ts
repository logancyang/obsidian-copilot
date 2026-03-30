/**
 * Unified settings persistence layer.
 *
 * Handles loading (with keychain backfill) and saving (with disk-secret
 * management based on _diskSecretsCleared flag).
 */

import {
  type CopilotSettings,
  getModelKeyFromModel,
  getSettings,
  normalizeModelProvider,
  sanitizeSettings,
  setSettings,
} from "@/settings/model";
import { isEncryptedValue, getDecryptedKey } from "@/encryptionService";
import { KeychainService, isSecretKey } from "@/services/keychainService";
import {
  cleanupLegacyFields,
  hasPersistedSecrets,
  stripKeychainFields,
} from "@/services/settingsSecretTransforms";
// Reason: logWarn is safe to import (lazy — only calls getSettings() when invoked),
// but only used in doPersist() which runs after settings are loaded.
// For code that runs DURING settings loading (loadSettingsWithKeychain), use console.*.
import { logWarn } from "@/logger";

/**
 * Write queue to serialize all persistence operations.
 *
 * Reason: The settings subscriber fires synchronously on every `setSettings()` call,
 * but keychain + data.json writes are async. Without serialization, rapid successive
 * `setSettings()` calls would cause concurrent writes with unpredictable ordering.
 *
 * Dedicated transactions (forgetAllSecrets, migration modal "clear now") also run
 * through this queue via `runPersistenceTransaction()` to prevent interleaving.
 */
let writeQueue: Promise<void> = Promise.resolve();

/**
 * Snapshot of the raw data.json contents at load time.
 *
 * Used by the migration modal to check whether data.json still has
 * non-empty sensitive fields (`hasPersistedSecrets`), and refreshed
 * after every successful `saveData()` call to stay in sync.
 */
let rawDataSnapshot: Record<string, unknown> = {};

/**
 * Settings snapshot from the last successful `saveData()` call.
 *
 * Reason: the settings subscriber advances `prev` immediately, even before
 * the async persist completes. If `saveData()` fails, the next `doPersist`
 * would receive a `prevSettings` that was never actually persisted, causing
 * `preserveUnchangedDiskSecrets` to compare against phantom state. This
 * field tracks what was truly last persisted so the comparison is correct.
 */
let lastPersistedSettings: CopilotSettings | undefined;

/**
 * When true, the next `persistSettings()` call is skipped entirely.
 *
 * Reason: dedicated transactions like `forgetAllSecrets` and the migration
 * modal's "clear now" button write data.json themselves, then call
 * `setSettings()` to sync memory. That `setSettings()` triggers the
 * subscriber which calls `persistSettings()` again — without this guard
 * the subscriber would re-enter the normal save path and potentially
 * overwrite the transaction's output.
 */
let suppressNextPersist = false;

/**
 * Keychain IDs whose tombstone writes failed in a previous persist cycle.
 * Retried at the start of the next `doPersist()` call so delete intent
 * survives across saves even when the settings subscriber advances `prev`.
 */
const pendingTombstones = new Set<string>();

/**
 * Whether `backfillAndHydrate` encountered any decryption failures.
 * When true, the migration modal's "clear now" button should be disabled
 * to prevent permanent loss of secrets that are only on disk.
 */
let backfillHadFailures = false;

/** Expose the snapshot for the migration modal's condition check. */
export function getRawDataSnapshot(): Record<string, unknown> {
  return rawDataSnapshot;
}

/** Refresh the snapshot (called after saveData succeeds, or by forgetAllSecrets). */
export function refreshRawDataSnapshot(data: CopilotSettings): void {
  rawDataSnapshot = structuredClone(data as unknown) as Record<string, unknown>;
}

/**
 * Skip the next `persistSettings()` call.
 *
 * Must be called immediately before `setSettings()` in dedicated transactions
 * (forgetAllSecrets, migration modal "clear now") that have already written
 * data.json themselves.
 */
export function suppressNextPersistOnce(): void {
  suppressNextPersist = true;
}

/** Whether backfill had any decryption failures (some secrets may only exist on disk). */
export function getBackfillHadFailures(): boolean {
  return backfillHadFailures;
}

/**
 * Check whether the migration modal should be shown.
 *
 * All conditions must be true:
 * - Keychain is available
 * - data.json still has non-empty sensitive fields
 * - User hasn't already cleared (_diskSecretsCleared !== true)
 * - User hasn't already dismissed the modal (_migrationModalDismissedAt not set)
 */
export function shouldShowMigrationModal(settings: CopilotSettings): boolean {
  const keychain = KeychainService.getInstance();
  if (!keychain.isAvailable()) return false;
  const rec = settings as unknown as Record<string, unknown>;
  if (rec._diskSecretsCleared === true) return false;
  if (typeof rec._migrationModalDismissedAt === "string") return false;
  return hasPersistedSecrets(rawDataSnapshot);
}

/**
 * Whether the "Clear Old Copies" action should be available.
 *
 * Combines all safety conditions:
 * - Keychain must be available (secrets are safe there)
 * - No backfill failures (some secrets may only exist on disk)
 * - Disk secrets not already cleared
 * - data.json still has non-empty sensitive fields
 */
export function canClearDiskSecrets(settings: CopilotSettings): boolean {
  const keychain = KeychainService.getInstance();
  if (!keychain.isAvailable()) return false;
  if (backfillHadFailures) return false;
  const rec = settings as unknown as Record<string, unknown>;
  if (rec._diskSecretsCleared === true) return false;
  return hasPersistedSecrets(rawDataSnapshot);
}

/**
 * Strip secrets from data.json while keeping keychain and memory intact.
 *
 * This is the non-destructive "clear old copies" action — secrets remain
 * accessible via the OS Keychain, only the data.json fallback is removed.
 *
 * Runs as a dedicated persistence transaction to prevent interleaving
 * with normal saves that could restore old secrets.
 */
export async function clearDiskSecrets(
  saveData: (data: CopilotSettings) => Promise<void>
): Promise<void> {
  await runPersistenceTransaction(async () => {
    const current = getSettings();
    const stripped = stripKeychainFields(current);
    const toSave = cleanupLegacyFields({
      ...stripped,
      _diskSecretsCleared: true,
    } as CopilotSettings);

    await saveData(toSave);
    refreshRawDataSnapshot(toSave);

    // Reason: only set the flag in memory, preserve live secrets so
    // LLM providers continue to work until plugin reload.
    suppressNextPersistOnce();
    setSettings({ ...current, _diskSecretsCleared: true } as CopilotSettings);
  });
}

// ---------------------------------------------------------------------------
// Persistence transaction support
// ---------------------------------------------------------------------------

/**
 * Run a dedicated persistence transaction within the write queue.
 *
 * Reason: operations like `forgetAllSecrets` and the migration modal "clear now"
 * write data.json directly (not through `doPersist`). They must still be serialized
 * with the normal save path to prevent interleaving that could restore old secrets.
 */
export async function runPersistenceTransaction(task: () => Promise<void>): Promise<void> {
  const job = writeQueue.then(task);
  writeQueue = job.catch(() => {
    /* swallow to unblock next write */
  });
  return job;
}

// ---------------------------------------------------------------------------
// Unified save path
// ---------------------------------------------------------------------------

/**
 * Unified save path for all settings persistence.
 *
 * When keychain is available:
 * 1. Write secrets to keychain FIRST
 * 2. If _diskSecretsCleared → strip secrets from data.json
 *    Else → keep secrets in data.json (transition period for older devices)
 *
 * When keychain is NOT available:
 * - Save plaintext to data.json (fallback)
 */
export async function persistSettings(
  settings: CopilotSettings,
  saveData: (data: CopilotSettings) => Promise<void>,
  prevSettings?: CopilotSettings
): Promise<void> {
  // Reason: dedicated transactions (forgetAllSecrets, modal "clear now") set
  // this flag before calling setSettings(). The subscriber-triggered persist
  // must be skipped to avoid overwriting the transaction's output.
  if (suppressNextPersist) {
    suppressNextPersist = false;
    return;
  }

  const job = writeQueue.then(() => doPersist(settings, saveData, prevSettings));
  writeQueue = job.catch(() => {
    /* swallow to unblock next write */
  });
  return job;
}

/**
 * Unified load path for settings with keychain integration.
 *
 * Flow:
 * 1. Sanitize raw data
 * 2. Cache rawDataSnapshot for transition-period saves
 * 3. Clean up legacy fields (enableEncryption, _keychainMigrated)
 * 4. If keychain available → backfillAndHydrate
 * 5. Return hydrated settings
 */
export async function loadSettingsWithKeychain(
  rawData: unknown,
  saveData: (data: CopilotSettings) => Promise<void>
): Promise<CopilotSettings> {
  // Reason: sanitize FIRST to normalize model providers (e.g. azure_openai → azure-openai).
  let settings = sanitizeSettings(rawData as CopilotSettings);

  // Cache the raw disk state BEFORE any in-memory mutations.
  rawDataSnapshot = structuredClone(rawData ?? {}) as unknown as Record<string, unknown>;

  // Remove legacy fields that are no longer used
  settings = cleanupLegacyFields(settings);

  const keychain = KeychainService.getInstance();
  if (!keychain.isAvailable()) {
    console.log("Settings load: keychain unavailable, using data.json values as-is.");
    return settings;
  }

  // Reason: use persisted vault ID if available, otherwise the constructor's
  // path-derived fallback is already set. Persist the ID on first run so
  // vault renames don't orphan keychain entries.
  const rawRec = rawDataSnapshot as Record<string, unknown>;
  if (typeof rawRec._keychainVaultId === "string" && rawRec._keychainVaultId) {
    keychain.setVaultId(rawRec._keychainVaultId);
  } else {
    // First run — persist the generated vaultId immediately to disk.
    // Reason: main.ts calls setSettings() before the subscriber is registered,
    // so the initial setSettings won't trigger persistSettings. We must write
    // the vaultId to data.json here to survive a vault rename before the next save.
    const vaultId = keychain.getVaultId();
    settings = { ...settings, _keychainVaultId: vaultId } as CopilotSettings;
    try {
      const currentDisk = { ...rawDataSnapshot, _keychainVaultId: vaultId };
      await saveData(currentDisk as unknown as CopilotSettings);
      rawDataSnapshot = currentDisk;
    } catch {
      console.warn("Failed to persist _keychainVaultId on first run — will retry on next save.");
    }
  }

  // Reason: detect whether this is a truly fresh install (no secrets AND no
  // migration/transition markers). Used below to set keychain-only mode.
  const diskHadSecrets = hasPersistedSecrets(rawDataSnapshot);
  // Reason: transition markers (_keychainMigratedAt, _migrationModalDismissedAt)
  // indicate the user was previously in a migration flow. An existing user who
  // manually cleared all keys should NOT be silently upgraded to keychain-only,
  // because they may re-enter keys expecting data.json sync to continue.
  const hadTransitionState =
    typeof rawRec._keychainMigratedAt === "string" ||
    typeof rawRec._migrationModalDismissedAt === "string";

  const {
    settings: hydrated,
    backfilledAny,
    hadFailures,
  } = await keychain.backfillAndHydrate(settings);
  backfillHadFailures = hadFailures;

  const rec = hydrated as unknown as Record<string, unknown>;

  // Reason: fresh installs (no disk secrets + no transition markers) should go
  // straight to keychain-only mode. Without this, new users' first save falls
  // into the transition path and writes plaintext API keys to data.json.
  // Existing users who cleared keys but have transition markers keep their
  // original storage policy.
  if (!diskHadSecrets && !hadTransitionState && rec._diskSecretsCleared !== true) {
    rec._diskSecretsCleared = true;
  }

  // Record migration timestamp on first successful backfill
  if (backfilledAny && typeof rec._keychainMigratedAt !== "string") {
    rec._keychainMigratedAt = new Date().toISOString();
    try {
      // Reason: also carry _keychainVaultId forward in case the earlier vaultId
      // write failed — otherwise this successful save would persist the migration
      // timestamp but still omit the vault namespace ID.
      const diskUpdate = {
        ...rawDataSnapshot,
        _keychainMigratedAt: rec._keychainMigratedAt,
        _keychainVaultId: keychain.getVaultId(),
      };
      await saveData(diskUpdate as unknown as CopilotSettings);
      rawDataSnapshot = diskUpdate;
    } catch {
      console.warn("Failed to persist _keychainMigratedAt — will retry on next save.");
    }
  }

  // Reason: 7-day auto-clear — if migration happened more than 7 days ago and
  // disk secrets haven't been cleared yet, silently strip them now.
  if (
    typeof rec._keychainMigratedAt === "string" &&
    rec._diskSecretsCleared !== true &&
    !hadFailures
  ) {
    const migratedAt = new Date(rec._keychainMigratedAt as string).getTime();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    if (Date.now() - migratedAt > sevenDaysMs) {
      try {
        const stripped = stripKeychainFields(hydrated as CopilotSettings);
        const toSave = cleanupLegacyFields({
          ...stripped,
          _diskSecretsCleared: true,
        } as CopilotSettings);
        await saveData(toSave);
        rawDataSnapshot = structuredClone(toSave as unknown) as Record<string, unknown>;
        rec._diskSecretsCleared = true;
        console.log("Auto-cleared old API key copies from data.json (7-day deadline reached).");
      } catch {
        console.warn("Auto-clear of data.json secrets failed — will retry on next startup.");
      }
    }
  }

  // Reason: seed lastPersistedSettings so the first doPersist() call has a
  // valid baseline. Without this, the fallback to subscriber `prev` makes the
  // first failed save vulnerable to the stale-snapshot restoration bug.
  lastPersistedSettings = structuredClone(hydrated) as CopilotSettings;

  return hydrated as CopilotSettings;
}

/**
 * Wait for all queued persistence operations to complete.
 */
export async function flushPersistence(): Promise<void> {
  await writeQueue;
}

// ---------------------------------------------------------------------------
// Internal persistence logic
// ---------------------------------------------------------------------------

/** Core persistence logic, called within the write queue. */
async function doPersist(
  settings: CopilotSettings,
  saveData: (data: CopilotSettings) => Promise<void>,
  prevSettings?: CopilotSettings
): Promise<void> {
  const keychain = KeychainService.getInstance();

  // Clean legacy fields from the output
  const cleaned = cleanupLegacyFields(settings);
  const diskSecretsCleared =
    (settings as unknown as Record<string, unknown>)._diskSecretsCleared === true;

  if (!keychain.isAvailable()) {
    // Fallback: save plaintext to data.json.
    // Reason: if secrets are being written back to disk (e.g., user entered keys
    // on a device without keychain), reset _diskSecretsCleared so that desktop
    // re-shows the migration prompt and 7-day auto-clear can re-trigger.
    const cleanedRec = cleaned as unknown as Record<string, unknown>;
    if (cleanedRec._diskSecretsCleared === true && hasPersistedSecrets(cleanedRec)) {
      cleanedRec._diskSecretsCleared = false;
      delete cleanedRec._migrationModalDismissedAt;
      // Reason: also sync in-memory state so generateSetupUri() and other
      // consumers see the corrected flag without requiring a restart.
      const settingsRec = settings as unknown as Record<string, unknown>;
      settingsRec._diskSecretsCleared = false;
      delete settingsRec._migrationModalDismissedAt;
    }
    await saveData(cleaned);
    rawDataSnapshot = structuredClone(cleaned as unknown) as Record<string, unknown>;
    return;
  }

  // Retry any tombstones that failed in a previous cycle.
  // Reason: the settings subscriber advances `prev` immediately, so a later
  // save may no longer compute the deleted model in keychainIdsToDelete.
  // Retrying here ensures delete intent survives across saves.
  for (const id of [...pendingTombstones]) {
    keychain.setSecretById(id, "");
    pendingTombstones.delete(id);
  }

  // Step 1: Write secrets to keychain FIRST
  const { secretEntries, keychainIdsToDelete } = keychain.persistSecrets(settings, prevSettings);

  // Reason: track whether any encrypted-looking value could not be decrypted
  // for keychain write. When `_diskSecretsCleared` is true the save path will
  // strip secrets from data.json — if a value was skipped here, stripping
  // would cause permanent secret loss. The flag triggers a fail-closed guard.
  let skippedUndecryptableSecret = false;

  for (const [id, value] of secretEntries) {
    // Reason: after a keychain reset, memory may hold encrypted data.json values.
    // Writing ciphertext to keychain would poison it. Decrypt first.
    let plaintext = value;
    if (isEncryptedValue(value)) {
      plaintext = await getDecryptedKey(value);
      if (!plaintext) {
        // Reason: skip this entry instead of aborting the entire save. One
        // undecryptable legacy secret should not block all settings persistence.
        // The disk fallback preserves the original value for this field.
        logWarn(`Skipping keychain write for "${id}": failed to decrypt legacy value.`);
        skippedUndecryptableSecret = true;
        continue;
      }
    }
    // Reason: let live secret write failures propagate and abort the save.
    // If the keychain write fails, the secret must NOT be stripped from
    // data.json — aborting ensures the disk fallback is preserved and the
    // user gets an error notice to retry.
    keychain.setSecretById(id, plaintext);
  }

  // Write tombstones for deleted entries.
  // Reason: fail closed — if any tombstone write fails, track the ID for retry
  // in a future save cycle, then abort this persist. Aborting ensures the caller's
  // error notice path fires. The pendingTombstones set preserves delete intent
  // across saves even though the subscriber advances `prev` immediately.
  for (const id of keychainIdsToDelete) {
    try {
      keychain.setSecretById(id, "");
    } catch (e) {
      pendingTombstones.add(id);
      throw e;
    }
  }

  // Reason: if any encrypted-looking value could not be written to keychain,
  // refuse to strip secrets from data.json. Stripping would permanently lose
  // those values because the keychain has no copy either. Also reset
  // _diskSecretsCleared to false so the state on disk is consistent and the
  // migration modal can be re-shown to let the user retry.
  if (diskSecretsCleared && skippedUndecryptableSecret) {
    logWarn(
      "Skipping secret stripping from data.json: at least one encrypted value " +
        "could not be decrypted for keychain write. Disk copy preserved as fallback."
    );
    (cleaned as unknown as Record<string, unknown>)._diskSecretsCleared = false;
    delete (cleaned as unknown as Record<string, unknown>)._migrationModalDismissedAt;
    // Reason: also sync in-memory state so shouldShowMigrationModal() and
    // canClearDiskSecrets() see the corrected flags without requiring a restart.
    const settingsRec = settings as unknown as Record<string, unknown>;
    settingsRec._diskSecretsCleared = false;
    delete settingsRec._migrationModalDismissedAt;
  }

  // Step 2: Write data.json
  let dataToSave: CopilotSettings;
  if (diskSecretsCleared && !skippedUndecryptableSecret) {
    // User confirmed all devices upgraded — strip secrets from data.json
    dataToSave = stripKeychainFields(cleaned);
    (dataToSave as unknown as Record<string, unknown>)._diskSecretsCleared = true;
  } else {
    // Transition period — preserve the original on-disk serialization for
    // secret fields that the user hasn't changed, so previously encrypted
    // `enc_*` values are not downgraded to plaintext. For secrets that were
    // actually changed (rotated, imported, etc.), write the new plaintext
    // value so it propagates to synced devices.
    dataToSave = { ...cleaned };
    // Reason: shallow spread shares model array references with the caller's
    // live settings. Clone model arrays so preserveUnchangedDiskSecrets can
    // safely mutate model objects without polluting in-memory state.
    if (dataToSave.activeModels) {
      dataToSave.activeModels = dataToSave.activeModels.map((m) => ({ ...m }));
    }
    if (dataToSave.activeEmbeddingModels) {
      dataToSave.activeEmbeddingModels = dataToSave.activeEmbeddingModels.map((m) => ({ ...m }));
    }
    // Reason: use lastPersistedSettings (not the subscriber's prev) so the
    // comparison reflects what was actually written to disk. If a previous
    // saveData() failed, the subscriber's prev would have advanced past the
    // true disk state, causing stale snapshot values to be restored.
    preserveUnchangedDiskSecrets(dataToSave, lastPersistedSettings ?? prevSettings, rawDataSnapshot);
  }

  await saveData(dataToSave);
  rawDataSnapshot = structuredClone(dataToSave as unknown) as Record<string, unknown>;
  lastPersistedSettings = structuredClone(settings);
}

// ---------------------------------------------------------------------------
// Transition-period disk serialization helper
// ---------------------------------------------------------------------------

import { MODEL_SECRET_FIELDS } from "@/services/settingsSecretTransforms";

/**
 * Preserve the original on-disk serialization for secret fields that haven't
 * changed, so previously encrypted `enc_*` values are not downgraded to
 * plaintext during the transition window. Changed secrets (rotated, imported)
 * are written in their new plaintext form so they propagate to synced devices.
 */
/** @internal Exported for unit testing only. */
export function preserveUnchangedDiskSecrets(
  dataToSave: CopilotSettings,
  prevSettings: CopilotSettings | undefined,
  snapshot: Record<string, unknown>
): void {
  const dataRec = dataToSave as unknown as Record<string, unknown>;
  const prevRec = (prevSettings ?? {}) as unknown as Record<string, unknown>;

  // Top-level secret fields
  for (const key of Object.keys(dataRec)) {
    if (!isSecretKey(key)) continue;
    if (dataRec[key] === prevRec[key]) {
      const diskValue = snapshot[key];
      if (typeof diskValue === "string" && diskValue.length > 0) {
        dataRec[key] = diskValue;
      }
    }
  }

  // Model-level secret fields (activeModels, activeEmbeddingModels)
  for (const arrayKey of ["activeModels", "activeEmbeddingModels"] as const) {
    const models = dataToSave[arrayKey];
    if (!Array.isArray(models)) continue;
    const prevModels = prevSettings?.[arrayKey];
    const snapModels = snapshot[arrayKey] as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(prevModels) || !Array.isArray(snapModels)) continue;

    // Index previous and snapshot models by identity for O(1) lookup
    const prevMap = new Map(prevModels.map((m) => [getModelKeyFromModel(m), m]));
    // Reason: snapshot models are raw JSON objects, not typed CustomModel.
    // Construct the same "name|provider" identity key that getModelKeyFromModel uses.
    const snapMap = new Map(
      snapModels.map((m) => [
        `${String(m.name ?? "")}|${normalizeModelProvider(String(m.provider ?? ""))}`,
        m,
      ])
    );

    for (const model of models) {
      const identity = getModelKeyFromModel(model);
      const prevModel = prevMap.get(identity);
      const snapModel = snapMap.get(identity);
      if (!prevModel || !snapModel) continue;

      for (const field of MODEL_SECRET_FIELDS) {
        if (model[field] === prevModel[field]) {
          const diskValue = snapModel[field];
          if (typeof diskValue === "string" && diskValue.length > 0) {
            (model as unknown as Record<string, unknown>)[field] = diskValue;
          }
        }
      }
    }
  }
}
