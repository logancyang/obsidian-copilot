import type { Provider } from "@/modelManagement/types/persisted";
import { providerNeedsResolvedApiKey, providerRequiresApiKey } from "./providerRequiresApiKey";

function provider(overrides: Partial<Provider> = {}): Provider {
  return {
    providerId: "p1",
    providerType: "openai-compatible",
    displayName: "P",
    origin: { kind: "byok" },
    addedAt: 0,
    apiKeyKeychainId: null,
    ...overrides,
  };
}

describe("providerRequiresApiKey", () => {
  describe("providerRequiresApiKey()", () => {
    it("returns the explicit requiresApiKey flag regardless of catalog id or base URL", () => {
      expect(
        providerRequiresApiKey(
          provider({
            requiresApiKey: false,
            origin: { kind: "byok", catalogProviderId: "openai" },
          })
        )
      ).toBe(false);
      expect(
        providerRequiresApiKey(
          provider({ requiresApiKey: true, baseUrl: "http://localhost:11434" })
        )
      ).toBe(true);
    });

    it("treats a provider without the flag as requiring a key", () => {
      expect(providerRequiresApiKey(provider({ requiresApiKey: undefined }))).toBe(true);
    });
  });

  describe("providerNeedsResolvedApiKey()", () => {
    it("needs a runtime key for required-key providers, Copilot Plus, and optional-key providers with a stored key, but not for an optional-key provider without one (https://github.com/logancyang/obsidian-copilot/issues/2895)", () => {
      expect(providerNeedsResolvedApiKey(provider({ requiresApiKey: true }))).toBe(true);
      expect(
        providerNeedsResolvedApiKey(
          provider({ origin: { kind: "copilot-plus" }, requiresApiKey: false })
        )
      ).toBe(true);
      expect(
        providerNeedsResolvedApiKey(
          provider({ requiresApiKey: false, apiKeyKeychainId: "keychain-p1" })
        )
      ).toBe(true);
      expect(providerNeedsResolvedApiKey(provider({ requiresApiKey: false }))).toBe(false);
    });
  });
});
