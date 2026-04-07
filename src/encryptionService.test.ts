import { Buffer } from "buffer";
import { TextDecoder, TextEncoder } from "util";

const mockPlatformState = {
  isDesktop: true,
  isDesktopApp: true,
};

jest.mock("obsidian", () => ({
  Platform: mockPlatformState,
}));

const mockSafeStorageState = {
  available: true,
};

const mockElectron = {
  remote: {
    safeStorage: {
      encryptString: jest.fn().mockImplementation((text) => Buffer.from(`${text}_encrypted`)),
      decryptString: jest
        .fn()
        .mockImplementation((buffer) => buffer.toString().replace("_encrypted", "")),
      isEncryptionAvailable: jest.fn().mockImplementation(() => mockSafeStorageState.available),
    },
  },
};

jest.mock("electron", () => mockElectron);

type SettingsState = Record<string, unknown>;

let settingsState: SettingsState = {};

const mockGetSettings = jest.fn(() => settingsState);
const mockUpdateSetting = jest.fn((key: string, value: unknown) => {
  settingsState = {
    ...settingsState,
    [key]: value,
  };
});

jest.mock("@/settings/model", () => ({
  getSettings: () => mockGetSettings(),
  updateSetting: (key: string, value: unknown) => mockUpdateSetting(key, value),
}));

jest.mock("@/logger", () => ({
  logError: jest.fn(),
  logInfo: jest.fn(),
  logWarn: jest.fn(),
}));

global.TextEncoder = TextEncoder as any;
global.TextDecoder = TextDecoder as any;

const mockSubtle = {
  importKey: jest.fn().mockResolvedValue("mockCryptoKey"),
  encrypt: jest.fn().mockImplementation((_algorithm, _key, data) => {
    const originalText = new TextDecoder().decode(data);
    return Promise.resolve(new TextEncoder().encode(`${originalText}_encrypted`).buffer);
  }),
  decrypt: jest.fn().mockImplementation((_algorithm, _key, data) => {
    const encryptedText = new TextDecoder().decode(new Uint8Array(data));
    const originalText = encryptedText.replace("_encrypted", "");
    return Promise.resolve(new TextEncoder().encode(originalText).buffer);
  }),
};

Object.defineProperty(global.crypto, "subtle", {
  value: mockSubtle,
  configurable: true,
});

import {
  encryptAllKeys,
  getDecryptedKey,
  getEncryptedKey,
  getLegacyEncryptionKey,
  isEncryptedValue,
  isLegacyWebCryptoValue,
  isPlainText,
  migrateEncryptionToV2,
} from "@/encryptionService";

/**
 * Reset the local test state between cases.
 */
function resetTestState(): void {
  settingsState = {};
  mockPlatformState.isDesktop = true;
  mockPlatformState.isDesktopApp = true;
  mockSafeStorageState.available = true;
  jest.clearAllMocks();
}

/**
 * Create a legacy Web Crypto payload using the old static key and zero IV.
 */
async function createLegacyWebCryptoValue(
  plaintext: string,
  prefix: "enc_web_" | "enc_" = "enc_web_"
): Promise<string> {
  const legacyKey = await getLegacyEncryptionKey();
  const encodedData = new TextEncoder().encode(plaintext);
  const encryptedData = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: new Uint8Array(12) },
    legacyKey,
    encodedData
  );
  return `${prefix}${Buffer.from(new Uint8Array(encryptedData)).toString("base64")}`;
}

describe("encryptionService", () => {
  beforeEach(() => {
    resetTestState();
  });

  it("encrypts and decrypts using the V2 per-vault Web Crypto format", async () => {
    mockPlatformState.isDesktop = false;
    mockPlatformState.isDesktopApp = false;

    const encryptedKey = await getEncryptedKey("testApiKey");
    expect(encryptedKey.startsWith("enc_v2_")).toBe(true);
    expect(settingsState.encryptionKeyB64).toBeDefined();
    expect(mockUpdateSetting).toHaveBeenCalledWith("encryptionKeyB64", expect.any(String));

    const decryptedKey = await getDecryptedKey(encryptedKey);
    expect(decryptedKey).toBe("testApiKey");
  });

  it("migrates legacy Web Crypto values to V2 and preserves nested model keys", async () => {
    const legacyTopLevel = await createLegacyWebCryptoValue("top-level-secret", "enc_web_");
    const legacyNested = await createLegacyWebCryptoValue("nested-secret", "enc_");

    const migrated = await migrateEncryptionToV2({
      enableEncryption: true,
      openAIApiKey: legacyTopLevel,
      plusLicenseKey: "",
      githubCopilotAccessToken: "",
      githubCopilotToken: "",
      activeModels: [{ apiKey: legacyNested, name: "model-a" } as any],
      activeEmbeddingModels: [{ apiKey: legacyTopLevel, name: "embed-a" } as any],
    } as any);

    expect(migrated).not.toBeNull();
    expect(migrated?.openAIApiKey.startsWith("enc_v2_")).toBe(true);
    const migratedModel = migrated?.activeModels?.[0];
    const migratedEmbeddingModel = migrated?.activeEmbeddingModels?.[0];
    expect(migratedModel?.apiKey?.startsWith("enc_v2_")).toBe(true);
    expect(migratedEmbeddingModel?.apiKey?.startsWith("enc_v2_")).toBe(true);
    expect(await getDecryptedKey(migrated?.openAIApiKey as string)).toBe("top-level-secret");
    expect(await getDecryptedKey(migrated?.activeModels?.[0].apiKey as string)).toBe(
      "nested-secret"
    );
  });

  it("leaves desktop safeStorage values unchanged during migration", async () => {
    const desktopValue = await getEncryptedKey("desktop-secret");
    expect(desktopValue.startsWith("enc_desk_")).toBe(true);

    const migrated = await migrateEncryptionToV2({
      enableEncryption: true,
      openAIApiKey: desktopValue,
      plusLicenseKey: "",
      githubCopilotAccessToken: "",
      githubCopilotToken: "",
      activeModels: [],
      activeEmbeddingModels: [],
    } as any);

    expect(migrated).toBeNull();
  });

  it("returns a controlled failure for enc_desk_ values on non-desktop platforms", async () => {
    const desktopValue = await getEncryptedKey("cross-device-secret");
    expect(desktopValue.startsWith("enc_desk_")).toBe(true);

    mockPlatformState.isDesktop = false;
    mockPlatformState.isDesktopApp = false;

    const decrypted = await getDecryptedKey(desktopValue);
    expect(decrypted).toBe("DESKTOP_KEY_UNAVAILABLE");
  });

  it("classifies encrypted prefixes and skips re-encryption for recognized values", async () => {
    expect(isPlainText("sk-mykey123")).toBe(true);
    expect(isPlainText("enc_desk_xxx")).toBe(false);
    expect(isPlainText("enc_web_xxx")).toBe(false);
    expect(isPlainText("enc_v2_xxx")).toBe(false);
    expect(isPlainText("enc_xxx")).toBe(false);

    expect(isEncryptedValue("enc_desk_xxx")).toBe(true);
    expect(isEncryptedValue("enc_web_xxx")).toBe(true);
    expect(isEncryptedValue("enc_v2_xxx")).toBe(true);
    expect(isEncryptedValue("enc_xxx")).toBe(true);
    expect(isLegacyWebCryptoValue("enc_web_xxx")).toBe(true);
    expect(isLegacyWebCryptoValue("enc_xxx")).toBe(true);
    expect(isLegacyWebCryptoValue("enc_desk_xxx")).toBe(false);
    expect(isLegacyWebCryptoValue("enc_v2_xxx")).toBe(false);

    await expect(getEncryptedKey("enc_desk_xxx")).resolves.toBe("enc_desk_xxx");
    await expect(getEncryptedKey("enc_web_xxx")).resolves.toBe("enc_web_xxx");
    await expect(getEncryptedKey("enc_v2_xxx")).resolves.toBe("enc_v2_xxx");
    await expect(getEncryptedKey("enc_xxx")).resolves.toBe("enc_xxx");
  });

  it("still encrypts all configured keys when encryption is enabled", async () => {
    mockPlatformState.isDesktop = false;
    mockPlatformState.isDesktopApp = false;

    const encrypted = await encryptAllKeys({
      enableEncryption: true,
      openAIApiKey: "one",
      cohereApiKey: "two",
      userSystemPrompt: "ignored",
      activeModels: [{ apiKey: "three", name: "model-a" } as any],
      activeEmbeddingModels: [{ apiKey: "four", name: "embed-a" } as any],
    } as any);

    expect((encrypted as any).openAIApiKey.startsWith("enc_v2_")).toBe(true);
    expect((encrypted as any).cohereApiKey.startsWith("enc_v2_")).toBe(true);
    expect((encrypted as any).activeModels[0].apiKey.startsWith("enc_v2_")).toBe(true);
    expect((encrypted as any).activeEmbeddingModels[0].apiKey.startsWith("enc_v2_")).toBe(true);
  });
});
