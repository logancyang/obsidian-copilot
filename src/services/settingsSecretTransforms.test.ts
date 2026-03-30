jest.mock("@/encryptionService", () => ({
  isSensitiveKey: jest.fn((key: string) => {
    const lower = key.toLowerCase();
    const normalized = lower.replace(/[_-]/g, "");
    return (
      normalized.includes("apikey") ||
      lower.endsWith("token") ||
      lower.endsWith("accesstoken") ||
      lower.endsWith("secret") ||
      lower.endsWith("password") ||
      lower.endsWith("licensekey")
    );
  }),
}));

import type { CopilotSettings } from "@/settings/model";
import {
  cleanupLegacyFields,
  hasPersistedSecrets,
  stripKeychainFields,
} from "./settingsSecretTransforms";

/** Create a lightweight settings object for transform tests. */
function makeSettings(overrides: Partial<CopilotSettings> = {}): CopilotSettings {
  return {
    activeModels: [],
    activeEmbeddingModels: [],
    ...overrides,
  } as unknown as CopilotSettings;
}

/** JSON-safe clone helper for mutation assertions. */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("hasPersistedSecrets", () => {
  it.each([
    {
      name: "detects a non-empty top-level sensitive field",
      rawData: { openAIApiKey: "sk-123", temperature: 0.7 },
      expected: true,
    },
    {
      name: "ignores empty top-level secret values",
      rawData: { openAIApiKey: "", temperature: 0.7 },
      expected: false,
    },
    {
      name: "detects model-level apiKey in activeModels",
      rawData: {
        activeModels: [{ name: "gpt-4", provider: "openai", apiKey: "model-secret" }],
      },
      expected: true,
    },
    {
      name: "detects model-level apiKey in activeEmbeddingModels",
      rawData: {
        activeEmbeddingModels: [
          { name: "text-embedding-3-small", provider: "openai", apiKey: "embed-secret" },
        ],
      },
      expected: true,
    },
    {
      name: "ignores non-objects and non-secret fields",
      rawData: {
        googleApiKey: "",
        activeModels: [null, "bad-entry", { name: "gpt-4", provider: "openai" }],
        activeEmbeddingModels: [{ name: "embed", provider: "openai", apiKey: "" }],
      },
      expected: false,
    },
  ])("$name", ({ rawData, expected }) => {
    const before = clone(rawData);
    expect(hasPersistedSecrets(rawData as unknown as Record<string, unknown>)).toBe(expected);
    // Reason: hasPersistedSecrets should be read-only
    expect(rawData).toEqual(before);
  });
});

describe("stripKeychainFields", () => {
  it("strips top-level and model-level secrets", () => {
    const settings = makeSettings({
      openAIApiKey: "sk-123",
      googleApiKey: "g-123",
      defaultModelKey: "gpt-4|openai",
      activeModels: [
        { name: "gpt-4", provider: "openai", apiKey: "chat-secret", enabled: true },
        { name: "claude-3", provider: "anthropic", apiKey: "chat-secret-2", enabled: true },
      ],
      activeEmbeddingModels: [
        { name: "text-embed", provider: "openai", apiKey: "embed-secret", enabled: true },
      ],
    } as Partial<CopilotSettings>);
    const before = clone(settings);

    const result = stripKeychainFields(settings);

    expect(result).not.toBe(settings);
    expect(result.openAIApiKey).toBe("");
    expect(result.googleApiKey).toBe("");
    expect((result as unknown as Record<string, unknown>).defaultModelKey).toBe("gpt-4|openai");
    expect(result.activeModels[0].apiKey).toBe("");
    expect(result.activeModels[1].apiKey).toBe("");
    expect(result.activeEmbeddingModels[0].apiKey).toBe("");
    // Reason: model objects and arrays must be new references to avoid mutation
    expect(result.activeModels).not.toBe(settings.activeModels);
    expect(result.activeModels[0]).not.toBe(settings.activeModels[0]);
    expect(result.activeEmbeddingModels).not.toBe(settings.activeEmbeddingModels);
    // Reason: original should be untouched
    expect(settings).toEqual(before);
  });

  it("preserves non-secret fields when there is nothing to strip", () => {
    const settings = makeSettings({
      temperature: 0.2,
      defaultConversationTag: "copilot",
    } as Partial<CopilotSettings>);

    const result = stripKeychainFields(settings);

    expect((result as unknown as Record<string, unknown>).temperature).toBe(0.2);
    expect((result as unknown as Record<string, unknown>).defaultConversationTag).toBe("copilot");
  });
});

describe("cleanupLegacyFields", () => {
  it("removes enableEncryption and _keychainMigrated", () => {
    const settings = makeSettings({
      openAIApiKey: "sk-123",
      enableEncryption: true,
      _keychainMigrated: true,
    } as unknown as Partial<CopilotSettings>);
    const before = clone(settings);

    const result = cleanupLegacyFields(settings);
    const rec = result as unknown as Record<string, unknown>;

    expect(result).not.toBe(settings);
    expect(rec.enableEncryption).toBeUndefined();
    expect(rec._keychainMigrated).toBeUndefined();
    expect(result.openAIApiKey).toBe("sk-123");
    // Reason: original should be untouched
    expect(settings).toEqual(before);
  });

  it("preserves current migration fields like _diskSecretsCleared", () => {
    const settings = makeSettings({
      _diskSecretsCleared: true,
      _keychainVaultId: "abc12345",
    } as Partial<CopilotSettings>);

    const result = cleanupLegacyFields(settings);
    const rec = result as unknown as Record<string, unknown>;

    expect(rec._diskSecretsCleared).toBe(true);
    expect(rec._keychainVaultId).toBe("abc12345");
  });
});
