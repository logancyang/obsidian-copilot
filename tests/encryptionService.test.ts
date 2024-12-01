import { getDecryptedKey, getEncryptedKey, encryptAllKeys } from "@/encryptionService";
import { Platform } from "obsidian";
import { type CopilotSettings } from "@/settings/model";

// Mocking Electron's safeStorage
jest.mock("electron", () => {
  return {
    remote: {
      safeStorage: {
        encryptString: jest.fn().mockImplementation((text) => `encrypted_${text}`),
        decryptString: jest
          .fn()
          .mockImplementation((buffer) => buffer.toString().replace("encrypted_", "")),
        isEncryptionAvailable: jest.fn().mockReturnValue(true),
      },
    },
  };
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
    it("should encrypt an API key", () => {
      const apiKey = "testApiKey";
      const encryptedKey = getEncryptedKey(apiKey);
      expect(encryptedKey).toBe(`enc_encrypted_${apiKey}`);
    });

    it("should return the original key if already encrypted", () => {
      const apiKey = "enc_testApiKey";
      const encryptedKey = getEncryptedKey(apiKey);
      expect(encryptedKey).toBe(apiKey);
    });
  });

  describe("getDecryptedKey", () => {
    it("should decrypt an encrypted API key", () => {
      const apiKey = "testApiKey";
      const mockEncryptedKey = `encrypted_${apiKey}`;
      const base64Encoded = Buffer.from(mockEncryptedKey).toString("base64");
      const encryptedKey = `enc_${base64Encoded}`;

      const decryptedKey = getDecryptedKey(encryptedKey);
      expect(decryptedKey).toBe(apiKey);
    });

    it("should return the original key if it is in plain text", () => {
      const apiKey = "testApiKey";
      const decryptedKey = getDecryptedKey(apiKey);
      expect(decryptedKey).toBe(apiKey);
    });
  });

  describe("encryptAllKeys", () => {
    it('should encrypt all keys containing "apikey"', () => {
      const newSettings = encryptAllKeys({
        enableEncryption: true,
        openAIApiKey: "testApiKey",
        cohereApiKey: "anotherTestApiKey",
        userSystemPrompt: "shouldBeIgnored",
      } as unknown as CopilotSettings);
      expect(newSettings.openAIApiKey).toBe("enc_encrypted_testApiKey");
      expect(newSettings.cohereApiKey).toBe("enc_encrypted_anotherTestApiKey");
      expect(newSettings.userSystemPrompt).toBe("shouldBeIgnored");
    });

    it("should not encrypt keys when encryption is not enabled", () => {
      const newSettings = encryptAllKeys({
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
