/**
 * Core logic for generating and applying Setup URIs.
 *
 * A Setup URI encodes the full Copilot settings (with API keys decrypted
 * to plaintext) into an encrypted, compressed, base64url payload embedded
 * in an `obsidian://copilot-setup` protocol URI.
 *
 * Payload JSON envelope format:
 * ```json
 * {
 *   "meta": { "version": 1, "pluginVersion": "3.2.3", "createdAt": "..." },
 *   "settings": { ...CopilotSettings }
 * }
 * ```
 */

import { getDecryptedKeyOrThrow, isSensitiveKey } from "@/encryptionService";
import { type CopilotSettings, getSettings, sanitizeSettings } from "@/settings/model";
import { cleanupLegacyFields } from "@/services/settingsSecretTransforms";
import { getBackfillHadFailures } from "@/services/settingsPersistence";
import { KeychainService } from "@/services/keychainService";
import {
  encryptWithPassphrase,
  decryptWithPassphrase,
  assertSetupUriPassphrase,
} from "@/setupUri/crypto";
import { v4 as uuidv4 } from "uuid";

/** Current schema version for the setup URI payload envelope. */
const SETUP_URI_VERSION = 1;

/** Protocol action registered with Obsidian. */
const PROTOCOL_ACTION = "copilot-setup";

// ---------------------------------------------------------------------------
// Payload envelope types
// ---------------------------------------------------------------------------

/** Metadata section of the Setup URI payload. */
export interface SetupUriMeta {
  /** Schema version — used for forward-compatible parsing. */
  version: number;
  /** Plugin version that generated this URI. */
  pluginVersion: string;
  /** ISO 8601 timestamp of when the URI was created. */
  createdAt: string;
}

/** Top-level structure of the decrypted Setup URI payload. */
interface SetupUriEnvelope {
  meta: SetupUriMeta;
  settings: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/**
 * Decrypt a sensitive setting value for Setup URI export.
 *
 * Setup URI exports must contain plaintext secrets so the target vault can
 * re-encrypt them using its own encryption configuration. If decryption
 * fails, abort export to avoid generating a broken Setup URI.
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
 * (e.g., provider configs, model arrays). Instead of manually listing
 * each location, we walk the entire tree and decrypt any property whose
 * key matches `isSensitiveKey()`.
 *
 * @param value - Any JSON-like value from settings.
 * @param path - Dot-path used for error messages.
 * @returns Deep-cloned value with sensitive strings decrypted.
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

/**
 * Generate an encrypted Setup URI from the current settings.
 *
 * 1. Decrypts all API keys to plaintext (so the target vault can
 *    re-encrypt them with its own encryption settings).
 * 2. Embeds version metadata for future migration.
 * 3. Compresses + encrypts with the user-supplied passphrase.
 *
 * @param passphrase User-chosen password (minimum 8 characters).
 * @param pluginVersion Current plugin version string from manifest.
 * @returns The full `obsidian://copilot-setup?...` URI string.
 */
export async function generateSetupUri(passphrase: string, pluginVersion: string): Promise<string> {
  assertSetupUriPassphrase(passphrase);

  // Reason: fail closed — when disk secrets are already cleared, API keys
  // only exist in the OS keychain. If keychain is unavailable or had read
  // failures during startup, in-memory secrets are empty. Exporting now
  // would silently produce an incomplete Setup URI.
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

  // Recursively decrypt all sensitive fields at any nesting depth
  const cleaned = cleanupLegacyFields(settings);
  const exported = (await decryptSensitiveForExport(
    cleaned as unknown as Record<string, unknown>,
    ""
  )) as Record<string, unknown>;
  // Reason: vault-scoped fields should not be exported
  delete exported._diskSecretsCleared;
  delete exported._keychainVaultId;
  delete exported._keychainMigratedAt;
  delete exported._migrationModalDismissedAt;

  // Assemble structured envelope with metadata separated from settings
  const envelope: SetupUriEnvelope = {
    meta: {
      version: SETUP_URI_VERSION,
      pluginVersion,
      createdAt: new Date().toISOString(),
    },
    settings: exported,
  };

  const json = JSON.stringify(envelope);
  const payload = await encryptWithPassphrase(json, passphrase);

  return `obsidian://${PROTOCOL_ACTION}?payload=${payload}&v=${SETUP_URI_VERSION}`;
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

/**
 * Decrypt, parse, and validate a Setup URI payload into a typed envelope.
 *
 * Shared pipeline used by both `validateSetupUri()` and `applySetupUri()`
 * to avoid duplicating the decrypt → JSON parse → envelope validate →
 * version check sequence.
 *
 * @param payload The base64url-encoded encrypted payload.
 * @param passphrase The password used to encrypt the payload.
 * @returns The validated envelope containing metadata and settings.
 * @throws {SetupUriDecryptionError} If the password is wrong.
 * @throws {Error} If the payload is malformed or the version is unsupported.
 */
async function decryptAndParseEnvelope(
  payload: string,
  passphrase: string
): Promise<SetupUriEnvelope> {
  const json = await decryptWithPassphrase(payload, passphrase);

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("Failed to parse the decrypted settings as JSON.");
  }

  const envelope = parseEnvelope(parsed);

  if (envelope.meta.version !== SETUP_URI_VERSION) {
    throw new Error(
      `Unsupported settings version (${envelope.meta.version}). Please update the Copilot plugin.`
    );
  }

  return envelope;
}

/**
 * Decrypt and validate a Setup URI payload without applying any settings.
 *
 * Use this to verify the password is correct before committing to the
 * destructive import step.
 *
 * @param payload The base64url-encoded encrypted payload.
 * @param passphrase The password used to encrypt the payload.
 * @throws {SetupUriDecryptionError} If the password is wrong.
 * @throws {Error} If the payload is malformed or the version is unsupported.
 */
export async function validateSetupUri(payload: string, passphrase: string): Promise<void> {
  // Reason: discard the result intentionally — this function only validates
  // that the payload can be decrypted and parsed, without side effects.
  await decryptAndParseEnvelope(payload, passphrase);
}

/**
 * Extract the encrypted payload from a raw Setup URI string.
 *
 * Accepts both full URIs (`obsidian://copilot-setup?payload=...`) and
 * bare payloads (just the base64url string).
 *
 * @returns The base64url-encoded payload string.
 * @throws {Error} If the URI format is invalid.
 */
export function extractPayloadFromUri(uri: string): string {
  const trimmed = uri.trim();

  // If it looks like a full URI, parse out the payload parameter
  if (trimmed.startsWith("obsidian://")) {
    // Reason: require exact action match followed by "?" (or "/?") to prevent
    // prefix collisions (e.g., "obsidian://copilot-setup-evil?...").
    // Some platforms emit a trailing slash before the query string.
    const expectedPrefix = `obsidian://${PROTOCOL_ACTION}?`;
    const expectedPrefixWithSlash = `obsidian://${PROTOCOL_ACTION}/?`;
    if (!trimmed.startsWith(expectedPrefix) && !trimmed.startsWith(expectedPrefixWithSlash)) {
      throw new Error("Invalid URI: expected an obsidian://copilot-setup link.");
    }

    // Reason: Obsidian protocol URIs use a non-standard format that
    // is not always parseable by the URL constructor, so we manually
    // extract the query string. The "?" is guaranteed by the prefix check above.
    const queryString = trimmed.slice(trimmed.indexOf("?") + 1);
    const params = new URLSearchParams(queryString);
    const payload = params.get("payload");
    if (!payload) {
      throw new Error("Invalid Setup URI: missing payload parameter.");
    }
    return payload;
  }

  // Otherwise treat the entire string as a bare payload
  return trimmed;
}

/**
 * Decrypt and parse a Setup URI payload into sanitized settings.
 *
 * After parsing:
 * - A `userId` is preserved from the payload (or generated if missing).
 * - The settings are sanitized through `sanitizeSettings()`.
 *
 * Note: does NOT call `setSettings()` or persist to disk. The caller is
 * responsible for persisting the returned settings (to avoid double-save
 * from the settings subscription) and triggering a plugin reload.
 *
 * @param payload The base64url-encoded encrypted payload.
 * @param passphrase The password used to encrypt the payload.
 * @returns Sanitized settings and envelope metadata.
 */
export async function applySetupUri(
  payload: string,
  passphrase: string
): Promise<{ settings: CopilotSettings; meta: SetupUriMeta }> {
  const envelope = await decryptAndParseEnvelope(payload, passphrase);
  const settings = toSafeRecord(envelope.settings);

  // Reason: strip legacy and vault-scoped fields that should not transfer
  // between vaults. These are all vault-local state, not portable.
  delete settings._keychainMigrated;
  delete settings.enableEncryption;
  delete settings._diskSecretsCleared;
  delete settings._keychainVaultId;
  delete settings._keychainMigratedAt;
  delete settings._migrationModalDismissedAt;

  // Reason: cached authorization state must not transfer between vaults.
  // These fields bypass fresh entitlement checks in plusUtils.ts, so
  // importing them could grant Plus/self-host access without validation.
  delete settings.isPlusUser;
  delete settings.selfHostModeValidatedAt;
  delete settings.selfHostValidationCount;

  // Reason: only generate a new userId when the payload lacks one.
  // Preserving the original userId avoids resetting server-side identity
  // (e.g., Brevilabs analytics) when migrating between vaults.
  if (typeof settings.userId !== "string" || !settings.userId) {
    settings.userId = uuidv4();
  }

  // Reason: guard crash-prone array fields that existing code iterates over.
  // sanitizeSettings() normalizes some arrays but not all (e.g. projectList).
  if (!Array.isArray(settings.activeModels)) settings.activeModels = [];
  if (!Array.isArray(settings.activeEmbeddingModels)) settings.activeEmbeddingModels = [];
  if (settings.projectList != null && !Array.isArray(settings.projectList)) {
    settings.projectList = [];
  }

  // Sanitize through the standard pipeline to handle migrations and defaults
  let sanitized: CopilotSettings;
  try {
    sanitized = sanitizeSettings(settings as unknown as CopilotSettings);
  } catch {
    throw new Error("Invalid settings payload. The Setup URI may be corrupted or incompatible.");
  }

  // Clean any remaining legacy fields post-sanitize
  sanitized = cleanupLegacyFields(sanitized);

  return {
    settings: sanitized,
    meta: envelope.meta,
  };
}

/**
 * Deep-clone imported settings into plain objects, stripping prototype-pollution keys.
 *
 * Reason: the imported JSON comes from an untrusted source. Keys like `__proto__`,
 * `constructor`, and `prototype` can pollute Object.prototype if merged/spread
 * at any nesting depth — not just the top level.
 */
function toSafeRecord(input: Record<string, unknown>): Record<string, unknown> {
  return deepSanitize(input) as Record<string, unknown>;
}

// Reason: settings objects are typically <10 levels deep. A cap of 200
// prevents stack overflow from maliciously crafted deeply nested payloads
// while being generous enough to never affect legitimate settings.
const DEEP_SANITIZE_MAX_DEPTH = 200;

/**
 * Recursively sanitize a JSON-like value by removing prototype-pollution keys.
 *
 * @param value - Any JSON-parsed value.
 * @param depth - Current nesting depth (internal, used for stack-safety guard).
 * @returns A deep-cloned value safe to pass into sanitization/migration code.
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
 * Parse and validate the decrypted JSON as a Setup URI envelope.
 *
 * @throws {Error} If the JSON structure is not a valid envelope.
 */
function parseEnvelope(parsed: unknown): SetupUriEnvelope {
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid payload: expected a JSON object.");
  }

  const obj = parsed as Record<string, unknown>;

  // Reason: check for the `meta` field to distinguish the new envelope format
  // from a potential future format or corrupted data.
  // Array.isArray guards are needed because `typeof [] === "object"` in JS.
  if (!obj.meta || typeof obj.meta !== "object" || Array.isArray(obj.meta)) {
    throw new Error(
      "Invalid payload format: missing metadata. " +
        "This URI may have been created with an incompatible plugin version."
    );
  }

  if (!obj.settings || typeof obj.settings !== "object" || Array.isArray(obj.settings)) {
    throw new Error("Invalid payload format: missing settings data.");
  }

  const meta = obj.meta as Record<string, unknown>;
  if (typeof meta.version !== "number") {
    throw new Error("Invalid payload: missing or invalid version in metadata.");
  }

  return {
    meta: {
      version: meta.version,
      pluginVersion: typeof meta.pluginVersion === "string" ? meta.pluginVersion : "unknown",
      createdAt: typeof meta.createdAt === "string" ? meta.createdAt : "unknown",
    },
    settings: obj.settings as Record<string, unknown>,
  };
}
