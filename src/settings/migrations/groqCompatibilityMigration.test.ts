import { DEFAULT_SETTINGS } from "@/constants";
import type { CopilotSettings } from "@/settings/model";
import type { Provider } from "@/modelManagement";

import {
  groqOpenAICompatibleBaseUrl,
  planGroqOpenAICompatibility,
} from "./groqCompatibilityMigration";

const provider = (overrides: Partial<Provider> = {}): Provider => ({
  providerId: "groq-provider",
  providerType: "openai-compatible",
  displayName: "Groq",
  baseUrl: "https://api.groq.com",
  apiKeyKeychainId: "secret-pointer",
  requiresApiKey: true,
  enableCors: true,
  extras: { keep: true },
  origin: { kind: "byok", catalogProviderId: "groq" },
  addedAt: 1,
  ...overrides,
});

const settingsWith = (providers: Record<string, Provider>): CopilotSettings => ({
  ...DEFAULT_SETTINGS,
  providers,
  settingsVersion: 16,
});

describe("groqCompatibilityMigration", () => {
  describe("groqOpenAICompatibleBaseUrl()", () => {
    it.each([
      [undefined, "https://api.groq.com/openai/v1"],
      ["", "https://api.groq.com/openai/v1"],
      ["  ", "https://api.groq.com/openai/v1"],
      ["https://api.groq.com", "https://api.groq.com/openai/v1"],
      ["https://api.groq.com/", "https://api.groq.com/openai/v1"],
      ["https://api.groq.com/openai", "https://api.groq.com/openai/v1"],
      ["https://api.groq.com/v1", "https://api.groq.com/openai/v1"],
      [" https://api.groq.com/openai/v1/ ", "https://api.groq.com/openai/v1"],
      ["https://gateway.example/tenant", "https://gateway.example/tenant/openai/v1"],
      ["https://gateway.example/tenant/v1", "https://gateway.example/tenant/openai/v1"],
      ["https://gateway.example/tenant/openai/v1", "https://gateway.example/tenant/openai/v1"],
      ["https://gateway.example/tenant/OPENAI/V1/", "https://gateway.example/tenant/openai/v1"],
    ])("normalizes %s to %s", (baseUrl, expected) => {
      expect(groqOpenAICompatibleBaseUrl(baseUrl)).toBe(expected);
    });
  });

  describe("planGroqOpenAICompatibility()", () => {
    it("updates only Groq BYOK endpoints while retaining provider identity, credentials, and other settings", () => {
      const unaffected = provider({
        providerId: "custom",
        displayName: "Custom",
        origin: { kind: "byok" },
        baseUrl: "https://api.groq.com",
      });
      const input = settingsWith({
        groq: provider(),
        unaffected,
        agent: provider({ origin: { kind: "agent", agentType: "opencode" } }),
      });

      const patch = planGroqOpenAICompatibility(input);

      expect(patch?.providers?.groq).toEqual({
        ...provider(),
        baseUrl: "https://api.groq.com/openai/v1",
      });
      expect(patch?.providers?.unaffected).toBe(unaffected);
      expect(patch?.providers?.agent).toBe(input.providers.agent);
      expect(input.providers.groq.baseUrl).toBe("https://api.groq.com");
      expect(planGroqOpenAICompatibility({ ...input, providers: patch!.providers! })).toBeNull();
    });

    it("returns null when no eligible endpoint needs normalization", () => {
      expect(
        planGroqOpenAICompatibility(
          settingsWith({
            groq: provider({ baseUrl: "https://api.groq.com/openai/v1" }),
            custom: provider({ origin: { kind: "byok" } }),
          })
        )
      ).toBeNull();
    });

    it("normalizes endpoints without requiring or changing a credential pointer", () => {
      const input = settingsWith({
        groq: provider({ apiKeyKeychainId: null, baseUrl: undefined }),
      });
      const patch = planGroqOpenAICompatibility(input);
      expect(patch?.providers?.groq).toMatchObject({
        baseUrl: "https://api.groq.com/openai/v1",
        apiKeyKeychainId: null,
      });
      expect(patch?.providers?.groq.apiKeyKeychainId).toBeNull();
    });
  });
});
