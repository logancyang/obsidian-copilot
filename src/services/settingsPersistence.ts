/**
 * Keychain-only settings persistence.
 *
 * Runtime settings are hydrated from Obsidian Keychain. Values already present
 * in data.json are never read into runtime and never decrypted or imported.
 * They are also never destroyed: an existing data.json is left exactly as
 * found, and secrets it already held are carried through every later save.
 */

import { DEFAULT_SETTINGS } from "@/constants";
import { logWarn } from "@/logger";
import { KeychainService } from "@/services/keychainService";
import {
  cleanupLegacyFields,
  extractLegacyDiskSecrets,
  mergeLegacyDiskSecrets,
  stripKeychainFields,
  type LegacyDiskSecrets,
} from "@/services/settingsSecretTransforms";
import { CURRENT_SETTINGS_VERSION } from "@/settings/migrations/version";
import { type CopilotSettings, sanitizeSettings } from "@/settings/model";
import { Notice } from "obsidian";

let writeQueue: Promise<void> = Promise.resolve();
let lastPersistedSettings: CopilotSettings | undefined;
let suppressNextPersist = false;
let transactionEpoch = 0;
let legacyDiskSecrets: LegacyDiskSecrets | undefined;
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
  legacyDiskSecrets = undefined;
  pendingTombstones.clear();
}

/**
 * Stop carrying pre-v4 disk secrets into later saves.
 *
 * Call this after the user deliberately erases their credentials. That flow
 * writes a stripped data.json of its own, so leaving the snapshot in place
 * would resurrect the values it just removed on the very next save.
 */
export function forgetLegacyDiskSecrets(): void {
  legacyDiskSecrets = undefined;
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
 * The in-memory copy is stripped before any credential reaches runtime, so
 * Keychain hydration starts from a baseline that cannot fall back to disk
 * values. An existing data.json is not rewritten here: the strip that matters
 * is the in-memory one, and rewriting the file would destroy credentials that
 * may be the user's only copy.
 *
 * @param rawData - Untrusted data returned by Obsidian's loadData().
 * @param saveData - Plugin-bound writer used to seed data.json on a fresh install.
 */
export async function loadSettingsWithKeychain(
  rawData: unknown,
  saveData: (data: CopilotSettings) => Promise<void>
): Promise<CopilotSettings> {
  const isFreshInstall = rawData == null;
  const rawSettings = cloneRawSettings(rawData);
  const keychain = KeychainService.getInstance();
  const persistedVaultId = rawSettings._keychainVaultId;
  const vaultId = isValidKeychainVaultId(persistedVaultId)
    ? persistedVaultId
    : keychain.getVaultId();
  keychain.setVaultId(vaultId);

  // Reason: only a fresh install gets a write here, to seed the file with the
  // Keychain namespace. An existing data.json is left byte-for-byte alone.
  if (isFreshInstall) {
    try {
      await saveData(buildDiskSettings(rawData, vaultId, true));
    } catch {
      new Notice(
        "Copilot could not write its settings file. Check that the vault is writable, then restart Obsidian."
      );
    }
  } else {
    legacyDiskSecrets = extractLegacyDiskSecrets(rawSettings as unknown as Record<string, unknown>);
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
 * Write secrets to Keychain and save a data.json snapshot carrying no secret
 * this session owns, while preserving any the file already held.
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

    await saveData(mergeLegacyDiskSecrets(stripKeychainFields(cleaned), legacyDiskSecrets));
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
