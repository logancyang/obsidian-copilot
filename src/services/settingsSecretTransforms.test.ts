import type { CopilotSettings } from "@/settings/model";
import {
  cleanupLegacyFields,
  hasPersistedSecrets,
  isSensitiveKey,
  mapAgentModeSecrets,
  stripKeychainFields,
} from "@/services/settingsSecretTransforms";

function makeSettings(overrides: Partial<CopilotSettings> = {}): CopilotSettings {
  return {
    activeModels: [],
    activeEmbeddingModels: [],
    ...overrides,
  } as unknown as CopilotSettings;
}

function makeAgentMode(
  overrides: Partial<CopilotSettings["agentMode"]> = {}
): CopilotSettings["agentMode"] {
  return {
    byok: {},
    mcpServers: [],
    activeBackend: "opencode",
    backends: {},
    debugFullFrames: false,
    welcomeDismissed: false,
    skills: { folder: "copilot/skills" },
    ...overrides,
  };
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
        name: "detects a provider-scoped Keychain reference",
        rawData: {
          providers: { byok: { apiKeyKeychainId: "copilot-vabcd1234-provider-byok" } },
        },
        expected: true,
      },
      {
        name: "detects nested Agent Mode credentials",
        rawData: {
          agentMode: makeAgentMode({
            byok: { anthropic: "agent-key" },
            backends: { codex: { envOverrides: { OPENAI_API_KEY: "env-key" } } },
          }),
        },
        expected: true,
      },
      {
        name: "ignores malformed model entries and non-secret fields",
        rawData: {
          activeModels: [null, "bad-entry", { name: "gpt-4", provider: "openai" }],
          activeEmbeddingModels: [{ name: "embed", provider: "openai", apiKey: "" }],
          providers: { keyless: { apiKeyKeychainId: null }, malformed: "bad-entry" },
        },
        expected: false,
      },
    ])("$name", ({ rawData, expected }) => {
      expect(hasPersistedSecrets(rawData as Record<string, unknown>)).toBe(expected);
    });
  });

  describe("mapAgentModeSecrets()", () => {
    it("maps nested credentials without changing non-secret values or mutating input", () => {
      const settings = makeSettings({
        agentMode: makeAgentMode({
          byok: { anthropic: "byok-key" },
          backends: {
            codex: { envOverrides: { OPENAI_API_KEY: "env-key", HOME: "/tmp/home" } },
          },
          mcpServers: [
            {
              id: "server-1",
              transport: "http",
              headers: [{ name: "Authorization", value: "Bearer token" }],
            },
          ],
        }),
      });

      const paths: string[] = [];
      const mapped = mapAgentModeSecrets(settings, (path, value) => {
        paths.push(path.join("/"));
        return `mapped:${value}`;
      });

      expect(mapped.agentMode.byok.anthropic).toBe("mapped:byok-key");
      expect(mapped.agentMode.backends.codex?.envOverrides).toEqual({
        OPENAI_API_KEY: "mapped:env-key",
        HOME: "mapped:/tmp/home",
      });
      expect(
        (mapped.agentMode.mcpServers[0] as { headers: Array<{ value: string }> }).headers[0].value
      ).toBe("mapped:Bearer token");
      expect(paths).toContain("mcpServers/id:server-1/headers/0/value");
      expect(settings.agentMode.byok.anthropic).toBe("byok-key");
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
        agentMode: makeAgentMode({
          byok: { anthropic: "agent-secret" },
          backends: {
            codex: { envOverrides: { OPENAI_API_KEY: "env-secret", HOME: "/tmp/home" } },
          },
        }),
      });

      const result = stripKeychainFields(settings);

      expect(result).not.toBe(settings);
      expect(result.openAIApiKey).toBe("");
      expect(result.defaultModelKey).toBe("gpt-4|openai");
      expect(result.activeModels[0].apiKey).toBe("");
      expect(result.activeEmbeddingModels[0].apiKey).toBe("");
      expect(result.agentMode.byok.anthropic).toBe("");
      expect(result.agentMode.backends.codex?.envOverrides).toEqual({
        OPENAI_API_KEY: "",
        HOME: "",
      });
      expect(settings.openAIApiKey).toBe("sk-123");
      expect(settings.activeModels[0].apiKey).toBe("chat-secret");
      expect(settings.agentMode.byok.anthropic).toBe("agent-secret");
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
