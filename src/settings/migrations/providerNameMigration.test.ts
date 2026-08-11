import type { Provider, ProviderOrigin, ProviderType } from "@/modelManagement";

import { planProviderNameMigration } from "./providerNameMigration";

function provider(
  providerId: string,
  displayName: string,
  addedAt: number,
  providerType: ProviderType = "anthropic",
  origin: ProviderOrigin = { kind: "byok" }
): Provider {
  return {
    providerId,
    providerType,
    displayName,
    addedAt,
    origin,
    apiKeyKeychainId: null,
  };
}

describe("providerNameMigration", () => {
  describe("planProviderNameMigration()", () => {
    it("keeps the oldest duplicate and assigns deterministic case-insensitive suffixes", () => {
      const migrated = planProviderNameMigration({
        newer: provider("provider-z", "openrouter", 20),
        oldest: provider("provider-b", " OpenRouter ", 10),
        tied: provider("provider-a", "OPENROUTER", 10),
      });

      expect(migrated?.oldest.displayName).toBe("OpenRouter 2");
      expect(migrated?.tied.displayName).toBe("OPENROUTER");
      expect(migrated?.newer.displayName).toBe("openrouter 3");
    });

    it("reserves existing suffixed names before assigning duplicate suffixes", () => {
      const migrated = planProviderNameMigration({
        first: provider("provider-a", "OpenRouter", 1),
        duplicate: provider("provider-b", "openrouter", 2),
        reserved: provider("provider-c", "OpenRouter 2", 3),
      });

      expect(migrated?.first.displayName).toBe("OpenRouter");
      expect(migrated?.duplicate.displayName).toBe("openrouter 3");
      expect(migrated?.reserved.displayName).toBe("OpenRouter 2");
    });

    it("repairs blank names across all origins with readable unique fallbacks", () => {
      const migrated = planProviderNameMigration({
        byok: provider("provider-a", " ", 1),
        agent: provider("provider-b", "", 2, "anthropic", { kind: "agent", agentType: "claude" }),
        plus: provider("provider-c", "\t", 3, "openai-compatible", {
          kind: "copilot-plus",
        }),
      });

      expect(migrated?.byok.displayName).toBe("Anthropic Provider");
      expect(migrated?.agent.displayName).toBe("Anthropic Provider 2");
      expect(migrated?.plus.displayName).toBe("Openai Compatible Provider");
    });

    it("returns null and preserves row references when names already satisfy the invariant", () => {
      const first = provider("provider-a", "OpenRouter", 1);
      const second = provider("provider-b", "Anthropic", 2);

      expect(planProviderNameMigration({ first, second })).toBeNull();
    });
  });
});
