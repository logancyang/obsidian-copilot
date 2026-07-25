import type CopilotPlugin from "@/main";
import { resolvePiProviderDeps } from "./piProviderDeps";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

jest.mock("@/encryptionService", () => ({
  getDecryptedKey: jest.fn(async (key: string) => `decrypted:${key}`),
}));

const getSettings = jest.fn();
jest.mock("@/settings/model", () => ({
  getSettings: () => getSettings(),
}));

// Mocked so the model-management barrel's module graph (which reads settings at
// module scope) stays out of this suite. The helper's own behavior — default to
// requiring a key when the flag predates the field — is covered in its module.
jest.mock("@/modelManagement", () => ({
  providerRequiresApiKey: (provider: { requiresApiKey?: boolean }) =>
    provider.requiresApiKey ?? true,
}));

function byokRow(overrides: Record<string, unknown> = {}) {
  return {
    providerId: "p1",
    providerType: "openai-compatible",
    displayName: "My endpoint",
    baseUrl: "https://api.example.com/v1",
    requiresApiKey: true,
    origin: { kind: "byok" },
    ...overrides,
  };
}

function pluginWithKey(key: string | null): CopilotPlugin {
  return {
    modelManagement: { providerRegistry: { getApiKey: jest.fn(async () => key) } },
  } as unknown as CopilotPlugin;
}

describe("piProviderDeps", () => {
  describe("resolvePiProviderDeps()", () => {
    beforeEach(() => {
      getSettings.mockReturnValue({
        plusLicenseKey: "license",
        providers: {},
        configuredModels: [],
      });
    });

    it("decrypts the Copilot Plus license key", async () => {
      const deps = await resolvePiProviderDeps(pluginWithKey("k"));

      expect(deps.plusLicenseKey).toBe("decrypted:license");
    });

    it("exposes a user's OpenAI-compatible endpoint with its configured models", async () => {
      getSettings.mockReturnValue({
        plusLicenseKey: "license",
        providers: { p1: byokRow() },
        configuredModels: [
          { configuredModelId: "c1", providerId: "p1", info: { id: "gpt-5.5" } },
          { configuredModelId: "c2", providerId: "p1", info: { id: "gpt-5.5-mini" } },
        ],
      });

      const deps = await resolvePiProviderDeps(pluginWithKey("sk-test"));

      expect(deps.byokProviders).toEqual([
        {
          id: "p1",
          displayName: "My endpoint",
          baseUrl: "https://api.example.com/v1",
          apiKey: "sk-test",
          requiresApiKey: true,
          modelIds: ["gpt-5.5", "gpt-5.5-mini"],
        },
      ]);
    });

    it("skips agent-origin rows so pi never re-consumes its own enrolled models", async () => {
      getSettings.mockReturnValue({
        plusLicenseKey: "license",
        providers: { p1: byokRow({ origin: { kind: "agent", agentType: "pi" } }) },
        configuredModels: [{ configuredModelId: "c1", providerId: "p1", info: { id: "kimi" } }],
      });

      const deps = await resolvePiProviderDeps(pluginWithKey("sk-test"));

      expect(deps.byokProviders).toHaveLength(0);
    });

    it("keeps a keyless local runner, which is usable with no credential", async () => {
      getSettings.mockReturnValue({
        plusLicenseKey: "license",
        providers: {
          local: byokRow({
            providerId: "local",
            displayName: "Ollama",
            baseUrl: "http://localhost:11434/v1",
            requiresApiKey: false,
          }),
        },
        configuredModels: [
          { configuredModelId: "c1", providerId: "local", info: { id: "llama3.2" } },
        ],
      });

      const deps = await resolvePiProviderDeps(pluginWithKey(null));

      expect(deps.byokProviders).toEqual([
        {
          id: "local",
          displayName: "Ollama",
          baseUrl: "http://localhost:11434/v1",
          apiKey: "",
          requiresApiKey: false,
          modelIds: ["llama3.2"],
        },
      ]);
    });

    it("skips rows that cannot answer: wrong type, no key, no models, no base url", async () => {
      getSettings.mockReturnValue({
        plusLicenseKey: "license",
        providers: {
          wrongType: byokRow({ providerId: "wrongType", providerType: "anthropic" }),
          noUrl: byokRow({ providerId: "noUrl", baseUrl: undefined }),
          noModels: byokRow({ providerId: "noModels" }),
        },
        configuredModels: [
          { configuredModelId: "c1", providerId: "wrongType", info: { id: "claude" } },
          { configuredModelId: "c2", providerId: "noUrl", info: { id: "gpt" } },
        ],
      });

      const deps = await resolvePiProviderDeps(pluginWithKey("sk-test"));

      expect(deps.byokProviders).toHaveLength(0);
    });

    it("skips an endpoint that demands a key but has none", async () => {
      getSettings.mockReturnValue({
        plusLicenseKey: "license",
        providers: { p1: byokRow({ requiresApiKey: true }) },
        configuredModels: [{ configuredModelId: "c1", providerId: "p1", info: { id: "gpt-5.5" } }],
      });

      const deps = await resolvePiProviderDeps(pluginWithKey(null));

      expect(deps.byokProviders).toHaveLength(0);
    });

    it("returns the same frozen list when there is nothing to expose", async () => {
      const first = await resolvePiProviderDeps(pluginWithKey("k"));
      const second = await resolvePiProviderDeps(pluginWithKey("k"));

      expect(first.byokProviders).toBe(second.byokProviders);
    });
  });
});
