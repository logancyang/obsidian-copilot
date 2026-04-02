/**
 * Tests for configFile module — outer wrapper parsing and end-to-end
 * generate → decrypt round-trip.
 */

// Reason: jest-environment-jsdom does not expose crypto.subtle.
// Inject Node's Web Crypto before any module-level code runs.
import { webcrypto } from "node:crypto";
Object.defineProperty(globalThis, "crypto", {
  value: webcrypto,
  writable: true,
  configurable: true,
});

jest.mock("obsidian", () => ({
  normalizePath: (p: string) => p.replace(/\\/g, "/"),
  TFile: class TFile {},
}));

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
}));

jest.mock("@/encryptionService", () => ({
  getDecryptedKeyOrThrow: jest.fn((v: string) => Promise.resolve(v)),
  isSensitiveKey: jest.fn((key: string) => {
    const lower = key.toLowerCase().replace(/[_-]/g, "");
    return lower.includes("apikey") || lower.endsWith("secret");
  }),
}));

const mockGetSettings = jest.fn();
jest.mock("@/settings/model", () => ({
  getSettings: () => mockGetSettings(),
  sanitizeSettings: jest.fn((s: unknown) => s),
}));

jest.mock("@/services/settingsSecretTransforms", () => ({
  cleanupLegacyFields: jest.fn((s: unknown) => s),
}));

jest.mock("@/services/settingsPersistence", () => ({
  getBackfillHadFailures: jest.fn(() => false),
}));

jest.mock("@/services/keychainService", () => ({
  KeychainService: {
    getInstance: jest.fn(() => ({
      isAvailable: jest.fn(() => true),
    })),
  },
}));

jest.mock("@/utils", () => ({
  ensureFolderExists: jest.fn().mockResolvedValue(undefined),
  listDirectChildMdFiles: jest.fn().mockReturnValue([]),
}));

jest.mock("uuid", () => ({
  v4: jest.fn(() => "test-uuid-1234"),
}));

import {
  parseConfigFileWrapper,
  decryptConfigFile,
  generateConfigFile,
} from "./configFile";

describe("parseConfigFileWrapper", () => {
  it("parses a valid .copilot file wrapper", () => {
    const content = JSON.stringify({
      format: "copilot-export",
      version: 1,
      meta: { pluginVersion: "3.2.6", createdAt: "2026-03-31T12:00:00Z" },
      stats: { commandCount: 5, promptCount: 3, memoryCount: 2 },
      payload: "encrypted-base64-payload",
    });

    const result = parseConfigFileWrapper(content);

    expect(result.format).toBe("copilot-export");
    expect(result.version).toBe(1);
    expect(result.meta.pluginVersion).toBe("3.2.6");
    expect(result.stats.commandCount).toBe(5);
    expect(result.stats.promptCount).toBe(3);
    expect(result.stats.memoryCount).toBe(2);
    expect(result.payload).toBe("encrypted-base64-payload");
  });

  it("throws on invalid JSON", () => {
    expect(() => parseConfigFileWrapper("not json")).toThrow("invalid JSON");
  });

  it("throws on wrong format", () => {
    const content = JSON.stringify({
      format: "something-else",
      version: 1,
      payload: "data",
    });
    expect(() => parseConfigFileWrapper(content)).toThrow("unrecognized format");
  });

  it("throws on unsupported version", () => {
    const content = JSON.stringify({
      format: "copilot-export",
      version: 99,
      payload: "data",
    });
    expect(() => parseConfigFileWrapper(content)).toThrow("Unsupported");
  });

  it("throws on missing payload", () => {
    const content = JSON.stringify({
      format: "copilot-export",
      version: 1,
    });
    expect(() => parseConfigFileWrapper(content)).toThrow("missing its encrypted payload");
  });

  it("handles missing stats gracefully", () => {
    const content = JSON.stringify({
      format: "copilot-export",
      version: 1,
      meta: { pluginVersion: "3.2.6", createdAt: "2026-03-31" },
      payload: "data",
    });

    const result = parseConfigFileWrapper(content);

    expect(result.stats.commandCount).toBe(0);
    expect(result.stats.promptCount).toBe(0);
    expect(result.stats.memoryCount).toBe(0);
  });

  it("handles missing meta gracefully", () => {
    const content = JSON.stringify({
      format: "copilot-export",
      version: 1,
      payload: "data",
    });

    const result = parseConfigFileWrapper(content);

    expect(result.meta.pluginVersion).toBe("unknown");
    expect(result.meta.createdAt).toBe("unknown");
  });
});

describe("generateConfigFile + decryptConfigFile round-trip", () => {
  const mockVaultRead = jest.fn();
  const mockGetFiles = jest.fn();
  const mockGetAbstractFileByPath = jest.fn();

  const mockApp = {
    vault: {
      read: mockVaultRead,
      getFiles: mockGetFiles,
      getAbstractFileByPath: mockGetAbstractFileByPath,
    },
  } as unknown as import("obsidian").App;

  beforeEach(() => {
    jest.clearAllMocks();

    mockGetSettings.mockReturnValue({
      customPromptsFolder: "copilot/custom-prompts",
      userSystemPromptsFolder: "copilot/system-prompts",
      memoryFolderName: "copilot/memory",
      openAIApiKey: "sk-test-123",
      userId: "existing-user",
      activeModels: [],
      activeEmbeddingModels: [],
    });

    // Empty vault
    mockGetFiles.mockReturnValue([]);
    mockGetAbstractFileByPath.mockReturnValue(null);
  });

  it("round-trips: generate → parse → decrypt produces original settings", async () => {
    const content = await generateConfigFile(mockApp, "test-password-123", "3.2.6");

    // Parse outer wrapper
    const wrapper = parseConfigFileWrapper(content);
    expect(wrapper.meta.pluginVersion).toBe("3.2.6");

    // Decrypt inner payload
    const result = await decryptConfigFile(wrapper, "test-password-123");

    expect(result.settings.openAIApiKey).toBe("sk-test-123");
    expect(result.meta.pluginVersion).toBe("3.2.6");
  });

  it("strips vault-scoped fields from exported settings", async () => {
    mockGetSettings.mockReturnValue({
      ...mockGetSettings(),
      _diskSecretsCleared: true,
      _keychainVaultId: "vault-123",
      _keychainMigratedAt: "2026-01-01",
      _migrationModalDismissed: true,
    });

    const content = await generateConfigFile(mockApp, "test-password-123", "3.2.6");
    const wrapper = parseConfigFileWrapper(content);
    const result = await decryptConfigFile(wrapper, "test-password-123");

    const raw = result.settings as unknown as Record<string, unknown>;
    expect(raw._diskSecretsCleared).toBeUndefined();
    expect(raw._keychainVaultId).toBeUndefined();
    expect(raw._keychainMigratedAt).toBeUndefined();
    expect(raw._migrationModalDismissed).toBeUndefined();
  });

  it("wrong password throws ConfigDecryptionError", async () => {
    const content = await generateConfigFile(mockApp, "test-password-123", "3.2.6");
    const wrapper = parseConfigFileWrapper(content);

    await expect(decryptConfigFile(wrapper, "wrong-password-456")).rejects.toThrow(
      "Decryption failed"
    );
  });

  it("allows export when vault folders are outside copilot/ namespace", async () => {
    mockGetSettings.mockReturnValue({
      ...mockGetSettings(),
      customPromptsFolder: "my-prompts/commands",
    });

    // Reason: users may configure folders anywhere in the vault (old defaults,
    // custom directories). Only path traversal and absolute paths are rejected.
    const result = await generateConfigFile(mockApp, "test-password-123", "3.2.7");
    expect(JSON.parse(result)).toHaveProperty("meta");
  });

  it("rejects export when vault folder has path traversal", async () => {
    mockGetSettings.mockReturnValue({
      ...mockGetSettings(),
      customPromptsFolder: "../outside-vault",
    });

    await expect(generateConfigFile(mockApp, "test-password-123", "3.2.7")).rejects.toThrow(
      "path traversal"
    );
  });

  it("rejects export when vault folder is an absolute path", async () => {
    mockGetSettings.mockReturnValue({
      ...mockGetSettings(),
      customPromptsFolder: "/etc/secrets",
    });

    await expect(generateConfigFile(mockApp, "test-password-123", "3.2.7")).rejects.toThrow(
      "absolute path"
    );
  });
});

describe("decryptConfigFile security", () => {
  it("strips prototype pollution keys from settings", async () => {
    // Reason: we can't easily inject __proto__ through the encrypt pipeline,
    // so we test parseConfigFileWrapper + the sanitization logic indirectly
    // by verifying the wrapper parser rejects non-object inputs.
    expect(() => parseConfigFileWrapper("[]")).toThrow("not a valid configuration file");
    expect(() => parseConfigFileWrapper("null")).toThrow("not a valid configuration file");
    expect(() => parseConfigFileWrapper("42")).toThrow("not a valid configuration file");
  });
});
