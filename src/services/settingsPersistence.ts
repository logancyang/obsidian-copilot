/**
 * Keychain-only settings persistence.
 *
 * Runtime settings are hydrated from Obsidian Keychain. Persisted settings
 * retain only non-secret values and the stable vault namespace used to locate
 * Keychain entries. Values already present in data.json are discarded without
 * being decrypted or imported, but never before they have been copied out
 * (see `legacyCredentialBackup`).
 */

import { DEFAULT_SETTINGS } from "@/constants";
import { logWarn } from "@/logger";
import { KeychainService } from "@/services/keychainService";
import { type LegacyBackupResult } from "@/services/legacyCredentialBackup";
import { cleanupLegacyFields, stripKeychainFields } from "@/services/settingsSecretTransforms";
import { CURRENT_SETTINGS_VERSION } from "@/settings/migrations/version";
import { type CopilotSettings, sanitizeSettings } from "@/settings/model";
import { Notice } from "obsidian";

let writeQueue: Promise<void> = Promise.resolve();
let lastPersistedSettings: CopilotSettings | undefined;
let suppressNextPersist = false;
let transactionEpoch = 0;
const pendingTombstones = new Set<string>();

/** Keychain vault IDs are 8 lowercase hex chars. */
const KEYCHAIN_VAULT_ID_RE = /^[a-f0-9]{8}$/;

/** Check whether a persisted keychain vault ID has the expected format. */
function isValidKeychainVaultId(value: unknown): value is string {
  return typeof value === "string" && KEYCHAIN_VAULT_ID_RE.test(value);
}

/** Return a detached record for raw persistence transforms. */
function cloneRawSettings(rawData: unknown): CopilotSettings {
  if (!rawData || typeof rawData !== "object" || Array.isArray(rawData)) {
    return {} as CopilotSettings;
  }
  return structuredClone(rawData) as CopilotSettings;
}

/** Build the canonical data.json shape without importing any disk secret. */
function buildDiskSettings(
  rawData: unknown,
  vaultId: string,
  isFreshInstall: boolean
): CopilotSettings {
  const stripped = stripKeychainFields(cleanupLegacyFields(cloneRawSettings(rawData)));
  stripped._keychainVaultId = vaultId;
  if (isFreshInstall) {
    stripped.settingsVersion = CURRENT_SETTINGS_VERSION;
  }
  return stripped;
}

/** Reset all module-level persistence state between plugin lifecycles. */
export function resetPersistenceState(): void {
  writeQueue = Promise.resolve();
  lastPersistedSettings = undefined;
  suppressNextPersist = false;
  transactionEpoch = 0;
  pendingTombstones.clear();
}

/** Refresh the last known-good settings baseline used by Keychain rollback. */
export function refreshLastPersistedSettings(data: CopilotSettings): void {
  lastPersistedSettings = structuredClone(data);
}

/** Skip the next subscriber-driven persistence call after a dedicated transaction. */
export function suppressNextPersistOnce(): void {
  suppressNextPersist = true;
}

/**
 * Run a dedicated persistence transaction inside the shared write queue.
 *
 * The epoch advances even when the task fails because it may have partially
 * mutated a durable store before throwing. Queued snapshots from before the
 * transaction therefore cannot overwrite its result.
 */
export async function runPersistenceTransaction(task: () => Promise<void>): Promise<void> {
  const job = writeQueue.then(async () => {
    try {
      await task();
    } finally {
      transactionEpoch++;
    }
  });
  writeQueue = job.catch(() => {
    /* Keep the queue usable after a failed write. */
  });
  return job;
}

/** Wait for all queued persistence operations to complete. */
export async function flushPersistence(): Promise<void> {
  await writeQueue;
}

/**
 * Load settings without trusting secrets from data.json.
 *
 * The raw disk copy is cleaned before any credential reaches runtime. Keychain
 * hydration starts from that stripped baseline, so missing or unavailable
 * Keychain entries remain empty instead of falling back to disk values.
 *
 * @param rawData - Untrusted data returned by Obsidian's loadData().
 * @param saveData - Plugin-bound writer used to remove disk secrets and persist the vault ID.
 * @param backupLegacyCredentials - Copies data.json before its credentials are
 *   stripped. Stripping is skipped unless this reports a copy exists, so a
 *   pre-v4 vault cannot lose the only record of its keys.
 */
export async function loadSettingsWithKeychain(
  rawData: unknown,
  saveData: (data: CopilotSettings) => Promise<void>,
  backupLegacyCredentials: (rawData: unknown) => Promise<LegacyBackupResult>
): Promise<CopilotSettings> {
  const isFreshInstall = rawData == null;
  const rawSettings = cloneRawSettings(rawData);
  const keychain = KeychainService.getInstance();
  const persistedVaultId = rawSettings._keychainVaultId;
  const vaultId = isValidKeychainVaultId(persistedVaultId)
    ? persistedVaultId
    : keychain.getVaultId();
  keychain.setVaultId(vaultId);

  const diskSettings = buildDiskSettings(rawData, vaultId, isFreshInstall);
  if (JSON.stringify(rawSettings) !== JSON.stringify(diskSettings)) {
    const backup = await backupLegacyCredentials(rawData);
    if (backup.status === "failed") {
      // Reason: data.json is still the only copy of these credentials, so it
      // must survive intact until a backup exists. Retried on the next load.
      new Notice(
        "Copilot could not back up the API keys stored in data.json, so it left the file untouched. Check that the vault is writable, then restart Obsidian."
      );
    } else {
      try {
        await saveData(diskSettings);
        if (backup.status === "backed-up") {
          new Notice(
            `Copilot moved credential storage to the Obsidian Keychain. Your previous keys were copied to ${backup.path} — re-enter them in Settings, then delete that file.`,
            15000
          );
        }
      } catch {
        new Notice(
          "Copilot could not remove API keys from data.json. Check that the vault is writable, then restart Obsidian."
        );
      }
    }
  }

  const runtimeSource = isFreshInstall ? structuredClone(DEFAULT_SETTINGS) : rawSettings;
  const sanitized = cleanupLegacyFields(sanitizeSettings(runtimeSource));
  const baseline = stripKeychainFields({ ...sanitized, _keychainVaultId: vaultId });

  if (!keychain.isAvailable()) {
    new Notice(
      "Obsidian Keychain is unavailable. Copilot cannot load or save API keys in this Obsidian build."
    );
    lastPersistedSettings = structuredClone(baseline);
    return baseline;
  }

  const { settings: hydrated, hadFailures } = await keychain.hydrateFromKeychain(baseline);
  if (hadFailures) {
    new Notice(
      "Some API keys could not be loaded from the Obsidian Keychain. Restart Obsidian if the issue persists."
    );
  }
  lastPersistedSettings = structuredClone(hydrated);
  return hydrated;
}

/**
 * Write secrets to Keychain and save a stripped data.json snapshot.
 * Partial Keychain writes are rolled back to the last known-good snapshot.
 */
async function persistKeychainSettings(
  settings: CopilotSettings,
  saveData: (data: CopilotSettings) => Promise<void>,
  prev: CopilotSettings | undefined
): Promise<void> {
  const keychain = KeychainService.getInstance();
  const cleaned = cleanupLegacyFields(settings);
  const keychainDiffBase = lastPersistedSettings ?? prev;
  const rollbackSettings = lastPersistedSettings ?? prev;
  const { secretEntries, keychainIdsToDelete } = keychain.persistSecrets(cleaned, keychainDiffBase);
  const replayedTombstones: string[] = [];

  try {
    for (const id of pendingTombstones) {
      keychain.setSecretById(id, "");
      replayedTombstones.push(id);
    }

    for (const [id, value] of secretEntries) {
      keychain.setSecretById(id, value);
    }

    for (const id of keychainIdsToDelete) {
      try {
        keychain.setSecretById(id, "");
      } catch (error) {
        pendingTombstones.add(id);
        throw error;
      }
    }

    await saveData(stripKeychainFields(cleaned));
    lastPersistedSettings = structuredClone(cleaned);
    for (const id of replayedTombstones) {
      pendingTombstones.delete(id);
    }
  } catch (error) {
    try {
      await restoreKeychainFromSettings(keychain, rollbackSettings, cleaned);
    } catch (rollbackError) {
      logWarn("Failed to roll back Keychain after settings persistence failed.", rollbackError);
    }
    throw error;
  }
}

/**
 * Persist from inside an existing persistence transaction without re-entering
 * the queue and deadlocking behind the transaction itself.
 */
export async function persistSettingsWithinTransaction(
  settings: CopilotSettings,
  saveData: (data: CopilotSettings) => Promise<void>,
  prevSettings?: CopilotSettings
): Promise<void> {
  await persistKeychainSettings(settings, saveData, prevSettings);
}

/** Queue and persist a complete settings snapshot through Keychain-only storage. */
export async function persistSettings(
  settings: CopilotSettings,
  saveData: (data: CopilotSettings) => Promise<void>,
  prevSettings?: CopilotSettings
): Promise<void> {
  if (suppressNextPersist) {
    suppressNextPersist = false;
    return;
  }

  const epochAtEnqueue = transactionEpoch;
  const job = writeQueue.then(() => {
    if (epochAtEnqueue !== transactionEpoch) return;
    return persistKeychainSettings(settings, saveData, prevSettings);
  });
  writeQueue = job.catch(() => {
    /* Keep the queue usable after a failed write. */
  });
  return job;
}

/** Restore Keychain entries after a partially failed persist. */
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
      keychain.setSecretById(id, value);
    } catch (error) {
      logWarn(`Failed to restore Keychain entry "${id}" during rollback.`, error);
    }
  }

  for (const id of keychainIdsToDelete) {
    try {
      keychain.setSecretById(id, "");
      pendingTombstones.delete(id);
    } catch (error) {
      logWarn(`Failed to write Keychain tombstone "${id}" during rollback.`, error);
    }
  }
}
