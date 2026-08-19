import type { Provider } from "@/modelManagement/types/persisted";
import { providerHasApiKey } from "./providerHasApiKey";

function provider(overrides: Partial<Provider> = {}): Provider {
  return {
    providerId: "p1",
    providerType: "openai-compatible",
    displayName: "P",
    origin: { kind: "byok" },
    addedAt: 0,
    apiKeyKeychainId: "kc-p1",
    ...overrides,
  };
}

function keychainWith(value: string | null) {
  return { getSecretById: jest.fn().mockReturnValue(value) };
}

describe("providerHasApiKey", () => {
  describe("providerHasApiKey()", () => {
    it("returns true only when the pointer's keychain entry holds a value", () => {
      expect(providerHasApiKey(provider(), keychainWith("sk-live"))).toBe(true);
    });

    it("returns false without a pointer, and never consults the keychain", () => {
      const keychain = keychainWith("sk-live");
      expect(providerHasApiKey(provider({ apiKeyKeychainId: null }), keychain)).toBe(false);
      expect(providerHasApiKey(provider({ apiKeyKeychainId: undefined }), keychain)).toBe(false);
      expect(keychain.getSecretById).not.toHaveBeenCalled();
    });

    it("returns false for a missing entry — the pointer alone is not evidence (https://github.com/logancyang/obsidian-copilot-preview/issues/261)", () => {
      // The Delete All Keys shape: the synced pointer survives while this
      // device's entry is gone.
      expect(providerHasApiKey(provider(), keychainWith(null))).toBe(false);
    });

    it("returns false for a tombstoned ('') entry (https://github.com/logancyang/obsidian-copilot-preview/issues/261)", () => {
      expect(providerHasApiKey(provider(), keychainWith(""))).toBe(false);
    });

    it("returns false when the keychain read throws — rendering must not (https://github.com/logancyang/obsidian-copilot-preview/issues/261)", () => {
      const keychain = {
        getSecretById: jest.fn(() => {
          throw new Error("SecretStorage unavailable");
        }),
      };
      expect(providerHasApiKey(provider(), keychain)).toBe(false);
    });
  });
});
