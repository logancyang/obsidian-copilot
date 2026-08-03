import type { CopilotSettings } from "@/settings/model";
import {
  cleanupLegacyFields,
  extractLegacyDiskSecrets,
  hasPersistedSecrets,
  isEmptyLegacyDiskSecrets,
  isSensitiveKey,
  mergeLegacyDiskSecrets,
  stripKeychainFields,
} from "@/services/settingsSecretTransforms";

function makeSettings(overrides: Partial<CopilotSettings> = {}): CopilotSettings {
  return {
    activeModels: [],
    activeEmbeddingModels: [],
    ...overrides,
  } as unknown as CopilotSettings;
}

describe("settingsSecretTransforms", () => {
  describe("isSensitiveKey()", () => {
    it.each([
      "openAIApiKey",
      "api_key",
      "githubCopilotToken",
      "accessToken",
      "clientSecret",
      "password",
      "plusLicenseKey",
    ])("recognizes %s as sensitive", (key) => {
      expect(isSensitiveKey(key)).toBe(true);
    });

    it.each(["defaultModelKey", "temperature", "userId", "apiVersion"])(
      "does not classify %s as sensitive",
      (key) => {
        expect(isSensitiveKey(key)).toBe(false);
      }
    );
  });

  describe("hasPersistedSecrets()", () => {
    it.each([
      {
        name: "detects a top-level secret",
        rawData: { openAIApiKey: "sk-123", temperature: 0.7 },
        expected: true,
      },
      {
        name: "ignores an empty top-level secret",
        rawData: { openAIApiKey: "", temperature: 0.7 },
        expected: false,
      },
      {
        name: "detects a chat-model secret",
        rawData: { activeModels: [{ name: "gpt-4", provider: "openai", apiKey: "secret" }] },
        expected: true,
      },
      {
        name: "detects an embedding-model secret",
        rawData: {
          activeEmbeddingModels: [{ name: "embed", provider: "openai", apiKey: "secret" }],
        },
        expected: true,
      },
      {
        name: "ignores malformed model entries and non-secret fields",
        rawData: {
          activeModels: [null, "bad-entry", { name: "gpt-4", provider: "openai" }],
          activeEmbeddingModels: [{ name: "embed", provider: "openai", apiKey: "" }],
        },
        expected: false,
      },
    ])("$name", ({ rawData, expected }) => {
      expect(hasPersistedSecrets(rawData as Record<string, unknown>)).toBe(expected);
    });
  });

  describe("stripKeychainFields()", () => {
    it("clears top-level and model secrets without mutating the input", () => {
      const settings = makeSettings({
        openAIApiKey: "sk-123",
        defaultModelKey: "gpt-4|openai",
        activeModels: [{ name: "gpt-4", provider: "openai", apiKey: "chat-secret", enabled: true }],
        activeEmbeddingModels: [
          { name: "embed", provider: "openai", apiKey: "embed-secret", enabled: true },
        ],
      });

      const result = stripKeychainFields(settings);

      expect(result).not.toBe(settings);
      expect(result.openAIApiKey).toBe("");
      expect(result.defaultModelKey).toBe("gpt-4|openai");
      expect(result.activeModels[0].apiKey).toBe("");
      expect(result.activeEmbeddingModels[0].apiKey).toBe("");
      expect(settings.openAIApiKey).toBe("sk-123");
      expect(settings.activeModels[0].apiKey).toBe("chat-secret");
    });

    it("preserves sparse settings without adding model arrays", () => {
      const result = stripKeychainFields({ openAIApiKey: "secret" } as CopilotSettings);
      const record = result as unknown as Record<string, unknown>;

      expect(record.openAIApiKey).toBe("");
      expect(record.activeModels).toBeUndefined();
      expect(record.activeEmbeddingModels).toBeUndefined();
    });
  });

  describe("extractLegacyDiskSecrets()", () => {
    it("records every non-empty top-level and model secret found on disk", () => {
      const legacy = extractLegacyDiskSecrets({
        openAIApiKey: "disk-key",
        anthropicApiKey: "",
        someOtherField: "not-a-secret",
        activeModels: [
          { name: "custom", provider: "openai", apiKey: "model-key" },
          { name: "bare", provider: "openai", apiKey: "" },
        ],
        activeEmbeddingModels: [{ name: "embed", provider: "openai", apiKey: "embed-key" }],
      });

      expect(legacy.topLevel).toEqual({ openAIApiKey: "disk-key" });
      expect(legacy.models.activeModels).toEqual({ "custom|openai": { apiKey: "model-key" } });
      expect(legacy.models.activeEmbeddingModels).toEqual({
        "embed|openai": { apiKey: "embed-key" },
      });
    });

    it("reports an empty snapshot when the file holds no secrets", () => {
      const legacy = extractLegacyDiskSecrets({
        openAIApiKey: "",
        activeModels: [{ name: "custom", provider: "openai" }],
      });

      expect(isEmptyLegacyDiskSecrets(legacy)).toBe(true);
    });
  });

  describe("mergeLegacyDiskSecrets()", () => {
    it("restores captured disk values into a stripped snapshot", () => {
      const legacy = extractLegacyDiskSecrets({
        openAIApiKey: "disk-key",
        activeModels: [{ name: "custom", provider: "openai", apiKey: "model-key" }],
      });
      const stripped = stripKeychainFields(
        makeSettings({
          openAIApiKey: "",
          activeModels: [{ name: "custom", provider: "openai", apiKey: "" }],
        } as unknown as Partial<CopilotSettings>)
      );

      const merged = mergeLegacyDiskSecrets(stripped, legacy) as unknown as Record<string, unknown>;

      expect(merged.openAIApiKey).toBe("disk-key");
      expect((merged.activeModels as Array<{ apiKey: string }>)[0].apiKey).toBe("model-key");
    });

    it("drops a captured value whose model no longer exists in settings", () => {
      const legacy = extractLegacyDiskSecrets({
        activeModels: [{ name: "removed", provider: "openai", apiKey: "model-key" }],
      });
      const stripped = stripKeychainFields(
        makeSettings({
          activeModels: [{ name: "kept", provider: "openai", apiKey: "" }],
        } as unknown as Partial<CopilotSettings>)
      );

      const merged = mergeLegacyDiskSecrets(stripped, legacy) as unknown as Record<string, unknown>;

      expect((merged.activeModels as Array<{ apiKey: string }>)[0].apiKey).toBe("");
    });

    it("returns the snapshot unchanged when there is nothing captured", () => {
      const stripped = stripKeychainFields(makeSettings({ openAIApiKey: "" }));

      expect(mergeLegacyDiskSecrets(stripped, undefined)).toBe(stripped);
    });
  });

  describe("cleanupLegacyFields()", () => {
    it("removes every legacy encryption and migration marker", () => {
      const settings = makeSettings({
        _keychainVaultId: "abc12345",
        _someFutureField: "future-value",
        enableEncryption: true,
        _keychainMigrated: true,
        _keychainMigratedAt: "2026-04-01T00:00:00.000Z",
        _migrationModalDismissed: true,
        _diskSecretsCleared: true,
        _keychainOnly: true,
      } as unknown as Partial<CopilotSettings>);

      const result = cleanupLegacyFields(settings) as unknown as Record<string, unknown>;

      expect(result).toMatchObject({
        _keychainVaultId: "abc12345",
        _someFutureField: "future-value",
      });
      expect(result.enableEncryption).toBeUndefined();
      expect(result._keychainMigrated).toBeUndefined();
      expect(result._keychainMigratedAt).toBeUndefined();
      expect(result._migrationModalDismissed).toBeUndefined();
      expect(result._diskSecretsCleared).toBeUndefined();
      expect(result._keychainOnly).toBeUndefined();
      expect(settings as unknown as Record<string, unknown>).toHaveProperty("_keychainOnly", true);
    });
  });
});
