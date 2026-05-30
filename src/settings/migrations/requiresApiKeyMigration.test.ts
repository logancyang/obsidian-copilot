import type { Provider } from "@/modelManagement";
import { planRequiresApiKeyBackfill } from "./requiresApiKeyMigration";

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

/** Backfilled `requiresApiKey` for a single flagless row, via the planner. */
function backfilledFlag(overrides: Partial<Provider>): boolean | undefined {
  const next = planRequiresApiKeyBackfill({ p1: provider(overrides) });
  return next?.p1.requiresApiKey;
}

describe("planRequiresApiKeyBackfill", () => {
  it("treats catalog-backed BYOK as key-requiring", () => {
    expect(backfilledFlag({ origin: { kind: "byok", catalogProviderId: "anthropic" } })).toBe(true);
  });

  it("treats a self-hosted catalog-less BYOK as keyless", () => {
    expect(backfilledFlag({ baseUrl: "http://localhost:11434/v1" })).toBe(false);
    expect(backfilledFlag({ baseUrl: "http://192.168.1.9:1234/v1" })).toBe(false);
  });

  it("requires a key for a catalog-less BYOK pointed at a public host", () => {
    expect(backfilledFlag({ baseUrl: "https://proxy.example/v1" })).toBe(true);
  });

  it("defaults a catalog-less BYOK with no base URL to key-requiring", () => {
    expect(backfilledFlag({ baseUrl: undefined })).toBe(true);
  });

  it("treats agent-owned and Plus providers as keyless (auth managed elsewhere)", () => {
    expect(backfilledFlag({ origin: { kind: "agent", agentType: "opencode" } })).toBe(false);
    expect(backfilledFlag({ origin: { kind: "copilot-plus" } })).toBe(false);
  });

  it("never overwrites an already-explicit flag", () => {
    // A catalog-backed row the heuristic would call key-requiring stays keyless
    // when explicitly flagged so.
    const next = planRequiresApiKeyBackfill({
      p1: provider({
        requiresApiKey: false,
        origin: { kind: "byok", catalogProviderId: "openai" },
      }),
    });
    expect(next).toBeNull();
  });

  it("returns null when there is nothing to backfill (referential stability)", () => {
    expect(planRequiresApiKeyBackfill({})).toBeNull();
    expect(planRequiresApiKeyBackfill({ p1: provider({ requiresApiKey: true }) })).toBeNull();
  });

  it("backfills only flagless rows, leaving flagged rows untouched", () => {
    const flagged = provider({ providerId: "p2", requiresApiKey: true });
    const next = planRequiresApiKeyBackfill({
      p1: provider({ origin: { kind: "byok", catalogProviderId: "anthropic" } }),
      p2: flagged,
    });
    expect(next?.p1.requiresApiKey).toBe(true);
    expect(next?.p2).toBe(flagged); // unchanged reference
  });
});
