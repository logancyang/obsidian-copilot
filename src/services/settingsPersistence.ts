/**
 * Keychain-only settings persistence.
 *
 * Runtime settings are hydrated from Obsidian Keychain. Persisted settings
 * retain only non-secret values and the stable vault namespace used to locate
 * Keychain entries. Values already present in data.json are discarded without
 * being decrypted or imported.
 */

import { DEFAULT_SETTINGS, ProviderSettingsKeyMap, type SettingKeyProviders } from "@/constants";
import { logError, logWarn } from "@/logger";
import { KeychainService } from "@/services/keychainService";
import { cleanupLegacyFields, stripKeychainFields } from "@/services/settingsSecretTransforms";
import type { LegacyByokCredentialPresence } from "@/settings/migrations/byokMigration";
import { CURRENT_SETTINGS_VERSION } from "@/settings/migrations/version";
import {
  type CopilotSettings,
  createResetSettingsSnapshot,
  getSettings,
  getModelKeyFromModel,
  normalizeModelProvider,
  sanitizeSettings,
  setSettings,
} from "@/settings/model";
import { Notice } from "obsidian";

let writeQueue: Promise<void> = Promise.resolve();
let lastPersistedSettings: CopilotSettings | undefined;
let suppressNextPersist = false;
let transactionEpoch = 0;
const pendingTombstones = new Set<string>();
const EMPTY_CREDENTIAL_IDENTITIES: readonly string[] = Object.freeze([]);
const EMPTY_LEGACY_BYOK_CREDENTIAL_PRESENCE: LegacyByokCredentialPresence = Object.freeze({
  providerIds: EMPTY_CREDENTIAL_IDENTITIES,
  modelIds: EMPTY_CREDENTIAL_IDENTITIES,
});
let legacyByokCredentialPresence = EMPTY_LEGACY_BYOK_CREDENTIAL_PRESENCE;

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

/**
 * Record only which legacy BYOK providers had a disk credential so their
 * non-secret model metadata can migrate without retaining the credential.
 */
function collectLegacyByokCredentialPresence(
  settings: CopilotSettings
): LegacyByokCredentialPresence {
  const settingsRecord = settings as unknown as Record<string, unknown>;
  const providerIds = new Set<string>();
  const modelIds = new Set<string>();

  for (const model of settings.activeModels ?? []) {
    const modelRecord = model as unknown as Record<string, unknown>;
    const rawProvider = modelRecord.provider;
    if (typeof rawProvider !== "string") continue;
    const provider = normalizeModelProvider(rawProvider);

    const keyField = ProviderSettingsKeyMap[provider as SettingKeyProviders];
    const topLevelValue = keyField ? settingsRecord[keyField] : undefined;
    const modelValue = modelRecord.apiKey;
    if (typeof topLevelValue === "string" && topLevelValue.length > 0) {
      providerIds.add(provider);
    }
    if (
      typeof modelValue === "string" &&
      modelValue.length > 0 &&
      typeof modelRecord.name === "string"
    ) {
      modelIds.add(getModelKeyFromModel({ ...model, provider }));
    }
  }

  if (providerIds.size === 0 && modelIds.size === 0) {
    return EMPTY_LEGACY_BYOK_CREDENTIAL_PRESENCE;
  }
  return Object.freeze({
    providerIds: Object.freeze([...providerIds]),
    modelIds: Object.freeze([...modelIds]),
  });
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
  legacyByokCredentialPresence = EMPTY_LEGACY_BYOK_CREDENTIAL_PRESENCE;
}

/**
 * Return provider-wide and model-specific identities whose legacy disk
 * credentials were discarded at load. The one-time BYOK migration uses this
 * non-secret signal to retain only descriptors that require credential re-entry.
 */
export function getLegacyByokCredentialPresence(): LegacyByokCredentialPresence {
  return legacyByokCredentialPresence;
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
 */
export async function loadSettingsWithKeychain(
  rawData: unknown,
  saveData: (data: CopilotSettings) => Promise<void>
): Promise<CopilotSettings> {
  const isFreshInstall = rawData == null;
  const rawSettings = cloneRawSettings(rawData);
  legacyByokCredentialPresence = collectLegacyByokCredentialPresence(rawSettings);
  const keychain = KeychainService.getInstance();
  const persistedVaultId = rawSettings._keychainVaultId;
  const vaultId = isValidKeychainVaultId(persistedVaultId)
    ? persistedVaultId
    : keychain.getVaultId();
  keychain.setVaultId(vaultId);

  const diskSettings = buildDiskSettings(rawData, vaultId, isFreshInstall);
  if (JSON.stringify(rawSettings) !== JSON.stringify(diskSettings)) {
    try {
      await saveData(diskSettings);
    } catch {
      new Notice(
        "Copilot could not remove API keys from data.json. Check that the vault is writable, then restart Obsidian."
      );
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

/** Save a stripped settings snapshot without changing any Keychain entry. */
async function persistSettingsWithoutKeychainChanges(
  settings: CopilotSettings,
  saveData: (data: CopilotSettings) => Promise<void>
): Promise<void> {
  const cleaned = cleanupLegacyFields(settings);
  await saveData(stripKeychainFields(cleaned));
  lastPersistedSettings = structuredClone(cleaned);
}

/**
 * Reset non-secret settings transactionally while preserving every Keychain entry.
 *
 * @param saveData - Plugin-bound writer for the stripped reset snapshot.
 * @returns Whether the reset completed successfully.
 */
export async function resetSettingsPreservingKeychain(
  saveData: (data: CopilotSettings) => Promise<void>
): Promise<boolean> {
  try {
    const current = getSettings();
    const resetSnapshot = {
      ...createResetSettingsSnapshot(current),
      providers: current.providers,
      _keychainVaultId: current._keychainVaultId,
      settingsVersion: CURRENT_SETTINGS_VERSION,
    };
    await runPersistenceTransaction(async () => {
      await persistSettingsWithoutKeychainChanges(resetSnapshot, saveData);
      suppressNextPersistOnce();
      setSettings(resetSnapshot);
    });
    return true;
  } catch (error) {
    logError("Failed to reset Copilot settings.", error);
    new Notice(
      "Copilot could not reset settings. Check that the vault is writable, then try again."
    );
    return false;
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
