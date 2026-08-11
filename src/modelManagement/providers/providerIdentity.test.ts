import {
  allocateUniqueProviderDisplayName,
  buildProviderKeychainId,
  normalizeProviderDisplayName,
  providerDisplayNameKey,
  providerDisplayNameValidationError,
  providerKeychainStableToken,
} from "./providerIdentity";

describe("providerIdentity", () => {
  describe("normalizeProviderDisplayName()", () => {
    it("trims a non-empty provider name", () => {
      expect(normalizeProviderDisplayName("  OpenRouter production  ")).toBe(
        "OpenRouter production"
      );
    });

    it("rejects a blank provider name", () => {
      expect(() => normalizeProviderDisplayName(" \t ")).toThrow(/cannot be empty/i);
    });
  });

  describe("allocateUniqueProviderDisplayName()", () => {
    it("compares names case-insensitively and fills the first available numeric suffix", () => {
      expect(
        allocateUniqueProviderDisplayName(" openrouter ", [
          "OpenRouter",
          "OPENROUTER 2",
          "OpenRouter 4",
        ])
      ).toBe("openrouter 3");
    });

    it("preserves a trimmed name that is not reserved", () => {
      expect(allocateUniqueProviderDisplayName("  Anthropic Prod ", ["Anthropic Dev"])).toBe(
        "Anthropic Prod"
      );
    });
  });

  describe("providerDisplayNameKey()", () => {
    it("normalizes canonical Unicode forms and casing for comparison", () => {
      expect(providerDisplayNameKey(" CAF\u00c9 ")).toBe(providerDisplayNameKey("cafe\u0301"));
    });
  });

  describe("providerDisplayNameValidationError()", () => {
    it("rejects blank and globally duplicate names using the canonical comparison", () => {
      expect(providerDisplayNameValidationError(" \t ", ["OpenRouter"])).toBe(
        "Enter a provider name."
      );
      expect(providerDisplayNameValidationError(" ｏｐｅｎｒｏｕｔｅｒ ", ["OpenRouter"])).toBe(
        "A provider with this name already exists. Choose a different name."
      );
      expect(providerDisplayNameValidationError("OpenRouter 2", ["OpenRouter"])).toBeNull();
    });
  });

  describe("providerKeychainStableToken()", () => {
    it("is deterministic and changes with the immutable provider id", () => {
      expect(providerKeychainStableToken("provider-a")).toBe(
        providerKeychainStableToken("provider-a")
      );
      expect(providerKeychainStableToken("provider-a")).not.toBe(
        providerKeychainStableToken("provider-b")
      );
      expect(providerKeychainStableToken("provider-a")).toMatch(/^[a-f0-9]{8}$/);
    });
  });

  describe("buildProviderKeychainId()", () => {
    it("includes a readable normalized name and stable provider token", () => {
      const first = buildProviderKeychainId(
        "1234abcd",
        "Caf\u00e9 / Open.Router (Prod)",
        "019ff1f2-0da5-7ab2-b3ef-ef40df54b76a"
      );
      const second = buildProviderKeychainId(
        "1234abcd",
        "Caf\u00e9 / Open.Router (Prod)",
        "019ff1f2-0da5-7ab2-b3ef-ef40df54b76a"
      );

      expect(first).toBe(second);
      expect(first).toContain("copilot-v1234abcd-provider-cafe-open-router");
      expect(first).toMatch(/-[a-f0-9]{8}-[a-f0-9]{8}$/);
      expect(first).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    });

    it.each([
      ["punctuation-equivalent slugs", "Open.Router", "Open Router"],
      ["Unicode-only names", "\u6d4b\u8bd5", "\u751f\u4ea7"],
      [
        "long names with the same readable prefix",
        `${"Long Provider ".repeat(8)}First`,
        `${"Long Provider ".repeat(8)}Second`,
      ],
    ])("changes when %s change", (_scenario, firstName, secondName) => {
      const providerId = "019ff1f2-0da5-7ab2-b3ef-ef40df54b76a";
      const firstId = buildProviderKeychainId("1234abcd", firstName, providerId);
      const secondId = buildProviderKeychainId("1234abcd", secondName, providerId);

      expect(firstId).not.toBe(secondId);
      expect(firstId.slice(-8)).toBe(secondId.slice(-8));
    });

    it("encodes Chinese, mixed Unicode, and emoji names into readable safe segments", () => {
      const providerId = "019ff1f2-0da5-7ab2-b3ef-ef40df54b76a";
      const chineseId = buildProviderKeychainId("1234abcd", "\u6d4b\u8bd5", providerId);
      const mixedId = buildProviderKeychainId("1234abcd", "A\u6d4b\ud83d\ude80", providerId);
      const emojiId = buildProviderKeychainId("1234abcd", "\ud83d\ude80", providerId);
      const punctuationId = buildProviderKeychainId("1234abcd", "!!", providerId);

      expect(chineseId).toMatch(/^copilot-v1234abcd-provider-u6d4b-u8bd5-[a-f0-9]{8}-[a-f0-9]{8}$/);
      expect(mixedId).toMatch(
        /^copilot-v1234abcd-provider-a-u6d4b-u1f680-[a-f0-9]{8}-[a-f0-9]{8}$/
      );
      expect(emojiId).toMatch(/^copilot-v1234abcd-provider-u1f680-[a-f0-9]{8}-[a-f0-9]{8}$/);
      expect(punctuationId).toMatch(/^copilot-v1234abcd-provider-u21-u21-[a-f0-9]{8}-[a-f0-9]{8}$/);
    });

    it("caps long encoded IDs at 64 SecretStorage-safe characters", () => {
      const providerId = "019ff1f2-0da5-7ab2-b3ef-ef40df54b76a";
      const longId = buildProviderKeychainId(
        "1234abcd",
        `${"\u6d4b\u8bd5\ud83d\ude80".repeat(12)}${" Very Long Provider Name".repeat(8)}`,
        providerId
      );

      expect(longId.length).toBeLessThanOrEqual(64);
      expect(longId).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(longId).toContain("provider-u6d4b-u8bd5-u1f680");
    });
  });
});
