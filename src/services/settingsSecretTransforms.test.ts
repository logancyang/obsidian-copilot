import { DEFAULT_SETTINGS } from "@/constants";
import type { CopilotSettings } from "@/settings/model";
import {
  cleanupLegacyFields,
  hasPersistedSecrets,
  isSensitiveKey,
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

  describe("cleanupLegacyFields()", () => {
    it("removes retired settings without mutating the input", () => {
      const settings = makeSettings({
        _keychainVaultId: "abc12345",
        _someFutureField: "future-value",
        enableEncryption: true,
        _keychainMigrated: true,
        _keychainMigratedAt: "2026-04-01T00:00:00.000Z",
        _migrationModalDismissed: true,
        _diskSecretsCleared: true,
        _keychainOnly: true,
        githubCopilotAccessToken: "gho_access",
        githubCopilotToken: "tid=copilot",
        githubCopilotTokenExpiresAt: 1893456000,
        agentMode: {
          ...DEFAULT_SETTINGS.agentMode,
          mcpServers: [
            {
              name: "private",
              transport: "http",
              headers: [{ name: "Authorization", value: "Bearer secret" }],
            },
          ],
        },
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
      expect(result.githubCopilotAccessToken).toBeUndefined();
      expect(result.githubCopilotToken).toBeUndefined();
      expect(result.githubCopilotTokenExpiresAt).toBeUndefined();
      expect((result.agentMode as Record<string, unknown>).mcpServers).toBeUndefined();
      expect(settings as unknown as Record<string, unknown>).toHaveProperty("_keychainOnly", true);
      expect((settings.agentMode as unknown as Record<string, unknown>).mcpServers).toHaveLength(1);
    });
  });
});
