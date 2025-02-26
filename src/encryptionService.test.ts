import { TextDecoder, TextEncoder } from "util";

// Mock electron module with proper types
const mockElectron = {
  remote: {
    safeStorage: {
      encryptString: jest.fn().mockImplementation((text) => Buffer.from(`${text}_encrypted`)),
      decryptString: jest
        .fn()
        .mockImplementation((buffer) => buffer.toString().replace("_encrypted", "")),
      isEncryptionAvailable: jest.fn().mockReturnValue(true),
    },
  },
};

jest.mock("electron", () => mockElectron);

global.TextEncoder = TextEncoder as any;
global.TextDecoder = TextDecoder as any;

// Now we can import our modules
import { encryptAllKeys, getDecryptedKey, getEncryptedKey } from "@/encryptionService";
import { type CopilotSettings } from "@/settings/model";
import { Platform } from "obsidian";
import { Buffer } from "buffer";

// Mock window.btoa and window.atob for base64 encoding/decoding
global.btoa = jest.fn().mockImplementation((str) => Buffer.from(str).toString("base64"));
global.atob = jest.fn().mockImplementation((str) => Buffer.from(str, "base64").toString());

const mockSubtle = {
  importKey: jest.fn().mockResolvedValue("mockCryptoKey"),
  encrypt: jest.fn().mockImplementation((algorithm, key, data) => {
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
Object.defineProperty(global.crypto, "subtle", {
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

  describe("getEncryptedKey", () => {
    it("should encrypt an API key", async () => {
      const apiKey = "testApiKey";
      const encryptedKey = await getEncryptedKey(apiKey);
      // The key is base64 encoded, so we should expect that format
      expect(encryptedKey).toMatch(/^enc_(desk|web)_[A-Za-z0-9+/=]+$/);
      // Verify we can decrypt it back
      const decryptedKey = await getDecryptedKey(encryptedKey);
      expect(decryptedKey).toBe(apiKey);
    });

    it("should return the original key if already encrypted", async () => {
      const apiKey = "enc_testApiKey";
      const encryptedKey = await getEncryptedKey(apiKey);
      expect(encryptedKey).toBe(apiKey);
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

  describe("encryptAllKeys", () => {
    it("should encrypt all keys containing 'apikey'", async () => {
      const settings = {
        enableEncryption: true,
        openAIApiKey: "testApiKey",
        cohereApiKey: "anotherTestApiKey",
        userSystemPrompt: "shouldBeIgnored",
      } as unknown as CopilotSettings;

      const newSettings = await encryptAllKeys(settings);
      expect(newSettings.openAIApiKey).toMatch(/^enc_(desk|web)_[A-Za-z0-9+/=]+$/);
      expect(newSettings.cohereApiKey).toMatch(/^enc_(desk|web)_[A-Za-z0-9+/=]+$/);
      expect(newSettings.userSystemPrompt).toBe("shouldBeIgnored");

      // Verify we can decrypt the keys back
      const decryptedOpenAI = await getDecryptedKey(newSettings.openAIApiKey);
      const decryptedCohere = await getDecryptedKey(newSettings.cohereApiKey);
      expect(decryptedOpenAI).toBe("testApiKey");
      expect(decryptedCohere).toBe("anotherTestApiKey");
    });

    it("should not encrypt keys when encryption is not enabled", async () => {
      const newSettings = await encryptAllKeys({
        enableEncryption: false,
        openAIApiKey: "testApiKey",
        cohereApiKey: "anotherTestApiKey",
        userSystemPrompt: "shouldBeIgnored",
      } as unknown as CopilotSettings);
      expect(newSettings.openAIApiKey).toBe("testApiKey");
      expect(newSettings.cohereApiKey).toBe("anotherTestApiKey");
      expect(newSettings.userSystemPrompt).toBe("shouldBeIgnored");
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

  it("should encrypt and decrypt consistently on mobile", async () => {
    // Mock as mobile by making safeStorage unavailable
    mockElectron.remote.safeStorage.isEncryptionAvailable.mockReturnValue(false);

    const originalKey = "testApiKey";
    const encryptedKey = await getEncryptedKey(originalKey);
    expect(encryptedKey).toMatch(/^enc_(desk|web)_[A-Za-z0-9+/=]+$/);

    // Reset the mock counts before decryption
    mockSubtle.encrypt.mockClear();
    mockSubtle.decrypt.mockClear();

    const decryptedKey = await getDecryptedKey(encryptedKey);
    expect(decryptedKey).toBe(originalKey);

    // On mobile, we should use Web Crypto API for decryption
    expect(mockSubtle.decrypt).toHaveBeenCalled();
  });

  it("should be able to decrypt mobile-encrypted keys on desktop", async () => {
    // First encrypt on mobile
    mockElectron.remote.safeStorage.isEncryptionAvailable.mockReturnValue(false);

    const originalKey = "testApiKey";
    const mobileEncryptedKey = await getEncryptedKey(originalKey);
    expect(mobileEncryptedKey).toMatch(/^enc_(desk|web)_[A-Za-z0-9+/=]+$/);
    expect(mockSubtle.encrypt).toHaveBeenCalled();

    // Reset the mock counts before desktop decryption
    mockSubtle.encrypt.mockClear();
    mockSubtle.decrypt.mockClear();

    // Then decrypt on desktop
    mockElectron.remote.safeStorage.isEncryptionAvailable.mockReturnValue(true);
    const decryptedKey = await getDecryptedKey(mobileEncryptedKey);
    expect(decryptedKey).toBe(originalKey);
  });
});
