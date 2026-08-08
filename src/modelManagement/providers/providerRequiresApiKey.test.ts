import type { Provider } from "@/modelManagement/types/persisted";
import { providerRequiresApiKey } from "./providerRequiresApiKey";

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
  it("returns the explicit flag — the only runtime criteria", () => {
    // The flag wins regardless of identity: a hosted catalog provider marked
    // keyless reads keyless; a self-hosted row marked key-requiring reads so.
    expect(
      providerRequiresApiKey(
        provider({ requiresApiKey: false, origin: { kind: "byok", catalogProviderId: "openai" } })
      )
    ).toBe(false);
    expect(
      providerRequiresApiKey(provider({ requiresApiKey: true, baseUrl: "http://localhost:11434" }))
    ).toBe(true);
  });

  it("defaults a flagless row to key-requiring (defensive backstop)", () => {
    // Post-migration every persisted row carries the flag; a stray undefined
    // must never read as keyless or its models would be silently dropped.
    expect(providerRequiresApiKey(provider({ requiresApiKey: undefined }))).toBe(true);
  });
});
