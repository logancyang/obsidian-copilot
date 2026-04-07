import { Buffer } from "buffer";
import { Platform } from "obsidian";

import { logError } from "@/logger";
import { getSettings, updateSetting, type CopilotSettings } from "@/settings/model";

type SafeStorage = {
  encryptString(text: string): Buffer;
  decryptString(buffer: Buffer): string;
  isEncryptionAvailable(): boolean;
};

// @ts-ignore
let safeStorageInternal: SafeStorage | null = null;

const DESKTOP_PREFIX = "enc_desk_";
const WEBCRYPTO_PREFIX = "enc_web_";
const WEBCRYPTO_V2_PREFIX = "enc_v2_";
const ENCRYPTION_PREFIX = "enc_";
const DECRYPTION_PREFIX = "dec_";
const LEGACY_WEBCRYPTO_KEY = new TextEncoder().encode("obsidian-copilot-v1");
const LEGACY_WEBCRYPTO_ALGORITHM = { name: "AES-GCM", iv: new Uint8Array(12) } as const;
const DESKTOP_UNAVAILABLE_MESSAGE = "DESKTOP_KEY_UNAVAILABLE";
const DECRYPTION_FAILURE_MESSAGE = "Copilot failed to decrypt API keys!";

/**
 * Return true when the current runtime can use Electron safeStorage.
 */
function isDesktopPlatform(): boolean {
  return Boolean(Platform.isDesktop || Platform.isDesktopApp);
}

/**
 * Resolve Electron safeStorage lazily on desktop platforms.
 */
function getSafeStorage(): SafeStorage | null {
  if (!isDesktopPlatform()) {
    return null;
  }

  if (safeStorageInternal) {
    return safeStorageInternal;
  }

  // Dynamically import electron to access safeStorage.
  // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
  safeStorageInternal = require("electron")?.remote?.safeStorage;
  return safeStorageInternal;
}

/**
 * Persist the generated per-vault Web Crypto key.
 */
function persistVaultKey(rawKeyB64: string): void {
  updateSetting("encryptionKeyB64", rawKeyB64);
}

/**
 * Encode a byte array into base64.
 */
function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

/**
 * Decode a base64 string into a byte array.
 */
function fromBase64(base64: string): Uint8Array {
  return new Uint8Array(Buffer.from(base64, "base64"));
}

/**
 * Import the legacy static Web Crypto key used by older enc_web_ and enc_ values.
 */
export async function getLegacyEncryptionKey(): Promise<CryptoKey> {
  return await crypto.subtle.importKey("raw", LEGACY_WEBCRYPTO_KEY, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

/**
 * Return the persisted per-vault Web Crypto key, generating one if needed.
 */
async function getOrCreateVaultKey(): Promise<CryptoKey> {
  const settings = getSettings();
  let rawKeyB64 = settings.encryptionKeyB64;

  if (!rawKeyB64) {
    const rawKey = crypto.getRandomValues(new Uint8Array(32));
    rawKeyB64 = toBase64(rawKey);
    persistVaultKey(rawKeyB64);
  }

  return await crypto.subtle.importKey("raw", fromBase64(rawKeyB64), "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

/**
 * Encrypt a plaintext value using the per-vault Web Crypto V2 format.
 */
async function encryptV2(plaintext: string): Promise<string> {
  const key = await getOrCreateVaultKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encodedData = new TextEncoder().encode(plaintext);
  const encryptedData = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encodedData);
  const ciphertext = new Uint8Array(encryptedData);
  const combined = new Uint8Array(iv.length + ciphertext.length);
  combined.set(iv);
  combined.set(ciphertext, iv.length);
  return WEBCRYPTO_V2_PREFIX + toBase64(combined);
}

/**
 * Decrypt a legacy Web Crypto value that used the static key and zero IV.
 */
async function decryptLegacyWebCryptoValue(apiKey: string): Promise<string> {
  const base64Data = apiKey.startsWith(WEBCRYPTO_PREFIX)
    ? apiKey.slice(WEBCRYPTO_PREFIX.length)
    : apiKey.slice(ENCRYPTION_PREFIX.length);
  const key = await getLegacyEncryptionKey();
  const encryptedData = fromBase64(base64Data);
  const decryptedData = await crypto.subtle.decrypt(LEGACY_WEBCRYPTO_ALGORITHM, key, encryptedData);
  return new TextDecoder().decode(decryptedData);
}

/**
 * Return true if the string already uses a recognized encrypted prefix.
 */
export function isEncryptedValue(value: string): boolean {
  return (
    value.startsWith(DESKTOP_PREFIX) ||
    value.startsWith(WEBCRYPTO_V2_PREFIX) ||
    value.startsWith(WEBCRYPTO_PREFIX) ||
    value.startsWith(ENCRYPTION_PREFIX)
  );
}

/**
 * Return true if the string is still plain text and not any recognized encrypted or decrypted form.
 */
export function isPlainText(key: string): boolean {
  return !isEncryptedValue(key) && !key.startsWith(DECRYPTION_PREFIX);
}

/**
 * Return true if the value is a desktop-safeStorage encrypted payload.
 */
export function isDesktopEncryptedValue(value: string): boolean {
  return value.startsWith(DESKTOP_PREFIX);
}

/**
 * Return true if the value uses the legacy Web Crypto format that should be migrated to V2.
 */
export function isLegacyWebCryptoValue(value: string): boolean {
  return (
    value.startsWith(WEBCRYPTO_PREFIX) ||
    (value.startsWith(ENCRYPTION_PREFIX) &&
      !value.startsWith(DESKTOP_PREFIX) &&
      !value.startsWith(WEBCRYPTO_V2_PREFIX) &&
      !value.startsWith(DECRYPTION_PREFIX))
  );
}

/**
 * Return true if the value is the decrypted sentinel form.
 */
function isDecrypted(keyBuffer: string): boolean {
  return keyBuffer.startsWith(DECRYPTION_PREFIX);
}

/**
 * Return true when a decrypted legacy value is safe to re-encrypt into V2.
 */
function isMigratableDecryptedValue(value: string): boolean {
  return (
    value.length > 0 &&
    value !== DESKTOP_UNAVAILABLE_MESSAGE &&
    value !== DECRYPTION_FAILURE_MESSAGE
  );
}

/**
 * Encrypt all known API key settings when encryption is enabled.
 */
export async function encryptAllKeys(
  settings: Readonly<CopilotSettings>
): Promise<Readonly<CopilotSettings>> {
  if (!settings.enableEncryption) {
    return settings;
  }

  const newSettings = { ...settings };
  const keysToEncrypt = Object.keys(settings).filter(
    (key) =>
      key.toLowerCase().includes("apikey") ||
      key === "plusLicenseKey" ||
      key === "githubCopilotAccessToken" ||
      key === "githubCopilotToken"
  );

  for (const key of keysToEncrypt) {
    const apiKey = settings[key as keyof CopilotSettings] as string;
    (newSettings[key as keyof CopilotSettings] as any) = await getEncryptedKey(apiKey);
  }

  if (Array.isArray(settings.activeModels)) {
    newSettings.activeModels = await Promise.all(
      settings.activeModels.map(async (model) => ({
        ...model,
        apiKey: await getEncryptedKey(model.apiKey || ""),
      }))
    );
  }

  if (Array.isArray(settings.activeEmbeddingModels)) {
    newSettings.activeEmbeddingModels = await Promise.all(
      settings.activeEmbeddingModels.map(async (model) => ({
        ...model,
        apiKey: await getEncryptedKey(model.apiKey || ""),
      }))
    );
  }

  return newSettings;
}

/**
 * Encrypt a single key, preserving any already-encrypted value and preferring desktop safeStorage.
 */
export async function getEncryptedKey(apiKey: string): Promise<string> {
  if (!apiKey || isEncryptedValue(apiKey)) {
    return apiKey;
  }

  if (isDecrypted(apiKey)) {
    apiKey = apiKey.slice(DECRYPTION_PREFIX.length);
  }

  try {
    const safeStorage = getSafeStorage();
    if (safeStorage?.isEncryptionAvailable()) {
      const encryptedBuffer = safeStorage.encryptString(apiKey) as Buffer;
      return DESKTOP_PREFIX + encryptedBuffer.toString("base64");
    }

    return await encryptV2(apiKey);
  } catch {
    logError("Encryption failed");
    return apiKey;
  }
}

/**
 * Migrate legacy Web Crypto values to the V2 per-vault format.
 */
export async function migrateEncryptionToV2(
  settings: CopilotSettings
): Promise<CopilotSettings | null> {
  if (!settings.enableEncryption) {
    return null;
  }

  let changed = false;
  const newSettings = { ...settings };

  const keysToMigrate = Object.keys(settings).filter(
    (key) =>
      key.toLowerCase().includes("apikey") ||
      key === "plusLicenseKey" ||
      key === "githubCopilotAccessToken" ||
      key === "githubCopilotToken"
  );

  for (const key of keysToMigrate) {
    const value = settings[key as keyof CopilotSettings] as string;
    if (typeof value === "string" && isLegacyWebCryptoValue(value)) {
      const decrypted = await decryptLegacyWebCryptoValue(value);
      if (isMigratableDecryptedValue(decrypted)) {
        (newSettings[key as keyof CopilotSettings] as any) = await encryptV2(decrypted);
        changed = true;
      }
    }
  }

  if (Array.isArray(settings.activeModels)) {
    newSettings.activeModels = await Promise.all(
      settings.activeModels.map(async (model) => {
        if (isLegacyWebCryptoValue(model.apiKey || "")) {
          const decrypted = await decryptLegacyWebCryptoValue(model.apiKey || "");
          if (isMigratableDecryptedValue(decrypted)) {
            changed = true;
            return {
              ...model,
              apiKey: await encryptV2(decrypted),
            };
          }
        }
        return model;
      })
    );
  }

  if (Array.isArray(settings.activeEmbeddingModels)) {
    newSettings.activeEmbeddingModels = await Promise.all(
      settings.activeEmbeddingModels.map(async (model) => {
        if (isLegacyWebCryptoValue(model.apiKey || "")) {
          const decrypted = await decryptLegacyWebCryptoValue(model.apiKey || "");
          if (isMigratableDecryptedValue(decrypted)) {
            changed = true;
            return {
              ...model,
              apiKey: await encryptV2(decrypted),
            };
          }
        }
        return model;
      })
    );
  }

  return changed ? (newSettings as CopilotSettings) : null;
}

/**
 * Decrypt a single key according to its recognized prefix family.
 */
export async function getDecryptedKey(apiKey: string): Promise<string> {
  if (!apiKey || isPlainText(apiKey)) {
    return apiKey;
  }

  if (isDecrypted(apiKey)) {
    return apiKey.slice(DECRYPTION_PREFIX.length);
  }

  try {
    if (isDesktopEncryptedValue(apiKey)) {
      const safeStorage = getSafeStorage();
      if (!safeStorage?.isEncryptionAvailable()) {
        logError("Desktop-encrypted key cannot be decrypted on this platform");
        return DESKTOP_UNAVAILABLE_MESSAGE;
      }

      const base64Data = apiKey.slice(DESKTOP_PREFIX.length);
      const buffer = Buffer.from(fromBase64(base64Data));
      return safeStorage.decryptString(buffer) as string;
    }

    if (apiKey.startsWith(WEBCRYPTO_V2_PREFIX)) {
      const base64Data = apiKey.slice(WEBCRYPTO_V2_PREFIX.length);
      const combined = fromBase64(base64Data);
      const iv = combined.subarray(0, 12);
      const ciphertext = combined.subarray(12);
      const key = await getOrCreateVaultKey();
      const decryptedData = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
      return new TextDecoder().decode(decryptedData);
    }

    if (isLegacyWebCryptoValue(apiKey)) {
      return await decryptLegacyWebCryptoValue(apiKey);
    }
  } catch {
    logError("Decryption failed");
    return DECRYPTION_FAILURE_MESSAGE;
  }

  return apiKey;
}
