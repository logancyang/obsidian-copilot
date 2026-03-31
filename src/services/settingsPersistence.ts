/**
 * Unified settings persistence layer.
 *
 * Handles loading (with keychain backfill) and saving (with disk-secret
 * management based on _diskSecretsCleared flag).
 */

import {
  type CopilotSettings,
  getSettings,
  sanitizeSettings,
  setSettings,
} from "@/settings/model";
import { isEncryptedValue, getDecryptedKey } from "@/encryptionService";
import { KeychainService, isSecretKey } from "@/services/keychainService";
import {
  cleanupLegacyFields,
  hasPersistedSecrets,
  MODEL_SECRET_FIELDS,
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
 * Whether the last successful disk state still contains any persisted secrets.
 *
 * Reason: `shouldShowMigrationModal()` and `canClearDiskSecrets()` are sync
 * checks used in UI render code. Caching the derived boolean avoids re-reading
 * data.json on every render while still tracking disk state accurately.
 */
let diskHasSecrets = false;

/**
 * Settings snapshot from the last successful `saveData()` call.
 *
 * Reason: the settings subscriber advances `prev` immediately, even before
 * the async persist completes. This field tracks what was truly last
 * persisted so keychain rollback uses the correct baseline.
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

/** Keychain vault IDs are 8 lowercase hex chars. */
const KEYCHAIN_VAULT_ID_RE = /^[a-f0-9]{8}$/;

/** Check whether a persisted keychain vault ID has the expected format. */
function isValidKeychainVaultId(value: unknown): value is string {
  return typeof value === "string" && KEYCHAIN_VAULT_ID_RE.test(value);
}

/** ISO 8601 date pattern — must have at least YYYY-MM-DD to be meaningful. */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}/;

/** Check whether a persisted migration timestamp is a valid ISO date string. */
function isValidKeychainMigratedAt(value: unknown): value is string {
  return typeof value === "string" && ISO_DATE_RE.test(value) && Number.isFinite(Date.parse(value));
}

/**
 * Whether the most recent keychain persist attempt left it unsafe to clear
 * disk secrets.
 *
 * Reason: fail-closed for the whole keychain save cycle. Set to `true`
 * before any keychain writes begin, then narrowed to the actual skip state
 * only after a fully successful `saveData()`. Any throw in between leaves
 * the flag `true`, blocking `canClearDiskSecrets()` and `clearDiskSecrets()`.
 */
let persistHadUndecryptableSecrets = false;

/** Refresh the cached disk-secret presence after a successful save/load. */
export function refreshDiskHasSecrets(data: CopilotSettings): void {
  diskHasSecrets = hasPersistedSecrets(data as unknown as Record<string, unknown>);
}

/**
 * Refresh the last known-good logical settings baseline used by keychain rollback.
 *
 * Reason: dedicated transactions (forgetAllSecrets, clearDiskSecrets, migration
 * modal dismiss) write data.json directly and bypass doPersist(). Without
 * updating this baseline, a later failed normal save would roll back the
 * keychain to the pre-transaction state — potentially resurrecting deleted secrets.
 */
export function refreshLastPersistedSettings(data: CopilotSettings): void {
  lastPersistedSettings = structuredClone(data);
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
 * - User hasn't already dismissed the modal (_migrationModalDismissed !== true)
 */
export function shouldShowMigrationModal(settings: CopilotSettings): boolean {
  const keychain = KeychainService.getInstance();
  if (!keychain.isAvailable()) return false;
  const rec = settings as unknown as Record<string, unknown>;
  if (rec._diskSecretsCleared === true) return false;
  if (rec._migrationModalDismissed === true) return false;
  return diskHasSecrets;
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
  if (persistHadUndecryptableSecrets) return false;
  const rec = settings as unknown as Record<string, unknown>;
  if (rec._diskSecretsCleared === true) return false;
  return diskHasSecrets;
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
    // Reason: fail-closed guard — if the last keychain persist attempt did
    // not complete safely, the keychain may be missing a secret.
    if (persistHadUndecryptableSecrets) {
      throw new Error(
        "Cannot clear disk secrets: the last keychain save did not complete safely. " +
          "Retry saving settings before clearing disk secrets."
      );
    }
    const current = getSettings();
    const stripped = stripKeychainFields(current);
    const toSave = cleanupLegacyFields({
      ...stripped,
      _diskSecretsCleared: true,
    } as CopilotSettings);

    await saveData(toSave);
    refreshDiskHasSecrets(toSave);
    const nextSettings = { ...current, _diskSecretsCleared: true } as CopilotSettings;
    refreshLastPersistedSettings(nextSettings);

    // Reason: only set the flag in memory, preserve live secrets so
    // LLM providers continue to work until plugin reload.
    suppressNextPersistOnce();
    setSettings(nextSettings);
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
 *    Else → keep secrets in data.json (migration window for older devices)
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
 * 2. Cache whether raw disk data still contains secrets
 * 3. Clean up legacy fields (enableEncryption, _keychainMigrated)
 * 4. If keychain available → backfillAndHydrate
 * 5. Return hydrated settings
 */
/**
 * Decrypt any `enc_*` encrypted values in settings for runtime use.
 *
 * Reason: when keychain is unavailable, disk values may contain legacy
 * encrypted strings. Without decryption these would be sent as ciphertext
 * to LLM providers. Falls back to the original value if decryption fails.
 */
async function hydrateSecretsFromDisk(settings: CopilotSettings): Promise<CopilotSettings> {
  const hydrated = structuredClone(settings) as CopilotSettings;
  const rec = hydrated as unknown as Record<string, unknown>;

  for (const key of Object.keys(rec)) {
    if (!isSecretKey(key)) continue;
    const value = rec[key];
    if (typeof value !== "string" || value.length === 0) continue;
    const plaintext = await getDecryptedKey(value);
    if (plaintext) rec[key] = plaintext;
  }

  for (const listKey of ["activeModels", "activeEmbeddingModels"] as const) {
    const models = hydrated[listKey] ?? [];
    for (const model of models) {
      const modelRec = model as unknown as Record<string, unknown>;
      for (const field of MODEL_SECRET_FIELDS) {
        const value = modelRec[field];
        if (typeof value !== "string" || value.length === 0) continue;
        const plaintext = await getDecryptedKey(value);
        if (plaintext) modelRec[field] = plaintext;
      }
    }
  }

  return hydrated;
}

export async function loadSettingsWithKeychain(
  rawData: unknown,
  saveData: (data: CopilotSettings) => Promise<void>
): Promise<CopilotSettings> {
  // Reason: sanitize FIRST to normalize model providers (e.g. azure_openai → azure-openai).
  let settings = sanitizeSettings(rawData as CopilotSettings);

  // Reason: capture raw disk state as a local variable for load-time patching.
  // Only the derived boolean is stored at module level for UI sync checks.
  let rawDiskData = structuredClone(rawData ?? {}) as Record<string, unknown>;
  diskHasSecrets = hasPersistedSecrets(rawDiskData);

  // Remove legacy fields that are no longer used
  settings = cleanupLegacyFields(settings);

  const keychain = KeychainService.getInstance();
  if (!keychain.isAvailable()) {
    console.log("Settings load: keychain unavailable, decrypting disk values for runtime.");
    return await hydrateSecretsFromDisk(settings);
  }

  // Reason: use persisted vault ID if available, otherwise the constructor's
  // path-derived fallback is already set. Persist the ID on first run so
  // vault renames don't orphan keychain entries.
  // Reason: validate format to prevent malformed IDs from producing invalid
  // SecretStorage keys (overlength or colliding).
  const rawRec = rawDiskData;
  if (isValidKeychainVaultId(rawRec._keychainVaultId)) {
    keychain.setVaultId(rawRec._keychainVaultId as string);
  } else {
    // First run — persist the generated vaultId immediately to disk.
    // Reason: main.ts calls setSettings() before the subscriber is registered,
    // so the initial setSettings won't trigger persistSettings. We must write
    // the vaultId to data.json here to survive a vault rename before the next save.
    const vaultId = keychain.getVaultId();
    settings = { ...settings, _keychainVaultId: vaultId } as CopilotSettings;
    try {
      const currentDisk = { ...rawDiskData, _keychainVaultId: vaultId };
      await saveData(currentDisk as unknown as CopilotSettings);
      rawDiskData = currentDisk;
      diskHasSecrets = hasPersistedSecrets(rawDiskData);
    } catch {
      console.warn("Failed to persist _keychainVaultId on first run — will retry on next save.");
    }
  }

  // Reason: detect whether this is a truly fresh install (no secrets AND no
  // migration/transition markers). Used below to set keychain-only mode.
  const diskHadSecrets = hasPersistedSecrets(rawDiskData);
  // Reason: transition markers (_keychainMigratedAt, _migrationModalDismissed)
  // indicate the user was previously in a migration flow. An existing user who
  // manually cleared all keys should NOT be silently upgraded to keychain-only,
  // because they may re-enter keys expecting data.json sync to continue.
  // Reason: discard unparseable _keychainMigratedAt so the 7-day auto-clear
  // timer is not permanently disabled by a corrupted/malformed timestamp.
  const settingsRec = settings as unknown as Record<string, unknown>;
  if (!isValidKeychainMigratedAt(rawRec._keychainMigratedAt)) {
    delete rawRec._keychainMigratedAt;
    delete settingsRec._keychainMigratedAt;
  }
  const hadTransitionState =
    typeof rawRec._keychainMigratedAt === "string" ||
    settingsRec._migrationModalDismissed === true;

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
        ...rawDiskData,
        _keychainMigratedAt: rec._keychainMigratedAt,
        _keychainVaultId: keychain.getVaultId(),
      };
      await saveData(diskUpdate as unknown as CopilotSettings);
      rawDiskData = diskUpdate;
      diskHasSecrets = hasPersistedSecrets(rawDiskData);
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
        diskHasSecrets = hasPersistedSecrets(toSave as unknown as Record<string, unknown>);
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

/**
 * Best-effort restore of keychain contents after a failed persist.
 *
 * Reason: if `saveData()` or a keychain write throws after some secrets were
 * already written, the keychain is left in a partial state. This attempts to
 * write the previous settings' secrets back so the keychain approximates the
 * last known-good disk state. Not transactional — individual restore writes
 * may also fail, in which case a warning is logged but remaining entries are
 * still attempted.
 */
async function restoreKeychainFromSettings(
  keychain: KeychainService,
  restoreFrom: CopilotSettings | undefined,
  failedSettings: CopilotSettings
): Promise<void> {
  if (!restoreFrom) return;

  const { secretEntries, keychainIdsToDelete } = keychain.persistSecrets(
    restoreFrom,
    failedSettings
  );

  for (const [id, value] of secretEntries) {
    try {
      let plaintext = value;
      if (isEncryptedValue(value)) {
        plaintext = await getDecryptedKey(value);
        if (!plaintext) continue;
      }
      keychain.setSecretById(id, plaintext);
    } catch (error) {
      logWarn(`Failed to restore keychain entry "${id}" during rollback.`, error);
    }
  }

  for (const id of keychainIdsToDelete) {
    try {
      keychain.setSecretById(id, "");
      pendingTombstones.delete(id);
    } catch (error) {
      logWarn(`Failed to restore keychain tombstone "${id}" during rollback.`, error);
    }
  }
}

/**
 * Reset disk-secret fallback flags via the proper state channel.
 *
 * Reason: `doPersist()` receives the live Jotai store object from the settings
 * subscriber. Mutating it in place bypasses Jotai notifications, leaving UI
 * consumers (useSettingsValue) stale. Route through `setSettings()` instead.
 */
function resetDiskSecretFallbackFlags(settings: CopilotSettings): void {
  if (settings === getSettings()) {
    suppressNextPersistOnce();
    setSettings({
      _diskSecretsCleared: false,
      _migrationModalDismissed: undefined,
    });
    return;
  }
  // Detached snapshot (e.g. import path) — safe to mutate directly.
  const rec = settings as unknown as Record<string, unknown>;
  rec._diskSecretsCleared = false;
  delete rec._migrationModalDismissed;
}

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
      delete cleanedRec._migrationModalDismissed;
      // Reason: sync in-memory state through proper Jotai channel so
      // generateSetupUri() and other consumers see the corrected flags.
      resetDiskSecretFallbackFlags(settings);
    }
    await saveData(cleaned);
    refreshDiskHasSecrets(cleaned);
    return;
  }

  // Reason: fail-closed for the entire keychain save cycle. Any throw before
  // the flag is narrowed at the end of doPersist() means the keychain may be
  // missing at least one secret, so clearing the disk fallback must be blocked.
  persistHadUndecryptableSecrets = true;

  // Step 1: Write secrets to keychain FIRST
  // Reason: use lastPersistedSettings (the last known-good baseline) as the diff
  // base, falling back to prevSettings only on the first save. Without this,
  // a failed save followed by a successful retry can miss tombstones for deleted
  // secrets because the subscriber already advanced prevSettings past the deletion.
  const keychainDiffBase = lastPersistedSettings ?? prevSettings;
  const { secretEntries, keychainIdsToDelete } = keychain.persistSecrets(settings, keychainDiffBase);
  // Reason: capture the rollback baseline BEFORE any keychain mutations so that
  // if saveData() or a later keychain write fails, we can restore the keychain
  // to its previous known-good state.
  const rollbackSettings = lastPersistedSettings ?? prevSettings;

  // Reason: track whether any encrypted-looking value could not be decrypted
  // for keychain write. When `_diskSecretsCleared` is true the save path will
  // strip secrets from data.json — if a value was skipped here, stripping
  // would cause permanent secret loss.
  let skippedUndecryptableSecret = false;

  // Reason: track which pending tombstones were successfully replayed so we
  // can remove them from the retry set ONLY after the full persist succeeds.
  // Removing them eagerly (before the try block) would lose delete intent
  // if a later step fails.
  const replayedTombstones: string[] = [];

  try {
    // Retry any tombstones that failed in a previous cycle.
    // Reason: the settings subscriber advances `prev` immediately, so a later
    // save may no longer compute the deleted model in keychainIdsToDelete.
    // Retrying here ensures delete intent survives across saves.
    for (const id of pendingTombstones) {
      keychain.setSecretById(id, "");
      replayedTombstones.push(id);
    }
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
      delete (cleaned as unknown as Record<string, unknown>)._migrationModalDismissed;
      // Reason: sync in-memory state through proper Jotai channel so
      // shouldShowMigrationModal() and canClearDiskSecrets() see corrected flags.
      resetDiskSecretFallbackFlags(settings);
    }

    // Step 2: Write data.json
    let dataToSave: CopilotSettings;
    if (diskSecretsCleared && !skippedUndecryptableSecret) {
      // User confirmed all devices upgraded — strip secrets from data.json
      dataToSave = stripKeychainFields(cleaned);
      (dataToSave as unknown as Record<string, unknown>)._diskSecretsCleared = true;
    } else {
      // Reason: migration window — keep current secret values in data.json
      // so other devices can still backfill from synced data.json.
      dataToSave = { ...cleaned };
    }

    await saveData(dataToSave);
    refreshDiskHasSecrets(dataToSave);
    lastPersistedSettings = structuredClone(settings);

    // Reason: only clear replayed tombstones AFTER the full persist cycle succeeds.
    // If any earlier step threw, the catch block preserves delete intent for retry.
    for (const id of replayedTombstones) {
      pendingTombstones.delete(id);
    }
  } catch (error) {
    // Reason: roll back partial keychain writes so the keychain matches the
    // last known-good state. Without this, a failed import/save would leave
    // stale imported secrets that revive on next startup via hydration.
    try {
      await restoreKeychainFromSettings(keychain, rollbackSettings, settings);
    } catch (rollbackError) {
      logWarn("Failed to roll back keychain after persist failure.", rollbackError);
    }
    throw error;
  }

  // Reason: the full cycle completed successfully — narrow the fail-closed
  // guard to only block if a secret was actually skipped as undecryptable.
  // Any earlier throw already left the flag `true`, blocking disk clearing.
  persistHadUndecryptableSecrets = skippedUndecryptableSecret;

  // Reason: if the persist cycle succeeded without skipping any undecryptable
  // secrets, any earlier backfill failures are now resolved (user re-entered
  // keys, or encrypted values were successfully written to keychain). Clear
  // the flag so the "Remove from data.json" button becomes available.
  if (!skippedUndecryptableSecret) {
    backfillHadFailures = false;
  }
}

