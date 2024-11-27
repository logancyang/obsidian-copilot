import { type CopilotSettings } from "@/settings/model";
import { Platform } from "obsidian";

// @ts-ignore
let safeStorageInternal: Electron.SafeStorage | null = null;

function getSafeStorage() {
  if (Platform.isDesktop && safeStorageInternal) {
    return safeStorageInternal;
  }
  // Dynamically import electron to access safeStorage
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  safeStorageInternal = require("electron")?.remote?.safeStorage;
  return safeStorageInternal;
}

const ENCRYPTION_PREFIX = "enc_";
const DECRYPTION_PREFIX = "dec_";

export function encryptAllKeys(settings: Readonly<CopilotSettings>): Readonly<CopilotSettings> {
  if (!settings.enableEncryption) {
    return settings;
  }
  const newSettings = { ...settings };
  const keysToEncrypt = Object.keys(settings).filter(
    (key) => key.toLowerCase().includes("apikey") || key === "plusLicenseKey"
  );

  for (const key of keysToEncrypt) {
    const apiKey = settings[key as keyof CopilotSettings] as string;
    (newSettings[key as keyof CopilotSettings] as any) = getEncryptedKey(apiKey);
  }

  if (Array.isArray(settings.activeModels)) {
    newSettings.activeModels = settings.activeModels.map((model) => ({
      ...model,
      apiKey: getEncryptedKey(model.apiKey || ""),
    }));
  }

  return newSettings;
}

export function getEncryptedKey(apiKey: string): string {
  if (!apiKey || apiKey.startsWith(ENCRYPTION_PREFIX)) {
    return apiKey;
  }

  if (isDecrypted(apiKey)) {
    apiKey = apiKey.replace(DECRYPTION_PREFIX, "");
  }

  if (getSafeStorage() && getSafeStorage().isEncryptionAvailable()) {
    // Convert the encrypted buffer to a Base64 string and prepend the prefix
    const encryptedBuffer = getSafeStorage().encryptString(apiKey) as Buffer;
    // Convert the encrypted buffer to a Base64 string and prepend the prefix
    return ENCRYPTION_PREFIX + encryptedBuffer.toString("base64");
  } else {
    // Simple fallback for mobile (just for demonstration)
    const encoder = new TextEncoder();
    const data = encoder.encode(apiKey);
    return ENCRYPTION_PREFIX + arrayBufferToBase64(data);
  }
}

export function getDecryptedKey(apiKey: string): string {
  if (!apiKey || isPlainText(apiKey)) {
    return apiKey;
  }
  if (isDecrypted(apiKey)) {
    return apiKey.replace(DECRYPTION_PREFIX, "");
  }

  const base64Data = apiKey.replace(ENCRYPTION_PREFIX, "");
  try {
    if (getSafeStorage() && getSafeStorage().isEncryptionAvailable()) {
      const buffer = Buffer.from(base64Data, "base64");
      return getSafeStorage().decryptString(buffer) as string;
    } else {
      // Simple fallback for mobile (just for demonstration)
      const data = base64ToArrayBuffer(base64Data);
      const decoder = new TextDecoder();
      return decoder.decode(data);
    }
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
