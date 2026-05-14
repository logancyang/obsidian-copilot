import { TextDecoder, TextEncoder } from "util";

// Mock electron module with proper types
const mockElectron = {
  remote: {
    safeStorage: {
      encryptString: jest.fn().mockImplementation((text) => Buffer.from(`${text}_encrypted`)),
      decryptString: jest
        .fn()
        .mockImplementation((buffer: Buffer) => buffer.toString().replace("_encrypted", "")),
      isEncryptionAvailable: jest.fn().mockReturnValue(true),
    },
  },
};

jest.mock("electron", () => mockElectron);

window.TextEncoder = TextEncoder;
window.TextDecoder = TextDecoder as unknown as typeof window.TextDecoder;

// Now we can import our modules
import { encryptAllKeys, getDecryptedKey, getEncryptedKey } from "@/encryptionService";
import { type CopilotSettings } from "@/settings/model";
import { Platform } from "obsidian";
import { Buffer } from "buffer";

// Mock window.btoa and window.atob for base64 encoding/decoding
window.btoa = jest.fn().mockImplementation((str: string) => Buffer.from(str).toString("base64"));
window.atob = jest.fn().mockImplementation((str: string) => Buffer.from(str, "base64").toString());

const mockSubtle = {
  importKey: jest.fn().mockResolvedValue("mockCryptoKey"),
  encrypt: jest.fn().mockImplementation((algorithm, key, data: ArrayBuffer) => {
    const originalText = new TextDecoder().decode(data);
    const encryptedText = `${originalText}_encrypted`;
    return Promise.resolve(new TextEncoder().encode(encryptedText).buffer);
  }),
  decrypt: jest.fn().mockImplementation((algorithm, key, data) => {
    const encryptedText = new TextDecoder().decode(new Uint8Array(data));
    const originalText = encryptedText.replace("_encrypted", "");
    return Promise.resolve(new TextEncoder().encode(originalText).buffer);
  }),
};

// Mock crypto.subtle instead of the entire crypto object
Object.defineProperty(window.crypto, "subtle", {
  value: mockSubtle,
  configurable: true,
});

describe("Platform-specific Tests", () => {
  it("should recognize the platform as desktop", () => {
    expect(Platform.isDesktop).toBe(true); // Directly using the mocked value
  });

  // Example of a conditional test based on the platform
  it("should only run certain logic on desktop", () => {
    if (Platform.isDesktop) {
      // Your desktop-specific logic here
      expect(true).toBe(true); // Replace with actual assertions
    } else {
      expect(true).toBe(false); // This line is just for demonstration and should be replaced
    }
  });
});

describe("EncryptionService", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  describe("getEncryptedKey (deprecated no-op)", () => {
    it("should return plaintext key unchanged", async () => {
      const apiKey = "testApiKey";
      const result = await getEncryptedKey(apiKey);
      expect(result).toBe(apiKey);
    });

    it("should strip the dec_ prefix when present", async () => {
      const result = await getEncryptedKey("dec_testApiKey");
      expect(result).toBe("testApiKey");
    });

    it("should return empty string for empty input", async () => {
      const result = await getEncryptedKey("");
      expect(result).toBe("");
    });
  });

  describe("getDecryptedKey", () => {
    it("should decrypt an encrypted API key", async () => {
      const apiKey = "testApiKey";
      const encryptedKey = await getEncryptedKey(apiKey);
      const decryptedKey = await getDecryptedKey(encryptedKey);
      expect(decryptedKey).toBe(apiKey);
    });

    it("should return the original key if it is in plain text", async () => {
      const apiKey = "testApiKey";
      const decryptedKey = await getDecryptedKey(apiKey);
      expect(decryptedKey).toBe(apiKey);
    });
  });

  describe("encryptAllKeys (deprecated no-op)", () => {
    it("should return settings unchanged regardless of enableEncryption", async () => {
      const settings = {
        enableEncryption: true,
        openAIApiKey: "testApiKey",
        cohereApiKey: "anotherTestApiKey",
        userSystemPrompt: "shouldBeIgnored",
      } as unknown as CopilotSettings;

      const result = await encryptAllKeys(settings);
      expect(result).toBe(settings);
    });
  });
});

describe("Cross-platform compatibility", () => {
  let originalConsoleError: typeof console.error;

  beforeEach(() => {
    jest.clearAllMocks();
    // Save original console.error
    originalConsoleError = console.error;
    // Mock console.error to suppress expected encryption fallback messages
    console.error = jest.fn();
  });

  afterEach(() => {
    // Restore original console.error
    console.error = originalConsoleError;
  });

  it("should decrypt legacy WebCrypto-encrypted keys on mobile", async () => {
    // Simulate a key encrypted with the legacy WebCrypto path (the only path
    // mobile ever used, and the path desktop fell back to when safeStorage
    // wasn't available). The mocked subtle.decrypt strips the `_encrypted`
    // suffix the encrypt mock appends.
    const enc = (await mockSubtle.encrypt(
      null,
      null,
      new TextEncoder().encode("testApiKey").buffer
    )) as ArrayBuffer;
    const encBytes = new Uint8Array(enc);
    let binary = "";
    for (let i = 0; i < encBytes.length; i++) binary += String.fromCharCode(encBytes[i]);
    const webEncryptedKey = "enc_web_" + window.btoa(binary);

    const decryptedKey = await getDecryptedKey(webEncryptedKey);
    expect(decryptedKey).toBe("testApiKey");
    expect(mockSubtle.decrypt).toHaveBeenCalled();
  });
});
