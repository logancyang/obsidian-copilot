/**
 * Encryption/decryption service for Copilot secrets.
 *
 * After the OS Keychain migration, this module only provides:
 * - Decryption of legacy encrypted values (for reading legacy encrypted disk values)
 * - `isSensitiveKey()` — canonical field identification
 * - `isEncryptedValue()` — prefix detection for encrypted strings
 * - Base64 utilities
 *
 * All encryption-write functions have been removed because secrets
 * are now written to the OS keychain directly (plaintext).
 */

// Reason: do NOT import from @/logger here. The logger depends on getSettings(),
// but this module runs during settings loading (before setSettings).
// Use console.* directly for all logging in this file.

// Reason: `buffer` is the npm polyfill (browser-compatible), bundled by
// esbuild so the same Buffer code path works on desktop (Electron) and
// mobile (WebView). Without this import, bare `Buffer` is undefined on
// mobile and throws "Can't find variable: Buffer" — see PR #2443.
// eslint-disable-next-line import/no-nodejs-modules
import { Buffer } from "buffer";
import { Platform } from "obsidian";

interface SafeStorage {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

let safeStorageInternal: SafeStorage | null = null;

/**
 * Safely get Electron `safeStorage` when available.
 *
 * @returns The Electron safeStorage instance, or `null` when unavailable.
 */
function getSafeStorage(): SafeStorage | null {
  if (!Platform.isDesktopApp && !Platform.isDesktop) return null;
  if (safeStorageInternal) return safeStorageInternal;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    safeStorageInternal = require("electron")?.remote?.safeStorage as SafeStorage | null;
    return safeStorageInternal;
  } catch {
    return null;
  }
}

// Prefixes to distinguish encryption methods
const DESKTOP_PREFIX = "enc_desk_";
const WEBCRYPTO_PREFIX = "enc_web_";
const ENCRYPTION_PREFIX = "enc_";
const DECRYPTION_PREFIX = "dec_";

/**
 * @deprecated getDecryptedKey() now returns "" on failure instead of this sentinel.
 * Kept only for backward compatibility with code that may still reference it.
 */
export const DECRYPTION_FAILURE_MESSAGE = "Copilot failed to decrypt API keys!";

/**
 * Check whether a value looks like a well-formed encrypted Copilot secret
 * (recognized prefix + plausible base64 payload).
 *
 * Use this when the caller wants strict detection — for example, deciding
 * whether to display a value as decrypt-able in a UI. Returns false for
 * values whose prefix matches but whose payload is corrupted, so callers
 * that must protect such values during persistence should use
 * `hasEncryptionPrefix()` instead.
 */
export function isEncryptedValue(value: string): boolean {
  if (value.startsWith(DESKTOP_PREFIX)) {
    return looksLikeBase64(value.slice(DESKTOP_PREFIX.length));
  }
  if (value.startsWith(WEBCRYPTO_PREFIX)) {
    return looksLikeBase64(value.slice(WEBCRYPTO_PREFIX.length));
  }
  if (value.startsWith(ENCRYPTION_PREFIX)) {
    return looksLikeBase64(value.slice(ENCRYPTION_PREFIX.length));
  }
  return false;
}

/**
 * Permissive sibling of {@link isEncryptedValue}: returns true for any
 * value carrying a Copilot encryption prefix, regardless of whether the
 * payload still looks like valid base64.
 *
 * Reason: persistence code must treat "prefix matches but payload is
 * corrupted" as encrypted-and-failed. Otherwise the keychain write path
 * would treat a corrupted `enc_*` string as plaintext and silently
 * overwrite the keychain with junk — and the disk-strip path would drop
 * the only remaining copy. See `stripSecretsPreservingFailed`.
 */
export function hasEncryptionPrefix(value: string): boolean {
  return (
    value.startsWith(DESKTOP_PREFIX) ||
    value.startsWith(WEBCRYPTO_PREFIX) ||
    value.startsWith(ENCRYPTION_PREFIX)
  );
}

/**
 * Check whether a string is plausibly base64-encoded ciphertext.
 */
function looksLikeBase64(data: string): boolean {
  if (!data) return false;
  if (data.length % 4 === 1) return false;
  return /^[A-Za-z0-9+/]+={0,2}$/.test(data);
}

// ---------------------------------------------------------------------------
// WebCrypto: decrypt-only support for legacy formats
// ---------------------------------------------------------------------------

const WEBCRYPTO_IV_LENGTH = 12;
const WEBCRYPTO_KEY_STORAGE_KEY = "obsidian-copilot:webcrypto-key:v1";
/** Magic header for portable payloads (hardcoded key + random IV). */
const WEBCRYPTO_PORTABLE_MAGIC = new Uint8Array([0x43, 0x50, 0x30, 0x30]); // "CP00"
/** Magic header for legacy per-device payloads (kept for backward-compat decryption). */
const WEBCRYPTO_DEVICE_MAGIC = new Uint8Array([0x43, 0x50, 0x30, 0x31]); // "CP01"

/**
 * Portable AES-GCM key material shared across all devices.
 * Reason: derives a 256-bit AES key via SHA-256.
 */
const PORTABLE_WEBCRYPTO_KEY_MATERIAL = new TextEncoder().encode("obsidian-copilot-v1");
const LEGACY_WEBCRYPTO_IV = new Uint8Array(WEBCRYPTO_IV_LENGTH);

function assertWebCryptoAvailable(): void {
  if (!window.crypto?.subtle) {
    throw new Error("WebCrypto API is not available in this environment.");
  }
}

function getLocalStorageSafe(): Storage | null {
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * Read an existing per-device AES-256 key from localStorage.
 * Reason: kept for backward-compat decryption of CP01 payloads.
 */
async function getExistingWebCryptoKey(): Promise<CryptoKey | null> {
  try {
    const storage = getLocalStorageSafe();
    if (!storage) return null;
    const existing = storage.getItem(WEBCRYPTO_KEY_STORAGE_KEY);
    if (!existing) return null;
    const raw = base64ToArrayBuffer(existing);
    return await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
  } catch (error) {
    console.warn("Failed to load WebCrypto key from localStorage.", error);
    return null;
  }
}

/**
 * Import the portable WebCrypto key for CP00 decryption
 * and legacy fixed-IV decryption.
 */
async function getPortableWebCryptoKey(): Promise<CryptoKey> {
  const keyBytes = await crypto.subtle.digest("SHA-256", PORTABLE_WEBCRYPTO_KEY_MATERIAL);
  return await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function hasWebCryptoMagic(bytes: Uint8Array, magic: Uint8Array): boolean {
  if (bytes.length < magic.length) return false;
  for (let i = 0; i < magic.length; i++) {
    if (bytes[i] !== magic[i]) return false;
  }
  return true;
}

/**
 * Decrypt a WEBCRYPTO_PREFIX value.
 * Supports portable CP00, legacy per-device CP01, and legacy fixed-IV formats.
 */
async function decryptWebCryptoValue(base64Data: string): Promise<string> {
  assertWebCryptoAvailable();
  const raw = new Uint8Array(base64ToArrayBuffer(base64Data));

  // Portable format: [CP00][IV][CIPHERTEXT]
  if (hasWebCryptoMagic(raw, WEBCRYPTO_PORTABLE_MAGIC)) {
    const ivStart = WEBCRYPTO_PORTABLE_MAGIC.length;
    const ivEnd = ivStart + WEBCRYPTO_IV_LENGTH;
    if (raw.length <= ivEnd) throw new Error("Invalid WebCrypto portable payload: too short.");

    const iv = raw.slice(ivStart, ivEnd);
    const ciphertext = raw.slice(ivEnd);
    const key = await getPortableWebCryptoKey();
    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
    return new TextDecoder().decode(decrypted);
  }

  // Legacy per-device format: [CP01][IV][CIPHERTEXT]
  if (hasWebCryptoMagic(raw, WEBCRYPTO_DEVICE_MAGIC)) {
    const ivStart = WEBCRYPTO_DEVICE_MAGIC.length;
    const ivEnd = ivStart + WEBCRYPTO_IV_LENGTH;
    if (raw.length <= ivEnd) throw new Error("Invalid WebCrypto CP01 payload: too short.");

    const iv = raw.slice(ivStart, ivEnd);
    const ciphertext = raw.slice(ivEnd);
    const key = await getExistingWebCryptoKey();
    if (!key) throw new Error("Per-device WebCrypto key unavailable for CP01 decryption.");

    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
    return new TextDecoder().decode(decrypted);
  }

  // Legacy format: ciphertext only, fixed IV + hardcoded key
  const key = await getPortableWebCryptoKey();
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: LEGACY_WEBCRYPTO_IV },
    key,
    base64ToArrayBuffer(base64Data)
  );
  return new TextDecoder().decode(decrypted);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check whether a top-level settings key holds a sensitive value.
 * This is the single source of truth for sensitive field identification.
 */
export function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  const normalized = lower.replace(/[_-]/g, "");
  return (
    normalized.includes("apikey") ||
    lower.endsWith("token") ||
    lower.endsWith("accesstoken") ||
    lower.endsWith("secret") ||
    lower.endsWith("password") ||
    lower.endsWith("licensekey")
  );
}

/**
 * Decrypt an API key from any supported encryption format.
 *
 * Returns the plaintext value, or `""` on failure.
 * For plaintext input, returns the value as-is.
 */
export async function getDecryptedKey(apiKey: string): Promise<string> {
  try {
    if (!apiKey || isPlainText(apiKey)) {
      return apiKey;
    }
    if (isDecrypted(apiKey)) {
      return apiKey.replace(DECRYPTION_PREFIX, "");
    }

    if (apiKey.startsWith(DESKTOP_PREFIX)) {
      const safeStorage = getSafeStorage();
      if (!safeStorage?.isEncryptionAvailable()) {
        console.warn("Cannot decrypt desktop-encrypted key: safeStorage unavailable.");
        return "";
      }
      const base64Data = apiKey.replace(DESKTOP_PREFIX, "");
      const buffer = Buffer.from(base64Data, "base64");
      return safeStorage.decryptString(buffer);
    }

    if (apiKey.startsWith(WEBCRYPTO_PREFIX)) {
      const base64Data = apiKey.replace(WEBCRYPTO_PREFIX, "");
      return await decryptWebCryptoValue(base64Data);
    }

    // Legacy enc_ prefix
    const base64Data = apiKey.replace(ENCRYPTION_PREFIX, "");
    if (getSafeStorage()?.isEncryptionAvailable()) {
      try {
        const buffer = Buffer.from(base64Data, "base64");
        return getSafeStorage()!.decryptString(buffer);
      } catch {
        // Fall through to WebCrypto
      }
    }

    return await decryptWebCryptoValue(base64Data);
  } catch (err) {
    console.error("Decryption failed:", err);
    return "";
  }
}

/**
 * Decrypt an API key and throw when decryption fails.
 * Use in workflows that must not proceed with undecryptable values
 * (e.g., configuration export).
 */
export async function getDecryptedKeyOrThrow(apiKey: string): Promise<string> {
  const decrypted = await getDecryptedKey(apiKey);
  if (!decrypted) {
    throw new Error("Failed to decrypt API key.");
  }
  return decrypted;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isPlainText(key: string): boolean {
  return !key.startsWith(ENCRYPTION_PREFIX) && !key.startsWith(DECRYPTION_PREFIX);
}

function isDecrypted(keyBuffer: string): boolean {
  return keyBuffer.startsWith(DECRYPTION_PREFIX);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = window.atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}
