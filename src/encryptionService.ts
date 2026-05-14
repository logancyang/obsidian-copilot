// Reason: `buffer` is the npm polyfill (browser-compatible), bundled by
// esbuild so the same Buffer code path works on desktop (Electron) and
// mobile (WebView). Without this import, bare `Buffer` is undefined on
// mobile and throws "Can't find variable: Buffer" — see PR #2443.
// eslint-disable-next-line import/no-nodejs-modules
import { Buffer } from "buffer";

import { type CopilotSettings } from "@/settings/model";
import { Platform } from "obsidian";

interface SafeStorage {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

let safeStorageInternal: SafeStorage | null = null;

function getSafeStorage(): SafeStorage | null {
  if (Platform.isDesktop && safeStorageInternal) {
    return safeStorageInternal;
  }
  // Dynamically import electron to access safeStorage
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  safeStorageInternal = require("electron")?.remote?.safeStorage as SafeStorage | null;
  return safeStorageInternal;
}

// Add new prefixes to distinguish encryption methods
const DESKTOP_PREFIX = "enc_desk_";
const WEBCRYPTO_PREFIX = "enc_web_";
// Keep old prefix for backward compatibility
const ENCRYPTION_PREFIX = "enc_";
const DECRYPTION_PREFIX = "dec_";

// Add these constants for the Web Crypto implementation
const ENCRYPTION_KEY = new TextEncoder().encode("obsidian-copilot-v1");
const ALGORITHM = { name: "AES-GCM", iv: new Uint8Array(12) };

async function getEncryptionKey(): Promise<CryptoKey> {
  return await crypto.subtle.importKey("raw", ENCRYPTION_KEY, ALGORITHM.name, false, [
    "encrypt",
    "decrypt",
  ]);
}

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

export async function getEncryptedKey(apiKey: string): Promise<string> {
  if (!apiKey || apiKey.startsWith(ENCRYPTION_PREFIX)) {
    return apiKey;
  }

  if (isDecrypted(apiKey)) {
    apiKey = apiKey.replace(DECRYPTION_PREFIX, "");
  }

  try {
    // Reason: only attempt safeStorage encryption on desktop. Mobile has no
    // Electron, so a safeStorage-encrypted blob saved on mobile would be
    // unusable here (and could even sync back to desktop if Obsidian Sync
    // pushes it). Belt-and-suspenders: even if getSafeStorage() somehow
    // returned a truthy value on mobile, we want the WebCrypto path.
    if (Platform.isDesktop && getSafeStorage()?.isEncryptionAvailable()) {
      const encryptedBuffer = getSafeStorage()!.encryptString(apiKey);
      return DESKTOP_PREFIX + encryptedBuffer.toString("base64");
    }

    // Fallback to Web Crypto API (always used on mobile)
    const key = await getEncryptionKey();
    const encodedData = new TextEncoder().encode(apiKey);
    const encryptedData = await crypto.subtle.encrypt(ALGORITHM, key, encodedData);
    return WEBCRYPTO_PREFIX + arrayBufferToBase64(encryptedData);
  } catch (error) {
    console.error("Encryption failed:", error);
    return apiKey;
  }
}

/**
 * Scan settings for API keys still encrypted with the desktop-only prefix.
 * Used on mobile to surface which fields the user must re-enter — they were
 * encrypted with Electron's safeStorage and cannot be decrypted on mobile.
 *
 * Returns the human-readable field names (e.g. "plusLicenseKey",
 * "activeModels[gpt-5.5]") in the order they appear in settings.
 */
export function findDesktopEncryptedKeyFields(settings: Readonly<CopilotSettings>): string[] {
  const found: string[] = [];

  for (const key of Object.keys(settings)) {
    const value = settings[key as keyof CopilotSettings];
    if (typeof value === "string" && value.startsWith(DESKTOP_PREFIX)) {
      found.push(key);
    }
  }

  if (Array.isArray(settings.activeModels)) {
    for (const model of settings.activeModels) {
      if (typeof model.apiKey === "string" && model.apiKey.startsWith(DESKTOP_PREFIX)) {
        found.push(`activeModels[${model.name}]`);
      }
    }
  }

  if (Array.isArray(settings.activeEmbeddingModels)) {
    for (const model of settings.activeEmbeddingModels) {
      if (typeof model.apiKey === "string" && model.apiKey.startsWith(DESKTOP_PREFIX)) {
        found.push(`activeEmbeddingModels[${model.name}]`);
      }
    }
  }

  return found;
}

export async function getDecryptedKey(apiKey: string): Promise<string> {
  if (!apiKey || isPlainText(apiKey)) {
    return apiKey;
  }
  if (isDecrypted(apiKey)) {
    return apiKey.replace(DECRYPTION_PREFIX, "");
  }

  // Handle different encryption methods
  if (apiKey.startsWith(DESKTOP_PREFIX)) {
    // Reason: DESKTOP_PREFIX keys are encrypted with Electron's safeStorage,
    // which uses OS-level encryption (Keychain / DPAPI / libsecret). Mobile
    // has no Electron and no safeStorage, so a desktop-encrypted key synced
    // to mobile via Obsidian Sync cannot be decrypted there. Throw a clear,
    // actionable error instead of letting Buffer.from / safeStorage crash
    // with a cryptic "Can't find variable: Buffer".
    if (Platform.isMobile) {
      throw new Error(
        "This API key was encrypted on desktop with OS-level encryption that's " +
          "unavailable on mobile. Please re-enter your API key in Copilot settings " +
          "on this device to use it here."
      );
    }
    const base64Data = apiKey.replace(DESKTOP_PREFIX, "");
    const buffer = Buffer.from(base64Data, "base64");
    return getSafeStorage()!.decryptString(buffer);
  }

  if (apiKey.startsWith(WEBCRYPTO_PREFIX)) {
    const base64Data = apiKey.replace(WEBCRYPTO_PREFIX, "");
    const key = await getEncryptionKey();
    const encryptedData = base64ToArrayBuffer(base64Data);
    const decryptedData = await crypto.subtle.decrypt(ALGORITHM, key, encryptedData);
    return new TextDecoder().decode(decryptedData);
  }

  // Legacy support for old enc_ prefix
  const base64Data = apiKey.replace(ENCRYPTION_PREFIX, "");
  try {
    // Try desktop decryption first
    if (getSafeStorage()?.isEncryptionAvailable()) {
      try {
        const buffer = Buffer.from(base64Data, "base64");
        return getSafeStorage()!.decryptString(buffer);
      } catch {
        // Silent catch is intentional - if desktop decryption fails,
        // it means this key was likely encrypted with Web Crypto.
        // We'll fall through to the Web Crypto decryption below.
      }
    }

    // Fallback to Web Crypto API
    const key = await getEncryptionKey();
    const encryptedData = base64ToArrayBuffer(base64Data);
    const decryptedData = await crypto.subtle.decrypt(ALGORITHM, key, encryptedData);
    return new TextDecoder().decode(decryptedData);
  } catch (err) {
    console.error("Decryption failed:", err);
    return "Copilot failed to decrypt API keys!";
  }
}

function isPlainText(key: string): boolean {
  return !key.startsWith(ENCRYPTION_PREFIX) && !key.startsWith(DECRYPTION_PREFIX);
}

function isDecrypted(keyBuffer: string): boolean {
  return keyBuffer.startsWith(DECRYPTION_PREFIX);
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = window.atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}
