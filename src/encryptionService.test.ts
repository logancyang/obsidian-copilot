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
import { getDecryptedKey, isEncryptedValue, isSensitiveKey } from "@/encryptionService";
import { Buffer } from "buffer";

// Mock btoa/atob for base64 encoding/decoding (binary-safe). jsdom's defaults
// are not binary-safe and break the legacy encrypted-payload round-trips below.
window.btoa = jest
  .fn()
  .mockImplementation((str: string) => Buffer.from(str, "latin1").toString("base64"));
window.atob = jest
  .fn()
  .mockImplementation((str: string) => Buffer.from(str, "base64").toString("latin1"));

/**
 * Ensure `window.localStorage` is usable for tests.
 */
function ensureTestLocalStorage(): { clear: () => void } {
  try {
    const storage = window.localStorage;
    storage.setItem("__copilot_test__", "1");
    storage.removeItem("__copilot_test__");
    return { clear: () => window.localStorage.clear() };
  } catch {
    const data = new Map<string, string>();
    const shim = {
      getItem: jest.fn((key: string) => data.get(key) ?? null),
      setItem: jest.fn((key: string, value: string) => {
        data.set(key, value);
      }),
      removeItem: jest.fn((key: string) => {
        data.delete(key);
      }),
      clear: jest.fn(() => data.clear()),
    };
    Object.defineProperty(window, "localStorage", { value: shim, configurable: true });
    return { clear: () => data.clear() };
  }
}

const testLocalStorage = ensureTestLocalStorage();

let randomCounter = 1;
Object.defineProperty(window.crypto, "getRandomValues", {
  value: jest.fn((arr: Uint8Array) => {
    for (let i = 0; i < arr.length; i++) arr[i] = (randomCounter++ & 0xff);
    return arr;
  }),
  configurable: true,
});

const mockSubtle = {
  digest: jest.fn().mockImplementation(() => Promise.resolve(new Uint8Array(32).buffer)),
  importKey: jest.fn().mockResolvedValue("mockCryptoKey"),
  encrypt: jest.fn().mockImplementation((algorithm, key, data: ArrayBuffer) => {
    const originalText = new TextDecoder().decode(data);
    const iv = (algorithm as { iv?: Uint8Array })?.iv;
    const ivTag = iv ? Array.from(iv.slice(0, 4)).join(",") : "noiv";
    const encryptedText = `${originalText}_encrypted_${ivTag}`;
    return Promise.resolve(new TextEncoder().encode(encryptedText).buffer);
  }),
  decrypt: jest.fn().mockImplementation((algorithm, key, data) => {
    const encryptedText = new TextDecoder().decode(new Uint8Array(data));
    const originalText = encryptedText.replace(/_encrypted_.+$/, "");
    return Promise.resolve(new TextEncoder().encode(originalText).buffer);
  }),
};

Object.defineProperty(window.crypto, "subtle", {
  value: mockSubtle,
  configurable: true,
});

describe("EncryptionService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    randomCounter = 1;
    testLocalStorage.clear();
    mockElectron.remote.safeStorage.isEncryptionAvailable.mockReturnValue(true);
  });

  describe("getDecryptedKey", () => {
    it("should return the original key if it is in plain text", async () => {
      const apiKey = "testApiKey";
      const decryptedKey = await getDecryptedKey(apiKey);
      expect(decryptedKey).toBe(apiKey);
    });

    it("should decrypt CP00 portable payloads", async () => {
      mockElectron.remote.safeStorage.isEncryptionAvailable.mockReturnValue(false);

      const plaintext = "legacyPortableSecret";
      const iv = new Uint8Array(12);
      iv[0] = 1;

      const ciphertext = new Uint8Array(
        await crypto.subtle.encrypt(
          { name: "AES-GCM", iv },
          "mockCryptoKey" as unknown as CryptoKey,
          new TextEncoder().encode(plaintext)
        )
      );

      const cp00 = new Uint8Array([0x43, 0x50, 0x30, 0x30]); // "CP00"
      const payload = new Uint8Array(cp00.length + iv.length + ciphertext.length);
      payload.set(cp00, 0);
      payload.set(iv, cp00.length);
      payload.set(ciphertext, cp00.length + iv.length);

      const base64 = Buffer.from(payload).toString("base64");
      const decrypted = await getDecryptedKey(`enc_web_${base64}`);
      expect(decrypted).toBe(plaintext);
    });

    it("should decrypt legacy fixed-IV enc_web_ payloads", async () => {
      mockElectron.remote.safeStorage.isEncryptionAvailable.mockReturnValue(false);

      const plaintext = "legacyFixedIvSecret";
      const legacyIv = new Uint8Array(12);
      const ciphertext = new Uint8Array(
        await crypto.subtle.encrypt(
          { name: "AES-GCM", iv: legacyIv },
          "mockCryptoKey" as unknown as CryptoKey,
          new TextEncoder().encode(plaintext)
        )
      );

      const base64 = Buffer.from(ciphertext).toString("base64");
      const decrypted = await getDecryptedKey(`enc_web_${base64}`);
      expect(decrypted).toBe(plaintext);
    });

    it("should decrypt CP01 per-device payloads when localStorage key exists", async () => {
      mockElectron.remote.safeStorage.isEncryptionAvailable.mockReturnValue(false);

      // Reason: CP01 uses a per-device AES key stored in localStorage.
      // Seed it so getExistingWebCryptoKey() returns a usable key.
      const keyBytes = new Uint8Array(32);
      window.localStorage.setItem(
        "obsidian-copilot:webcrypto-key:v1",
        Buffer.from(keyBytes).toString("base64")
      );

      const plaintext = "cp01DeviceSecret";
      const iv = new Uint8Array(12);
      iv[0] = 2;

      const ciphertext = new Uint8Array(
        await crypto.subtle.encrypt(
          { name: "AES-GCM", iv },
          "mockCryptoKey" as unknown as CryptoKey,
          new TextEncoder().encode(plaintext)
        )
      );

      const cp01 = new Uint8Array([0x43, 0x50, 0x30, 0x31]); // "CP01"
      const payload = new Uint8Array(cp01.length + iv.length + ciphertext.length);
      payload.set(cp01, 0);
      payload.set(iv, cp01.length);
      payload.set(ciphertext, cp01.length + iv.length);

      const base64 = Buffer.from(payload).toString("base64");
      const decrypted = await getDecryptedKey(`enc_web_${base64}`);
      expect(decrypted).toBe(plaintext);
    });

    it("should return empty string for CP01 when localStorage key is missing", async () => {
      mockElectron.remote.safeStorage.isEncryptionAvailable.mockReturnValue(false);
      // Reason: no key in localStorage — CP01 decryption should fail gracefully.

      const cp01 = new Uint8Array([0x43, 0x50, 0x30, 0x31]); // "CP01"
      const iv = new Uint8Array(12);
      const fakeCiphertext = new Uint8Array([1, 2, 3, 4]);
      const payload = new Uint8Array(cp01.length + iv.length + fakeCiphertext.length);
      payload.set(cp01, 0);
      payload.set(iv, cp01.length);
      payload.set(fakeCiphertext, cp01.length + iv.length);

      const base64 = Buffer.from(payload).toString("base64");
      const result = await getDecryptedKey(`enc_web_${base64}`);
      expect(result).toBe("");
    });

    it("should decrypt legacy enc_ prefix payloads via WebCrypto fallback", async () => {
      mockElectron.remote.safeStorage.isEncryptionAvailable.mockReturnValue(false);

      const plaintext = "legacyEncPrefixSecret";
      const legacyIv = new Uint8Array(12);
      const ciphertext = new Uint8Array(
        await crypto.subtle.encrypt(
          { name: "AES-GCM", iv: legacyIv },
          "mockCryptoKey" as unknown as CryptoKey,
          new TextEncoder().encode(plaintext)
        )
      );

      const base64 = Buffer.from(ciphertext).toString("base64");
      const decrypted = await getDecryptedKey(`enc_${base64}`);
      expect(decrypted).toBe(plaintext);
    });
  });

  describe("getDecryptedKey — failure returns empty string", () => {
    it("should return empty string when safeStorage is unavailable for desktop key", async () => {
      mockElectron.remote.safeStorage.isEncryptionAvailable.mockReturnValue(false);
      const result = await getDecryptedKey("enc_desk_" + Buffer.from("test").toString("base64"));
      expect(result).toBe("");
    });

    it("should return empty string when WebCrypto decryption throws", async () => {
      mockElectron.remote.safeStorage.isEncryptionAvailable.mockReturnValue(false);
      const originalDecrypt = mockSubtle.decrypt.getMockImplementation();
      mockSubtle.decrypt.mockImplementation(() => {
        throw new Error("decrypt boom");
      });

      const result = await getDecryptedKey("enc_web_" + Buffer.from("garbage").toString("base64"));
      expect(result).toBe("");

      mockSubtle.decrypt.mockImplementation(originalDecrypt);
    });
  });

  describe("isEncryptedValue", () => {
    it.each(["enc_desk_abc123", "enc_web_abc123", "enc_abc123"])(
      'should return true for encrypted value "%s"',
      (val) => {
        expect(isEncryptedValue(val)).toBe(true);
      }
    );

    it.each(["sk-abc123", "plaintext-key", ""])(
      'should return false for non-encrypted value "%s"',
      (val) => {
        expect(isEncryptedValue(val)).toBe(false);
      }
    );
  });
});

// ---------------------------------------------------------------------------
// isSensitiveKey (pure function — no mocks needed)
// ---------------------------------------------------------------------------

describe("isSensitiveKey", () => {
  it.each([
    "openAIApiKey",
    "cohereApiKey",
    "anthropicApiKey",
    "plusLicenseKey",
    "githubCopilotAccessToken",
    "githubCopilotToken",
    "clientSecret",
    "refreshToken",
    "apiPassword",
  ])('should return true for sensitive key "%s"', (key) => {
    expect(isSensitiveKey(key)).toBe(true);
  });

  it.each([
    "temperature",
    "userSystemPrompt",
    "defaultModelKey",
    "activeModels",
    "maxTokens",
    "githubCopilotTokenExpiresAt",
    "openAIOrgId",
  ])('should return false for non-sensitive key "%s"', (key) => {
    expect(isSensitiveKey(key)).toBe(false);
  });
});
