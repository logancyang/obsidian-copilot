/**
 * Core logic for generating and parsing `copilot-config-*.md` configuration files.
 *
 * A copilot-config-*.md file is a JSON wrapper containing:
 * - `meta`: protocol metadata (version, plugin version, timestamp)
 * - `stats`: pre-decryption summary (command/prompt/memory counts)
 * - `payload`: base64-encoded encrypted blob
 *
 * The encrypted inner payload contains:
 * - `settings`: full CopilotSettings with API keys decrypted to plaintext
 * - `vaultFiles`: custom commands, system prompts, and memory as raw markdown
 */

import { type App } from "obsidian";
import {
  assertSafeVaultRelativePath,
  type ExportContentOptions,
  DEFAULT_EXPORT_OPTIONS,
} from "@/configTransfer/vaultFiles";
import { getDecryptedKeyOrThrow, isSensitiveKey } from "@/encryptionService";
import { type CopilotSettings, getSettings, sanitizeSettings } from "@/settings/model";
import { cleanupLegacyFields } from "@/services/settingsSecretTransforms";
import { getBackfillHadFailures } from "@/services/settingsPersistence";
import { KeychainService } from "@/services/keychainService";
import {
  encryptWithPassphrase,
  decryptWithPassphrase,
  assertConfigPassphrase,
} from "@/configTransfer/crypto";
import { collectAllVaultFiles, type CollectedVaultFiles } from "@/configTransfer/vaultFiles";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Current schema version for the config file format. */
const CONFIG_FILE_VERSION = 1;

/** Format identifier for the outer wrapper. */
const CONFIG_FILE_FORMAT = "copilot-export";

// ---------------------------------------------------------------------------
// Outer wrapper types (readable without decryption)
// ---------------------------------------------------------------------------

/** Metadata visible without decryption. */
export interface ConfigFileMeta {
  pluginVersion: string;
  createdAt: string;
}

/** Summary stats visible without decryption. */
export interface ConfigFileStats {
  commandCount: number;
  promptCount: number;
  memoryCount: number;
}

/** Outer JSON wrapper of a copilot-config-*.md file. */
export interface ConfigFileWrapper {
  format: string;
  version: number;
  meta: ConfigFileMeta;
  stats: ConfigFileStats;
  payload: string;
}

// ---------------------------------------------------------------------------
// Inner payload types (after decryption)
// ---------------------------------------------------------------------------

/** Structure of the decrypted payload. */
interface ConfigFilePayload {
  meta: { version: number; pluginVersion: string; createdAt: string };
  settings: Record<string, unknown>;
  vaultFiles: CollectedVaultFiles;
}

// ---------------------------------------------------------------------------
// Export helpers
// ---------------------------------------------------------------------------

/**
 * Decrypt a sensitive setting value for export.
 *
 * Reason: exports must contain plaintext secrets so the target vault can
 * re-encrypt them using its own encryption configuration.
 */
async function decryptForExport(fieldLabel: string, value: string): Promise<string> {
  try {
    return await getDecryptedKeyOrThrow(value);
  } catch {
    throw new Error(
      `Failed to decrypt "${fieldLabel}". ` +
        "Ensure Copilot can decrypt your stored keys and try again."
    );
  }
}

/**
 * Recursively clone and decrypt all sensitive string values for export.
 *
 * Reason: settings may contain encrypted API keys at any nesting depth
 * (e.g., provider configs, model arrays). We walk the entire tree and
 * decrypt any property whose key matches `isSensitiveKey()`.
 */
async function decryptSensitiveForExport(value: unknown, path: string): Promise<unknown> {
  if (Array.isArray(value)) {
    return await Promise.all(
      value.map((item, index) => decryptSensitiveForExport(item, `${path}[${index}]`))
    );
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const [key, nested] of Object.entries(obj)) {
    const nextPath = path ? `${path}.${key}` : key;

    if (isSensitiveKey(key) && typeof nested === "string" && nested) {
      out[key] = await decryptForExport(nextPath, nested);
      continue;
    }

    out[key] = await decryptSensitiveForExport(nested, nextPath);
  }

  return out;
}

// ---------------------------------------------------------------------------
// Import safety helpers
// ---------------------------------------------------------------------------

// Reason: settings objects are typically <10 levels deep. A cap of 200
// prevents stack overflow from maliciously crafted deeply nested payloads.
const DEEP_SANITIZE_MAX_DEPTH = 200;

/**
 * Recursively sanitize a JSON-like value by removing prototype-pollution keys.
 */
function deepSanitize(value: unknown, depth = 0): unknown {
  if (depth > DEEP_SANITIZE_MAX_DEPTH) {
    throw new Error("Invalid payload: settings object is nested too deeply.");
  }

  if (Array.isArray(value)) {
    return value.map((item) => deepSanitize(item, depth + 1));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const [key, nested] of Object.entries(obj)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
    out[key] = deepSanitize(nested, depth + 1);
  }

  return out;
}

/**
 * Deep-clone imported settings into plain objects, stripping prototype-pollution keys.
 */
function toSafeRecord(input: Record<string, unknown>): Record<string, unknown> {
  return deepSanitize(input) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Export API
// ---------------------------------------------------------------------------

// Reason: folder path validation is shared with the import side via
// assertSafeVaultRelativePath() from vaultFiles.ts.

/**
 * Generate a `copilot-config-*.md` configuration file containing settings + vault files.
 *
 * @param appInstance - Obsidian App for vault file access.
 * @param passphrase - User-chosen password (min 8 characters).
 * @param pluginVersion - Current plugin version string from manifest.
 * @returns JSON string of the copilot-config-*.md file wrapper.
 */
export async function generateConfigFile(
  appInstance: App,
  passphrase: string,
  pluginVersion: string,
  exportOptions: ExportContentOptions = DEFAULT_EXPORT_OPTIONS
): Promise<string> {
  assertConfigPassphrase(passphrase);

  // Reason: fail closed — when disk secrets are already cleared, API keys
  // only exist in the OS keychain. If keychain is unavailable or had read
  // failures during startup, in-memory secrets are empty.
  const settings = getSettings();
  const diskSecretsCleared =
    (settings as unknown as Record<string, unknown>)._diskSecretsCleared === true;
  if (diskSecretsCleared) {
    const keychainAvailable = KeychainService.getInstance().isAvailable();
    if (!keychainAvailable) {
      throw new Error(
        "Cannot export: API keys are stored in the OS keychain, which is not " +
          "available on this device. Please export from a desktop device."
      );
    }
    if (getBackfillHadFailures()) {
      throw new Error(
        "Cannot export: some API keys could not be read from the OS keychain. " +
          "Please restart Obsidian and try again."
      );
    }
  }

  // Reason: validate folder paths at export time so the user gets a clear error
  // instead of generating a file that would fail its own import later.
  assertSafeVaultRelativePath(settings.customPromptsFolder, "Custom commands folder", true);
  assertSafeVaultRelativePath(settings.userSystemPromptsFolder, "System prompts folder", true);
  assertSafeVaultRelativePath(settings.memoryFolderName, "Memory folder", true);

  // Recursively decrypt all sensitive fields at any nesting depth
  const cleaned = cleanupLegacyFields(settings);
  const exported = (await decryptSensitiveForExport(
    cleaned as unknown as Record<string, unknown>,
    ""
  )) as Record<string, unknown>;

  // Reason: vault-scoped and identity fields should not be exported.
  // userId is stripped so importing installs generate their own identity
  // instead of sharing the exporter's Brevilabs user_id.
  delete exported._diskSecretsCleared;
  delete exported._keychainVaultId;
  delete exported._keychainMigratedAt;
  delete exported._migrationModalDismissed;
  delete exported.userId;

  // Collect vault files based on export options
  const vaultFiles = await collectAllVaultFiles(appInstance, exportOptions);

  // Count memory files for stats
  const memoryCount =
    (vaultFiles.memory.recentConversations != null ? 1 : 0) +
    (vaultFiles.memory.savedMemories != null ? 1 : 0);

  const now = new Date().toISOString();

  // Assemble inner payload
  const payload: ConfigFilePayload = {
    meta: {
      version: CONFIG_FILE_VERSION,
      pluginVersion,
      createdAt: now,
    },
    settings: exported,
    vaultFiles,
  };

  const encryptedPayload = await encryptWithPassphrase(JSON.stringify(payload), passphrase);

  // Assemble outer wrapper (readable without decryption)
  const wrapper: ConfigFileWrapper = {
    format: CONFIG_FILE_FORMAT,
    version: CONFIG_FILE_VERSION,
    meta: { pluginVersion, createdAt: now },
    stats: {
      commandCount: vaultFiles.customCommands.length,
      promptCount: vaultFiles.systemPrompts.length,
      memoryCount,
    },
    payload: encryptedPayload,
  };

  return JSON.stringify(wrapper, null, 2);
}

// ---------------------------------------------------------------------------
// Import API
// ---------------------------------------------------------------------------

/**
 * Parse the outer wrapper of a copilot-config-*.md file (no decryption needed).
 *
 * Reason: allows pre-decryption preview of stats and metadata so
 * users can see what's in the file before entering a password.
 *
 * @param content - Raw file content (JSON string).
 * @returns Parsed and validated wrapper.
 * @throws {Error} If the content is not a valid copilot-config-*.md file.
 */
export function parseConfigFileWrapper(content: string): ConfigFileWrapper {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("The selected file is not a valid configuration file (invalid JSON).");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("The selected file is not a valid configuration file.");
  }

  const obj = parsed as Record<string, unknown>;

  if (obj.format !== CONFIG_FILE_FORMAT) {
    throw new Error(
      "The selected file is not a valid Copilot configuration file " + "(unrecognized format)."
    );
  }

  if (typeof obj.version !== "number" || obj.version !== CONFIG_FILE_VERSION) {
    throw new Error(
      `Unsupported configuration file version (${obj.version}). ` +
        "Please update the Copilot plugin."
    );
  }

  if (!obj.payload || typeof obj.payload !== "string") {
    throw new Error("The configuration file is missing its encrypted payload.");
  }

  // Parse meta with fallbacks
  const rawMeta = (obj.meta as Record<string, unknown>) ?? {};
  const meta: ConfigFileMeta = {
    pluginVersion: typeof rawMeta.pluginVersion === "string" ? rawMeta.pluginVersion : "unknown",
    createdAt: typeof rawMeta.createdAt === "string" ? rawMeta.createdAt : "unknown",
  };

  // Parse stats with fallbacks
  const rawStats = (obj.stats as Record<string, unknown>) ?? {};
  const stats: ConfigFileStats = {
    commandCount: typeof rawStats.commandCount === "number" ? rawStats.commandCount : 0,
    promptCount: typeof rawStats.promptCount === "number" ? rawStats.promptCount : 0,
    memoryCount: typeof rawStats.memoryCount === "number" ? rawStats.memoryCount : 0,
  };

  return {
    format: CONFIG_FILE_FORMAT,
    version: CONFIG_FILE_VERSION,
    meta,
    stats,
    payload: obj.payload as string,
  };
}

/**
 * Decrypt and parse the inner payload of a copilot-config-*.md file.
 *
 * @param wrapper - Parsed outer wrapper from `parseConfigFileWrapper`.
 * @param passphrase - Password used to encrypt the file.
 * @returns Decrypted settings, metadata, and vault files.
 */
export async function decryptConfigFile(
  wrapper: ConfigFileWrapper,
  passphrase: string
): Promise<{ settings: CopilotSettings; meta: ConfigFileMeta; vaultFiles: CollectedVaultFiles }> {
  const json = await decryptWithPassphrase(wrapper.payload, passphrase);

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("Failed to parse the decrypted configuration data.");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid configuration payload: expected a JSON object.");
  }

  const obj = parsed as Record<string, unknown>;

  // Validate inner meta
  if (!obj.meta || typeof obj.meta !== "object" || Array.isArray(obj.meta)) {
    throw new Error("Invalid configuration payload: missing metadata.");
  }

  const innerMeta = obj.meta as Record<string, unknown>;
  if (typeof innerMeta.version !== "number") {
    throw new Error("Invalid configuration payload: missing version.");
  }

  if (innerMeta.version !== CONFIG_FILE_VERSION) {
    throw new Error(
      `Unsupported configuration version (${innerMeta.version}). ` +
        "Please update the Copilot plugin."
    );
  }

  // Validate settings
  if (!obj.settings || typeof obj.settings !== "object" || Array.isArray(obj.settings)) {
    throw new Error("Invalid configuration payload: missing settings data.");
  }

  // Sanitize settings (prototype pollution defense)
  const rawSettings = toSafeRecord(obj.settings as Record<string, unknown>);

  // Strip vault-scoped and identity fields
  delete rawSettings._diskSecretsCleared;
  delete rawSettings._keychainVaultId;
  delete rawSettings._keychainMigratedAt;
  delete rawSettings._migrationModalDismissed;
  // Reason: userId must not transfer between vaults — the importing install
  // should regenerate its own identity via sanitizeSettings().
  delete rawSettings.userId;

  // Reason: cached authorization state must not transfer between vaults.
  delete rawSettings.isPlusUser;
  delete rawSettings.selfHostModeValidatedAt;
  delete rawSettings.selfHostValidationCount;

  // Reason: guard crash-prone array fields before sanitizeSettings() which
  // calls .map() on them — untrusted input could have non-array values.
  if (!Array.isArray(rawSettings.activeModels)) rawSettings.activeModels = [];
  if (!Array.isArray(rawSettings.activeEmbeddingModels)) rawSettings.activeEmbeddingModels = [];
  if (rawSettings.projectList != null && !Array.isArray(rawSettings.projectList)) {
    rawSettings.projectList = [];
  }

  let sanitized: CopilotSettings;
  try {
    sanitized = sanitizeSettings(rawSettings as unknown as CopilotSettings);
  } catch {
    throw new Error("Invalid settings in configuration file. The file may be corrupted.");
  }

  sanitized = cleanupLegacyFields(sanitized);

  // Parse vault files with safe defaults
  const rawVaultFiles = (obj.vaultFiles as Record<string, unknown>) ?? {};
  const vaultFiles: CollectedVaultFiles = {
    customCommands: parsePortableFiles(rawVaultFiles.customCommands),
    systemPrompts: parsePortableFiles(rawVaultFiles.systemPrompts),
    memory: parsePortableMemory(rawVaultFiles.memory),
  };

  return {
    settings: sanitized,
    meta: {
      pluginVersion:
        typeof innerMeta.pluginVersion === "string" ? innerMeta.pluginVersion : "unknown",
      createdAt: typeof innerMeta.createdAt === "string" ? innerMeta.createdAt : "unknown",
    },
    vaultFiles,
  };
}

// ---------------------------------------------------------------------------
// Payload parsing helpers
// ---------------------------------------------------------------------------

/** Parse an array of portable vault files from untrusted input. */
function parsePortableFiles(input: unknown): Array<{ filename: string; content: string }> {
  if (!Array.isArray(input)) return [];

  return input
    .filter(
      (item): item is Record<string, unknown> =>
        !!item && typeof item === "object" && !Array.isArray(item)
    )
    .filter((item) => typeof item.filename === "string" && typeof item.content === "string")
    .map((item) => ({
      filename: item.filename as string,
      content: item.content as string,
    }));
}

/** Parse portable memory from untrusted input. */
function parsePortableMemory(input: unknown): {
  recentConversations: string | null;
  savedMemories: string | null;
} {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { recentConversations: null, savedMemories: null };
  }

  const mem = input as Record<string, unknown>;
  return {
    recentConversations:
      typeof mem.recentConversations === "string" ? mem.recentConversations : null,
    savedMemories: typeof mem.savedMemories === "string" ? mem.savedMemories : null,
  };
}
