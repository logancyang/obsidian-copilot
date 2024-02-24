import { CopilotSettings } from "@/settings/SettingsPage";
import { Platform } from "obsidian";

// Dynamically import electron to access safeStorage
// @ts-ignore
let safeStorage: Electron.SafeStorage;

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
    // If a key does not start with the prefix, it's considered plain text
    return (
      !key.startsWith(EncryptionService.ENCRYPTION_PREFIX) &&
      !key.startsWith(EncryptionService.DECRYPTION_PREFIX)
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private isDecrypted(keyBuffer: any): boolean {
    return (
      keyBuffer.startsWith(EncryptionService.DECRYPTION_PREFIX)
    );
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
  }

  public getEncryptedKey(apiKey: string): string {
    if (!apiKey) {
      return apiKey;
    }
    // Return as is if encryption is not enabled, or already encrypted
    if (
      !safeStorage.isEncryptionAvailable() ||
      !this.settings.enableEncryption ||
      apiKey.startsWith(EncryptionService.ENCRYPTION_PREFIX)
    ) {
      return apiKey;
    }
    // Make sure what's encrypted is the plain text api key
    if (this.isDecrypted(apiKey)) {
      // Remove the prefix if the key is decrypted
      apiKey = apiKey.replace(EncryptionService.DECRYPTION_PREFIX, "");
    }
    const encryptedBuffer = safeStorage.encryptString(apiKey) as Buffer;
    // Convert the encrypted buffer to a Base64 string and prepend the prefix
    return (
      EncryptionService.ENCRYPTION_PREFIX + encryptedBuffer.toString("base64")
    );
  }

  // Get the actual key for use in the LLM chain
  public getDecryptedKey(apiKey: string): string {
    if (!apiKey) {
      return apiKey;
    }
    if (this.isPlainText(apiKey)) {
      return apiKey; // Return as is if the key is in plain text
    }
    if (this.isDecrypted(apiKey)) {
      return apiKey.replace(EncryptionService.DECRYPTION_PREFIX, "");
    }

    // Remove the prefix and convert from Base64 to a buffer before decryption
    const base64Data = apiKey.replace(
      EncryptionService.ENCRYPTION_PREFIX,
      ""
    );
    try {
      const buffer = Buffer.from(base64Data, "base64");
      return safeStorage.decryptString(buffer) as string;
    } catch (err) {
      return "Copilot failed to decrypt API keys!";
    }
  }
}
