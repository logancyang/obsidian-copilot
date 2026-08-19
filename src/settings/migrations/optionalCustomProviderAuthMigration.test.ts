import type { Provider } from "@/modelManagement";
import { planOptionalCustomProviderAuthMigration } from "./optionalCustomProviderAuthMigration";

function provider(overrides: Partial<Provider> = {}): Provider {
  return {
    providerId: "p1",
    providerType: "openai-compatible",
    displayName: "Custom",
    origin: { kind: "byok" },
    requiresApiKey: true,
    apiKeyKeychainId: null,
    addedAt: 0,
    ...overrides,
  };
}

describe("optionalCustomProviderAuthMigration", () => {
  describe("planOptionalCustomProviderAuthMigration()", () => {
    it("makes existing custom OpenAI-compatible BYOK rows optional without dropping their key pointer (https://github.com/logancyang/obsidian-copilot/issues/2895)", () => {
      const next = planOptionalCustomProviderAuthMigration({
        p1: provider({ apiKeyKeychainId: "keychain-p1" }),
      });

      expect(next?.p1.requiresApiKey).toBe(false);
      expect(next?.p1.apiKeyKeychainId).toBe("keychain-p1");
    });

    it("leaves catalog providers, non-BYOK providers, and other provider types unchanged", () => {
      const catalog = provider({
        providerId: "catalog",
        origin: { kind: "byok", catalogProviderId: "openai" },
      });
      const agent = provider({
        providerId: "agent",
        origin: { kind: "agent", agentType: "opencode" },
      });
      const anthropic = provider({ providerId: "anthropic", providerType: "anthropic" });

      const next = planOptionalCustomProviderAuthMigration({ catalog, agent, anthropic });

      expect(next).toBeNull();
    });

    it("returns null when every matching row is already optional", () => {
      expect(
        planOptionalCustomProviderAuthMigration({
          p1: provider({ requiresApiKey: false }),
        })
      ).toBeNull();
      expect(planOptionalCustomProviderAuthMigration({})).toBeNull();
    });
  });
});
