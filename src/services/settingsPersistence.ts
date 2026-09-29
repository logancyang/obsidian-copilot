import { DEFAULT_SETTINGS } from "@/constants";
import { logWarn } from "@/logger";
import { KeychainService } from "@/services/keychainService";
import { type LegacyBackupResult } from "@/services/legacyCredentialBackup";
import { cleanupLegacyFields, stripKeychainFields } from "@/services/settingsSecretTransforms";
import type { StartupMigrationItem } from "@/services/startupMigration";
import { CURRENT_SETTINGS_VERSION } from "@/settings/migrations/version";
import { type CopilotSettings, sanitizeSettings } from "@/settings/model";
import { getDeviceId } from "@/utils/deviceId";
import { type App, Notice } from "obsidian";

let writeQueue: Promise<void> = Promise.resolve();
let lastPersistedSettings: CopilotSettings | undefined;
let suppressNextPersist = false;
let transactionEpoch = 0;
let legacyCredentialsUnprotected = false;
const pendingTombstones = new Set<string>();

const KEYCHAIN_VAULT_ID_RE = /^[a-f0-9]{8}$/;

function isValidKeychainVaultId(value: unknown): value is string {
  return typeof value === "string" && KEYCHAIN_VAULT_ID_RE.test(value);
}

function cloneRawSettings(rawData: unknown): CopilotSettings {
  if (!rawData || typeof rawData !== "object" || Array.isArray(rawData)) {
    return {} as CopilotSettings;
  }
  return structuredClone(rawData) as CopilotSettings;
}

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

export function resetPersistenceState(): void {
  writeQueue = Promise.resolve();
  lastPersistedSettings = undefined;
  suppressNextPersist = false;
  transactionEpoch = 0;
  legacyCredentialsUnprotected = false;
  pendingTombstones.clear();
}

export function releaseLegacyCredentialHold(): void {
  legacyCredentialsUnprotected = false;
}

export function refreshLastPersistedSettings(data: CopilotSettings): void {
  lastPersistedSettings = structuredClone(data);
}

export function suppressNextPersistOnce(): void {
  suppressNextPersist = true;
}

export async function runPersistenceTransaction(task: () => Promise<void>): Promise<void> {
  const job = writeQueue.then(async () => {
    try {
      await task();
    } finally {
      transactionEpoch++;
    }
  });
  writeQueue = job.catch(() => {});
  return job;
}

export async function flushPersistence(): Promise<void> {
  await writeQueue;
}

function credentialMigrationFromRecovery(
  app: App,
  recovery: CopilotSettings["_pendingCredentialRecovery"]
): StartupMigrationItem | null {
  if (
    !recovery ||
    recovery.deviceId !== getDeviceId(app) ||
    typeof recovery.path !== "string" ||
    typeof recovery.encrypted !== "boolean"
  ) {
    return null;
  }
  return {
    id: "credentials",
    title: "API keys",
    status: "action-required",
    summary: "Credential storage moved to the Obsidian Keychain.",
    details: recovery.encrypted
      ? [
          `Previous keys were copied to ${recovery.path}.`,
          "Some keys are encrypted and cannot be read back. Get fresh keys from those providers and enter them in Settings.",
        ]
      : [
          `Previous keys were copied to ${recovery.path}.`,
          "Re-enter the keys in Settings, then delete the backup file.",
        ],
  };
}

export async function loadSettingsWithKeychain(
  app: App,
  rawData: unknown,
  saveData: (data: CopilotSettings) => Promise<void>,
  backupLegacyCredentials: (rawData: unknown) => Promise<LegacyBackupResult>,
  onMigration?: (item: StartupMigrationItem) => void
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
  let credentialMigration = credentialMigrationFromRecovery(
    app,
    diskSettings._pendingCredentialRecovery
  );

  const reportCredentialMigration = (): void => {
    if (credentialMigration && onMigration) {
      onMigration(credentialMigration);
    }
  };
  const showFallbackNotice = (message: string, duration?: number): void => {
    if (!onMigration || !credentialMigration) new Notice(message, duration);
  };
  const markCredentialError = (detail: string, summary?: string): void => {
    if (!credentialMigration) return;
    credentialMigration = {
      ...credentialMigration,
      status: "error",
      summary: summary ?? credentialMigration.summary,
      details: [...(credentialMigration.details ?? []), detail],
    };
  };

  if (JSON.stringify(rawSettings) !== JSON.stringify(diskSettings)) {
    const backup = await backupLegacyCredentials(rawData);
    if (backup.status === "failed") {
      legacyCredentialsUnprotected = true;
      credentialMigration = {
        id: "credentials",
        title: "API keys",
        status: "error",
        summary: "API keys could not be backed up, so data.json was left untouched.",
        details: ["Check that the vault is writable, then restart Obsidian to retry."],
      };
      showFallbackNotice(
        "Copilot could not back up the API keys stored in data.json, so it left the file untouched. Check that the vault is writable, then restart Obsidian."
      );
    } else {
      if (backup.status === "backed-up") {
        diskSettings._pendingCredentialRecovery = {
          deviceId: getDeviceId(app),
          path: backup.path,
          encrypted: backup.encrypted,
        };
        credentialMigration = credentialMigrationFromRecovery(
          app,
          diskSettings._pendingCredentialRecovery
        );
        showFallbackNotice(
          backup.encrypted
            ? `Copilot moved credential storage to the Obsidian Keychain. Your previous keys were copied to ${backup.path}, but some are encrypted and cannot be read back. Get fresh keys from those providers and enter them in Settings.`
            : `Copilot moved credential storage to the Obsidian Keychain. Your previous keys were copied to ${backup.path}. Re-enter them in Settings, then delete that file.`,
          15000
        );
      }
      try {
        await saveData(diskSettings);
      } catch {
        markCredentialError(
          "Check that the vault is writable, then restart Obsidian to retry.",
          "API keys were backed up, but could not be removed from data.json."
        );
        showFallbackNotice(
          "Copilot could not remove API keys from data.json. Check that the vault is writable, then restart Obsidian."
        );
      }
    }
  }

  const runtimeSource = isFreshInstall ? structuredClone(DEFAULT_SETTINGS) : rawSettings;
  const sanitized = cleanupLegacyFields(sanitizeSettings(runtimeSource));
  const baseline = stripKeychainFields({
    ...sanitized,
    _keychainVaultId: vaultId,
    _pendingCredentialRecovery: diskSettings._pendingCredentialRecovery,
  });

  if (!keychain.isAvailable()) {
    markCredentialError(
      "Obsidian Keychain is unavailable in this Obsidian build, so keys cannot be loaded or saved."
    );
    showFallbackNotice(
      "Obsidian Keychain is unavailable. Copilot cannot load or save API keys in this Obsidian build."
    );
    reportCredentialMigration();
    lastPersistedSettings = structuredClone(baseline);
    return baseline;
  }

  const { settings: hydrated, hadFailures } = await keychain.hydrateFromKeychain(baseline);
  if (hadFailures) {
    markCredentialError(
      "Some API keys could not be loaded from the Obsidian Keychain. Restart Obsidian if the issue persists."
    );
    showFallbackNotice(
      "Some API keys could not be loaded from the Obsidian Keychain. Restart Obsidian if the issue persists."
    );
  }
  reportCredentialMigration();
  lastPersistedSettings = structuredClone(hydrated);
  return hydrated;
}

async function persistKeychainSettings(
  settings: CopilotSettings,
  saveData: (data: CopilotSettings) => Promise<void>,
  prev: CopilotSettings | undefined
): Promise<void> {
  if (legacyCredentialsUnprotected) {
    throw new Error(
      "Copilot cannot save settings until it can back up the API keys still in data.json. " +
        "Check that the vault is writable, then restart Obsidian."
    );
  }

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

export async function persistSettingsWithinTransaction(
  settings: CopilotSettings,
  saveData: (data: CopilotSettings) => Promise<void>,
  prevSettings?: CopilotSettings
): Promise<void> {
  await persistKeychainSettings(settings, saveData, prevSettings);
}

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
  writeQueue = job.catch(() => {});
  return job;
}

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
