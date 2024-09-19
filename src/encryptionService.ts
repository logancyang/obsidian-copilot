import { CopilotSettings } from "@/settings/SettingsPage";
import { Platform } from "obsidian";

// Dynamically import electron to access safeStorage
// @ts-ignore
let safeStorage: Electron.SafeStorage | null = null;

if (Platform.isDesktop) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  safeStorage = require("electron")?.remote?.safeStorage;
}

export default class EncryptionService {
  private settings: CopilotSettings;
  private static ENCRYPTION_PREFIX = "enc_";
  private static DECRYPTION_PREFIX = "dec_";

  constructor(settings: CopilotSettings) {
    this.settings = settings;
  }

  private isPlainText(key: string): boolean {
    return (
      !key.startsWith(EncryptionService.ENCRYPTION_PREFIX) &&
      !key.startsWith(EncryptionService.DECRYPTION_PREFIX)
    );
  }

  private isDecrypted(keyBuffer: string): boolean {
    return keyBuffer.startsWith(EncryptionService.DECRYPTION_PREFIX);
  }

  public encryptAllKeys(): void {
    const keysToEncrypt = Object.keys(this.settings).filter((key) =>
      key.toLowerCase().includes("apikey".toLowerCase())
    );

    for (const key of keysToEncrypt) {
      const apiKey = this.settings[key as keyof CopilotSettings] as string;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.settings[key as keyof CopilotSettings] as any) = this.getEncryptedKey(apiKey);
    }

    if (Array.isArray(this.settings.activeModels)) {
      this.settings.activeModels = this.settings.activeModels.map((model) => ({
        ...model,
        apiKey: this.getEncryptedKey(model.apiKey || ""),
      }));
    }
  }

  public getEncryptedKey(apiKey: string): string {
    if (
      !apiKey ||
      !this.settings.enableEncryption ||
      apiKey.startsWith(EncryptionService.ENCRYPTION_PREFIX)
    ) {
      return apiKey;
    }

    if (this.isDecrypted(apiKey)) {
      apiKey = apiKey.replace(EncryptionService.DECRYPTION_PREFIX, "");
    }

    if (safeStorage && safeStorage.isEncryptionAvailable()) {
      // Convert the encrypted buffer to a Base64 string and prepend the prefix
      const encryptedBuffer = safeStorage.encryptString(apiKey) as Buffer;
      // Convert the encrypted buffer to a Base64 string and prepend the prefix
      return EncryptionService.ENCRYPTION_PREFIX + encryptedBuffer.toString("base64");
    } else {
      // Simple fallback for mobile (just for demonstration)
      const encoder = new TextEncoder();
      const data = encoder.encode(apiKey);
      return EncryptionService.ENCRYPTION_PREFIX + this.arrayBufferToBase64(data);
    }
  }

  public getDecryptedKey(apiKey: string): string {
    if (!apiKey || this.isPlainText(apiKey)) {
      return apiKey;
    }
    if (this.isDecrypted(apiKey)) {
      return apiKey.replace(EncryptionService.DECRYPTION_PREFIX, "");
    }

    const base64Data = apiKey.replace(EncryptionService.ENCRYPTION_PREFIX, "");
    try {
      if (safeStorage && safeStorage.isEncryptionAvailable()) {
        const buffer = Buffer.from(base64Data, "base64");
        return safeStorage.decryptString(buffer) as string;
      } else {
        // Simple fallback for mobile (just for demonstration)
        const data = this.base64ToArrayBuffer(base64Data);
        const decoder = new TextDecoder();
        return decoder.decode(data);
      }
    } catch (err) {
      console.error("Decryption failed:", err);
      return "Copilot failed to decrypt API keys!";
    }
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  }

  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binaryString = window.atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }
}
