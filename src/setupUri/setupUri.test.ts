/**
 * Tests for Setup URI business logic (generation, parsing, application).
 *
 * All crypto and external dependencies are mocked so these tests run
 * instantly and focus on orchestration logic.
 */

jest.mock("@/encryptionService", () => ({
  // Reason: use the real isSensitiveKey to ensure tests cover all sensitive
  // field patterns (apiKey, token, secret, password, licenseKey).
  isSensitiveKey: jest.requireActual("@/encryptionService").isSensitiveKey,
  getDecryptedKeyOrThrow: jest.fn(async (val: string) => {
    if (val.startsWith("enc_")) return val.replace(/^enc_/, "");
    return val;
  }),
}));

jest.mock("@/settings/model", () => ({
  getSettings: jest.fn(),
  setSettings: jest.fn(),
  sanitizeSettings: jest.fn((s: unknown) => s),
}));

jest.mock("@/setupUri/crypto", () => ({
  encryptWithPassphrase: jest.fn(async (json: string) => "MOCK_ENCRYPTED_PAYLOAD"),
  decryptWithPassphrase: jest.fn(),
  assertSetupUriPassphrase: jest.fn(),
  MIN_SETUP_URI_PASSPHRASE_LENGTH: 8,
  SetupUriDecryptionError: class SetupUriDecryptionError extends Error {
    constructor(
      public readonly reason: string,
      message: string
    ) {
      super(message);
      this.name = "SetupUriDecryptionError";
    }
  },
}));

jest.mock("@/services/settingsSecretTransforms", () => ({
  cleanupLegacyFields: jest.fn((s: unknown) => {
    // Simulate removing legacy fields
    const copy = { ...(s as Record<string, unknown>) };
    delete copy.enableEncryption;
    delete copy._keychainMigrated;
    return copy;
  }),
}));

jest.mock("uuid", () => ({
  v4: jest.fn(() => "test-uuid-1234"),
}));

import { getDecryptedKeyOrThrow } from "@/encryptionService";
import { getSettings, setSettings, sanitizeSettings } from "@/settings/model";
import { encryptWithPassphrase, decryptWithPassphrase } from "@/setupUri/crypto";
import {
  generateSetupUri,
  extractPayloadFromUri,
  applySetupUri,
  validateSetupUri,
} from "./setupUri";

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// extractPayloadFromUri
// ---------------------------------------------------------------------------
describe("extractPayloadFromUri", () => {
  it("should extract payload from a full obsidian:// URI", () => {
    const result = extractPayloadFromUri("obsidian://copilot-setup?payload=ABC123&v=1");
    expect(result).toBe("ABC123");
  });

  it("should extract payload from URI with trailing slash", () => {
    const result = extractPayloadFromUri("obsidian://copilot-setup/?payload=ABC123&v=1");
    expect(result).toBe("ABC123");
  });

  it("should return bare string as-is for non-URI input", () => {
    expect(extractPayloadFromUri("BARE_PAYLOAD_STRING")).toBe("BARE_PAYLOAD_STRING");
  });

  it("should trim whitespace from input", () => {
    expect(extractPayloadFromUri("  BARE_PAYLOAD  ")).toBe("BARE_PAYLOAD");
  });

  it.each([
    {
      name: "wrong action",
      uri: "obsidian://other-action?payload=X",
      msgSubstr: "expected an obsidian://copilot-setup",
    },
    {
      name: "no query parameters",
      uri: "obsidian://copilot-setup",
      msgSubstr: "expected an obsidian://copilot-setup",
    },
    {
      name: "prefix collision (copilot-setup-evil)",
      uri: "obsidian://copilot-setup-evil?payload=X",
      msgSubstr: "expected an obsidian://copilot-setup",
    },
    {
      name: "missing payload parameter",
      uri: "obsidian://copilot-setup?v=1",
      msgSubstr: "missing payload parameter",
    },
  ])("should throw for $name", ({ uri, msgSubstr }) => {
    expect(() => extractPayloadFromUri(uri)).toThrow(msgSubstr);
  });
});

// ---------------------------------------------------------------------------
// generateSetupUri
// ---------------------------------------------------------------------------
describe("generateSetupUri", () => {
  const mockSettings = {
    openAIApiKey: "enc_sk-test-key",
    temperature: 0.7,
    providerConfigs: { openai: { apiKey: "enc_nested-provider-key" } },
    activeModels: [{ name: "gpt-4", apiKey: "enc_model-key", enabled: true }],
    activeEmbeddingModels: [{ name: "embed-v1", apiKey: "enc_embed-key" }],
  };

  beforeEach(() => {
    (getSettings as jest.Mock).mockReturnValue(mockSettings);
  });

  it("should return a valid obsidian://copilot-setup URI with payload and v params", async () => {
    const uri = await generateSetupUri("password123", "3.2.3");

    expect(uri).toMatch(/^obsidian:\/\/copilot-setup\?payload=.+&v=1$/);
  });

  it("should build envelope with meta and settings, decrypting sensitive fields", async () => {
    await generateSetupUri("password123", "3.2.3");

    // Verify encryptWithPassphrase was called with JSON containing envelope
    const jsonArg = (encryptWithPassphrase as jest.Mock).mock.calls[0][0];
    const envelope = JSON.parse(jsonArg);

    // Meta section
    expect(envelope.meta).toBeDefined();
    expect(envelope.meta.version).toBe(1);
    expect(envelope.meta.pluginVersion).toBe("3.2.3");
    expect(envelope.meta.createdAt).toBeDefined();

    // Settings section — sensitive fields should be decrypted
    expect(envelope.settings.openAIApiKey).toBe("sk-test-key");
    expect(envelope.settings.temperature).toBe(0.7);

    // Model API keys should be decrypted
    expect(envelope.settings.activeModels[0].apiKey).toBe("model-key");
    expect(envelope.settings.activeEmbeddingModels[0].apiKey).toBe("embed-key");

    // Nested provider-specific keys should also be decrypted
    expect(envelope.settings.providerConfigs.openai.apiKey).toBe("nested-provider-key");
  });

  it("should throw when getDecryptedKeyOrThrow fails", async () => {
    (getDecryptedKeyOrThrow as jest.Mock).mockRejectedValueOnce(
      new Error("Failed to decrypt API key.")
    );

    await expect(generateSetupUri("password123", "3.2.3")).rejects.toThrow(/Failed to decrypt/);
  });
});

// ---------------------------------------------------------------------------
// applySetupUri
// ---------------------------------------------------------------------------
describe("applySetupUri", () => {
  const validEnvelope = {
    meta: { version: 1, pluginVersion: "3.2.3", createdAt: "2026-01-01T00:00:00Z" },
    settings: { temperature: 0.5, userId: "old-uuid" },
  };

  beforeEach(() => {
    (decryptWithPassphrase as jest.Mock).mockResolvedValue(JSON.stringify(validEnvelope));
  });

  it("should return sanitized settings and meta without calling setSettings", async () => {
    const result = await applySetupUri("MOCK_PAYLOAD", "password123");

    // Reason: userId is preserved from the payload when present
    expect(sanitizeSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        temperature: 0.5,
        userId: "old-uuid",
      })
    );
    // Reason: applySetupUri must NOT call setSettings to avoid triggering
    // the subscriber save path (which would cause double persistence).
    expect(setSettings).not.toHaveBeenCalled();
    expect(result.settings).toEqual(
      expect.objectContaining({ temperature: 0.5, userId: "old-uuid" })
    );
    expect(result.meta).toEqual({
      version: 1,
      pluginVersion: "3.2.3",
      createdAt: "2026-01-01T00:00:00Z",
    });
  });

  it("should generate userId when payload lacks one", async () => {
    const envelopeNoUser = {
      meta: { version: 1, pluginVersion: "3.2.3", createdAt: "2026-01-01T00:00:00Z" },
      settings: { temperature: 0.5 },
    };
    (decryptWithPassphrase as jest.Mock).mockResolvedValue(JSON.stringify(envelopeNoUser));
    const result = await applySetupUri("MOCK_PAYLOAD", "password123");

    expect(sanitizeSettings).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "test-uuid-1234" })
    );
    expect(result.settings).toEqual(expect.objectContaining({ userId: "test-uuid-1234" }));
  });

  it("should strip prototype-pollution keys at all nesting depths", async () => {
    const maliciousEnvelope = {
      meta: { version: 1, pluginVersion: "3.2.3", createdAt: "2026-01-01T00:00:00Z" },
      settings: {
        temperature: 0.5,
        nested: {
          __proto__: { polluted: true },
          constructor: "evil",
          safe: "value",
        },
      },
    };
    (decryptWithPassphrase as jest.Mock).mockResolvedValue(JSON.stringify(maliciousEnvelope));

    const result = await applySetupUri("MOCK_PAYLOAD", "password123");

    // Reason: sanitizeSettings receives the already-cleaned object, so we
    // verify the call arg doesn't contain dangerous keys at any depth.
    const calledWith = (sanitizeSettings as jest.Mock).mock.calls[0][0];
    expect(calledWith.nested).toBeDefined();
    // Reason: use hasOwn because __proto__ exists as a getter on all objects;
    // we need to verify it was NOT copied as an own property.
    expect(Object.hasOwn(calledWith.nested, "__proto__")).toBe(false);
    expect(Object.hasOwn(calledWith.nested, "constructor")).toBe(false);
    expect(calledWith.nested.safe).toBe("value");
    expect(result.settings).toEqual(expect.objectContaining({ temperature: 0.5 }));
  });

  it("should strip legacy fields and cached auth state from import", async () => {
    const envelopeWithLegacy = {
      meta: { version: 1, pluginVersion: "3.2.3", createdAt: "2026-01-01T00:00:00Z" },
      settings: {
        temperature: 0.5,
        userId: "old-uuid",
        _keychainMigrated: true,
        enableEncryption: true,
        _diskSecretsCleared: true,
        // Reason: cached auth state must not transfer between vaults
        isPlusUser: true,
        selfHostModeValidatedAt: "2026-01-01T00:00:00Z",
        selfHostValidationCount: 5,
      },
    };
    (decryptWithPassphrase as jest.Mock).mockResolvedValue(JSON.stringify(envelopeWithLegacy));
    const result = await applySetupUri("MOCK_PAYLOAD", "password123");

    // Reason: these vault-scoped / legacy fields must NOT transfer between vaults
    expect(result.settings).not.toHaveProperty("_keychainMigrated");
    expect(result.settings).not.toHaveProperty("enableEncryption");
    expect(result.settings).not.toHaveProperty("_diskSecretsCleared");
    // Reason: cached authorization state must be stripped to force fresh entitlement checks
    expect(result.settings).not.toHaveProperty("isPlusUser");
    expect(result.settings).not.toHaveProperty("selfHostModeValidatedAt");
    expect(result.settings).not.toHaveProperty("selfHostValidationCount");
  });

  it("should throw for deeply nested payloads (stack-safety guard)", async () => {
    // Reason: build a payload nested >200 levels deep to trigger the depth limit
    let nested: Record<string, unknown> = { leaf: true };
    for (let i = 0; i < 250; i++) {
      nested = { child: nested };
    }
    const deepEnvelope = {
      meta: { version: 1, pluginVersion: "3.2.3", createdAt: "2026-01-01T00:00:00Z" },
      settings: nested,
    };
    (decryptWithPassphrase as jest.Mock).mockResolvedValue(JSON.stringify(deepEnvelope));

    await expect(applySetupUri("X", "pass")).rejects.toThrow("nested too deeply");
  });

  it("should throw for invalid JSON", async () => {
    (decryptWithPassphrase as jest.Mock).mockResolvedValue("not-json{{{");

    await expect(applySetupUri("X", "pass")).rejects.toThrow("Failed to parse");
  });

  it.each([
    {
      name: "missing meta",
      json: { settings: {} },
      msgSubstr: "missing metadata",
    },
    {
      name: "missing settings",
      json: { meta: { version: 1 } },
      msgSubstr: "missing settings",
    },
    {
      name: "meta is an array",
      json: { meta: [1], settings: {} },
      msgSubstr: "missing metadata",
    },
    {
      name: "settings is an array",
      json: { meta: { version: 1 }, settings: [1, 2] },
      msgSubstr: "missing settings",
    },
    {
      name: "meta.version is not a number",
      json: { meta: { version: "1" }, settings: {} },
      msgSubstr: "invalid version",
    },
    {
      name: "meta.version mismatch (99)",
      json: { meta: { version: 99, pluginVersion: "1.0" }, settings: {} },
      msgSubstr: "Unsupported settings version",
    },
  ])("should throw for $name", async ({ json, msgSubstr }) => {
    (decryptWithPassphrase as jest.Mock).mockResolvedValue(JSON.stringify(json));

    await expect(applySetupUri("X", "pass")).rejects.toThrow(msgSubstr);
  });
});

// ---------------------------------------------------------------------------
// validateSetupUri
// ---------------------------------------------------------------------------
describe("validateSetupUri", () => {
  const validEnvelope = {
    meta: { version: 1, pluginVersion: "3.2.3", createdAt: "2026-01-01T00:00:00Z" },
    settings: { temperature: 0.5, userId: "old-uuid" },
  };

  beforeEach(() => {
    (decryptWithPassphrase as jest.Mock).mockResolvedValue(JSON.stringify(validEnvelope));
  });

  it("should resolve without error for a valid payload", async () => {
    await expect(validateSetupUri("MOCK_PAYLOAD", "password123")).resolves.toBeUndefined();
  });

  it("should NOT call setSettings (validation only, no side effects)", async () => {
    await validateSetupUri("MOCK_PAYLOAD", "password123");

    expect(setSettings).not.toHaveBeenCalled();
  });

  it("should throw SetupUriDecryptionError for a wrong password", async () => {
    const { SetupUriDecryptionError } = jest.requireMock("@/setupUri/crypto");
    (decryptWithPassphrase as jest.Mock).mockRejectedValue(
      new SetupUriDecryptionError("wrong_passphrase", "Wrong password.")
    );

    await expect(validateSetupUri("X", "wrong")).rejects.toThrow("Wrong password.");
  });

  it("should throw for invalid JSON", async () => {
    (decryptWithPassphrase as jest.Mock).mockResolvedValue("not-json{{{");

    await expect(validateSetupUri("X", "pass")).rejects.toThrow("Failed to parse");
  });

  it("should throw for invalid envelope (missing meta)", async () => {
    (decryptWithPassphrase as jest.Mock).mockResolvedValue(JSON.stringify({ settings: {} }));

    await expect(validateSetupUri("X", "pass")).rejects.toThrow("missing metadata");
  });

  it("should throw for unsupported version", async () => {
    (decryptWithPassphrase as jest.Mock).mockResolvedValue(
      JSON.stringify({
        meta: { version: 99, pluginVersion: "1.0", createdAt: "2026-01-01" },
        settings: {},
      })
    );

    await expect(validateSetupUri("X", "pass")).rejects.toThrow("Unsupported settings version");
  });
});
