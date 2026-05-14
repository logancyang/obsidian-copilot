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

// Encryption-at-rest is deprecated as of this commit. `getEncryptedKey`
// and `encryptAllKeys` are now no-ops, so new keys are saved plaintext.
// We still decrypt legacy `enc_*` blobs at read time via `getDecryptedKey`
// for backwards compatibility; existing keys migrate organically the next
// time the user re-saves them.
const DESKTOP_PREFIX = "enc_desk_";
const WEBCRYPTO_PREFIX = "enc_web_";
// Keep old prefix for backward compatibility
const ENCRYPTION_PREFIX = "enc_";
const DECRYPTION_PREFIX = "dec_";

// Reason: returned by getDecryptedKey when a DESKTOP_PREFIX key is hit on
// mobile. Used because dispatch-map builders in chatModelManager.ts /
// embeddingManager.ts await all provider keys eagerly; a throw would kill
// the chat even when the actually-selected provider has a valid key.
// Exported so callers can pattern-match on the sentinel later if we want to
// surface a more targeted error when the bad key is the one being used.
export const DESKTOP_KEY_ON_MOBILE_SENTINEL =
  "__COPILOT_KEY_ENCRYPTED_ON_DESKTOP_REENTER_ON_MOBILE__";

// Add these constants for the Web Crypto implementation
const ENCRYPTION_KEY = new TextEncoder().encode("obsidian-copilot-v1");
const ALGORITHM = { name: "AES-GCM", iv: new Uint8Array(12) };

async function getEncryptionKey(): Promise<CryptoKey> {
  return await crypto.subtle.importKey("raw", ENCRYPTION_KEY, ALGORITHM.name, false, [
    "encrypt",
    "decrypt",
  ]);
}

/**
 * No-op: encryption-at-rest is deprecated. Returns settings unchanged.
 * Existing encrypted keys (`enc_*`) stay in data.json and are decrypted at
 * read time via getDecryptedKey for backwards compatibility. New keys are
 * saved plaintext.
 */
export async function encryptAllKeys(
  settings: Readonly<CopilotSettings>
): Promise<Readonly<CopilotSettings>> {
  return settings;
}

/**
 * No-op: encryption-at-rest is deprecated. Strips the `dec_` marker if
 * present and returns the raw plaintext key.
 */
export async function getEncryptedKey(apiKey: string): Promise<string> {
  if (!apiKey) return apiKey;
  return isDecrypted(apiKey) ? apiKey.replace(DECRYPTION_PREFIX, "") : apiKey;
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
    // Reason: DESKTOP_PREFIX keys are encrypted with Electron's safeStorage
    // (Keychain / DPAPI / libsecret). Mobile has no Electron and no
    // safeStorage, so a desktop-encrypted key synced to mobile via Obsidian
    // Sync cannot be decrypted there. Return a sentinel string instead of
    // throwing — chatModelManager.ts and embeddingManager.ts eagerly await
    // getDecryptedKey for EVERY provider when building their dispatch map
    // literal, so a throw here kills the entire chat even if the user is
    // using a different provider with a perfectly valid key. The startup
    // Notice in main.ts lists which fields need re-entry; this sentinel
    // ensures map construction succeeds for the providers that *don't* use
    // a desktop-encrypted key.
    if (Platform.isMobile) {
      return DESKTOP_KEY_ON_MOBILE_SENTINEL;
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

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = window.atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}
