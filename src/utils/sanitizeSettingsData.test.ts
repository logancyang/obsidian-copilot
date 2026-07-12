import { REDACTED_VALUE, sanitizeSettingsDataForReport } from "@/utils/sanitizeSettingsData";

/**
 * A realistic disk-mode `data.json` fixture: plaintext secrets at the top
 * level, per-model secrets inside the model arrays, env-var overrides in the
 * agent backend settings, and a legacy encrypted value.
 */
const SECRETS = {
  openAIApiKey: "sk-proj-abc123",
  plusLicenseKey: "plus-license-xyz",
  githubCopilotAccessToken: "gho_accesstoken456",
  modelApiKey: "sk-model-key-789",
  embeddingApiKey: "sk-embed-key-000",
  awsAccessKeyId: "AKIAIOSFODNN7EXAMPLE",
  awsSecretEnvValue: "wJalrXUtnFEMI/K7MDENG",
  legacyEncrypted: "enc_desk_QUJDREVGR0g=",
  userId: "user-12345",
  azureInstance: "my-private-instance",
} as const;

const rawFixture = {
  userId: SECRETS.userId,
  openAIApiKey: SECRETS.openAIApiKey,
  plusLicenseKey: SECRETS.plusLicenseKey,
  githubCopilotAccessToken: SECRETS.githubCopilotAccessToken,
  anthropicApiKey: "",
  azureOpenAIApiInstanceName: SECRETS.azureInstance,
  defaultModelKey: "gpt-4o|openai",
  temperature: 0.7,
  debug: false,
  activeModels: [
    {
      name: "gpt-4o",
      provider: "openai",
      apiKey: SECRETS.modelApiKey,
      baseUrl: "https://api.example.com/v1",
      enabled: true,
    },
    { name: "claude-sonnet", provider: "anthropic", apiKey: "" },
  ],
  activeEmbeddingModels: [
    { name: "text-embedding-3-small", provider: "openai", apiKey: SECRETS.embeddingApiKey },
  ],
  googleApiKey: SECRETS.legacyEncrypted,
  agentMode: {
    activeBackend: "claude",
    backends: {
      claude: {
        envOverrides: {
          AWS_ACCESS_KEY_ID: SECRETS.awsAccessKeyId,
          AWS_SECRET_ACCESS_KEY: SECRETS.awsSecretEnvValue,
          CLAUDE_CONFIG_DIR: "/home/user/.claude",
          EMPTY: "",
        },
      },
    },
    deviceProfiles: {
      "device-a": {
        codex: { binaryPath: "/usr/local/bin/codex", envOverrides: { FOO: "bar" } },
      },
    },
  },
};

describe("sanitizeSettingsDataForReport", () => {
  // The sanitizer preserves structure, so the fixture's own type describes the output.
  const sanitized = sanitizeSettingsDataForReport(rawFixture) as typeof rawFixture;

  it("never leaks any secret value anywhere in the serialized output", () => {
    const serialized = JSON.stringify(sanitized);
    for (const [label, secret] of Object.entries(SECRETS)) {
      expect({ label, leaked: serialized.includes(secret) }).toEqual({ label, leaked: false });
    }
  });

  it("masks top-level API keys, license keys, and tokens", () => {
    expect(sanitized.openAIApiKey).toBe(REDACTED_VALUE);
    expect(sanitized.plusLicenseKey).toBe(REDACTED_VALUE);
    expect(sanitized.githubCopilotAccessToken).toBe(REDACTED_VALUE);
  });

  it("masks per-model apiKey inside model arrays", () => {
    expect(sanitized.activeModels[0].apiKey).toBe(REDACTED_VALUE);
    expect(sanitized.activeEmbeddingModels[0].apiKey).toBe(REDACTED_VALUE);
  });

  it("masks every non-empty envOverrides value at any depth, keeping key names", () => {
    const claudeEnv = sanitized.agentMode.backends.claude.envOverrides;
    expect(claudeEnv).toEqual({
      AWS_ACCESS_KEY_ID: REDACTED_VALUE,
      AWS_SECRET_ACCESS_KEY: REDACTED_VALUE,
      CLAUDE_CONFIG_DIR: REDACTED_VALUE,
      EMPTY: "",
    });
    expect(sanitized.agentMode.deviceProfiles["device-a"].codex.envOverrides).toEqual({
      FOO: REDACTED_VALUE,
    });
  });

  it("masks infrastructure identifiers and userId", () => {
    expect(sanitized.azureOpenAIApiInstanceName).toBe(REDACTED_VALUE);
    expect(sanitized.userId).toBe(REDACTED_VALUE);
  });

  it("masks legacy enc_* values regardless of the key they live under", () => {
    expect(sanitized.googleApiKey).toBe(REDACTED_VALUE);
    const elsewhere = sanitizeSettingsDataForReport({
      someHarmlessField: SECRETS.legacyEncrypted,
    }) as Record<string, unknown>;
    expect(elsewhere.someHarmlessField).toBe(REDACTED_VALUE);
  });

  it("leaves empty sensitive values as-is so 'not configured' stays visible", () => {
    expect(sanitized.anthropicApiKey).toBe("");
    expect(sanitized.activeModels[1].apiKey).toBe("");
  });

  it("passes non-sensitive fields through unchanged", () => {
    expect(sanitized.defaultModelKey).toBe("gpt-4o|openai");
    expect(sanitized.temperature).toBe(0.7);
    expect(sanitized.debug).toBe(false);
    expect(sanitized.activeModels[0].name).toBe("gpt-4o");
    expect(sanitized.activeModels[0].baseUrl).toBe("https://api.example.com/v1");
    expect(sanitized.activeModels[0].enabled).toBe(true);
    expect(sanitized.agentMode.activeBackend).toBe("claude");
    expect(sanitized.agentMode.deviceProfiles["device-a"].codex.binaryPath).toBe(
      "/usr/local/bin/codex"
    );
  });

  it("does not mutate the input object", () => {
    const raw = { openAIApiKey: "sk-live" };
    sanitizeSettingsDataForReport(raw);
    expect(raw.openAIApiKey).toBe("sk-live");
  });

  it("handles non-object inputs gracefully", () => {
    expect(sanitizeSettingsDataForReport(null)).toBeNull();
    expect(sanitizeSettingsDataForReport(undefined)).toBeUndefined();
    expect(sanitizeSettingsDataForReport("plain")).toBe("plain");
    expect(sanitizeSettingsDataForReport(42)).toBe(42);
    expect(sanitizeSettingsDataForReport([1, "a"])).toEqual([1, "a"]);
  });
});
