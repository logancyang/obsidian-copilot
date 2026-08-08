/**
 * Tests for `ProviderRegistry`.
 *
 * The keychain is mocked via a fake `SecretStorage` mounted on a fake
 * `App.secretStorage`. The settings store is real (via
 * `resetSettings` / `setSettings`).
 */

import { resetSettings, getSettings } from "@/settings/model";
import { KeychainService } from "@/services/keychainService";

import type { ProviderAdapter } from "./adapters/ProviderAdapter";
import { ProviderAdapterRegistry } from "./adapters/ProviderAdapterRegistry";
import { ProviderRegistry } from "./ProviderRegistry";

import type { App } from "obsidian";
import { z } from "zod";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

type SecretStore = Map<string, string>;

function makeFakeApp(): { app: App; secrets: SecretStore } {
  const secrets: SecretStore = new Map();
  const app = {
    secretStorage: {
      setSecret: (id: string, value: string) => {
        secrets.set(id, value);
      },
      getSecret: (id: string) => (secrets.has(id) ? secrets.get(id)! : null),
      listSecrets: () => Array.from(secrets.keys()),
      deleteSecret: (id: string) => {
        secrets.delete(id);
      },
    },
    vault: {
      // FileSystemAdapter shape is irrelevant for this test — vaultId
      // resolution path falls into the random branch and never touches
      // adapter methods after the first generation.
      adapter: {},
    },
  } as unknown as App;
  return { app, secrets };
}

const anthropicStub: ProviderAdapter = {
  providerType: "anthropic",
  extrasSchema: z.object({}).strict(),
  buildLangChainClient: () => {
    throw new Error("not used in test");
  },
  verifyCredentials: async () => ({
    ok: true,
    message: "stub-ok",
    checkedAt: 42,
  }),
};

describe("ProviderRegistry", () => {
  let app: App;
  let adapters: ProviderAdapterRegistry;
  let registry: ProviderRegistry;

  beforeEach(() => {
    resetSettings();
    KeychainService.resetInstance();
    const fake = makeFakeApp();
    app = fake.app;
    // Eager init so subsequent KeychainService.getInstance() calls inside
    // the registry hit the same singleton.
    KeychainService.getInstance(app);
    adapters = new ProviderAdapterRegistry();
    adapters.register(anthropicStub);
    registry = new ProviderRegistry(app, adapters);
  });

  it("add() mints id, stamps addedAt, persists the row", async () => {
    const before = Date.now();
    const id = await registry.add({
      providerType: "anthropic",
      displayName: "Anthropic (prod)",
      origin: { kind: "byok" },
    });
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);

    const row = registry.get(id);
    expect(row).toBeDefined();
    expect(row?.displayName).toBe("Anthropic (prod)");
    expect(row?.providerType).toBe("anthropic");
    expect(row?.origin).toEqual({ kind: "byok" });
    expect(row?.addedAt).toBeGreaterThanOrEqual(before);
    expect(row?.apiKeyKeychainId).toBeNull();
  });

  it("list() / listByOrigin / listByProviderType return stable references when settings unchanged", async () => {
    await registry.add({
      providerType: "anthropic",
      displayName: "A",
      origin: { kind: "byok" },
    });
    await registry.add({
      providerType: "anthropic",
      displayName: "B",
      origin: { kind: "agent", agentType: "claude" },
    });
    const list1 = registry.list();
    const list2 = registry.list();
    expect(list1).toBe(list2);

    const byok1 = registry.listByOrigin("byok");
    const byok2 = registry.listByOrigin("byok");
    expect(byok1).toBe(byok2);
    expect(byok1.length).toBe(1);

    const ant1 = registry.listByProviderType("anthropic");
    const ant2 = registry.listByProviderType("anthropic");
    expect(ant1).toBe(ant2);
    expect(ant1.length).toBe(2);
  });

  it("empty filtered views reuse a shared frozen empty array", () => {
    const empty1 = registry.listByOrigin("byok");
    const empty2 = registry.listByOrigin("copilot-plus");
    expect(empty1).toBe(empty2);
    expect(empty1.length).toBe(0);
  });

  it("update() merges patch and refuses to mutate providerId / addedAt / providerType / origin", async () => {
    const id = await registry.add({
      providerType: "anthropic",
      displayName: "Original",
      origin: { kind: "byok" },
    });
    const originalAddedAt = registry.get(id)!.addedAt;

    // Bypass the typed Omit to verify the runtime guard strips immutable
    // fields even when callers shove them in via an untyped object.
    // providerType is the adapter-dispatch key and origin determines
    // which settings tab owns the row — both must stay pinned to the
    // values supplied at creation.
    await registry.update(id, {
      displayName: "Renamed",
      baseUrl: "https://example.test",
      ...({
        providerId: "hacked",
        addedAt: 1,
        providerType: "openai",
        origin: { kind: "agent", agentType: "claude" },
      } as Record<string, unknown>),
    });
    const row = registry.get(id)!;
    expect(row.displayName).toBe("Renamed");
    expect(row.baseUrl).toBe("https://example.test");
    expect(row.providerId).toBe(id);
    expect(row.addedAt).toBe(originalAddedAt);
    expect(row.providerType).toBe("anthropic");
    expect(row.origin).toEqual({ kind: "byok" });
  });

  it("update() throws for unknown providerId", async () => {
    await expect(registry.update("nope", { displayName: "x" })).rejects.toThrow(/unknown/);
  });

  it("setApiKey mints apiKeyKeychainId on first call and reuses it on rotation", async () => {
    const id = await registry.add({
      providerType: "anthropic",
      displayName: "A",
      origin: { kind: "byok" },
    });
    expect(registry.get(id)!.apiKeyKeychainId).toBeNull();

    await registry.setApiKey(id, "sk-first");
    const firstKeychainId = registry.get(id)!.apiKeyKeychainId;
    const vaultId = KeychainService.getInstance(app).getVaultId();
    // Vault-namespaced so `KeychainService.clearAllVaultSecrets()` (which
    // filters by `copilot-v{vaultId}-`) sweeps these entries.
    expect(firstKeychainId).toBe(`copilot-v${vaultId}-provider-${id}`);
    expect(await registry.getApiKey(id)).toBe("sk-first");

    await registry.setApiKey(id, "sk-rotated");
    expect(registry.get(id)!.apiKeyKeychainId).toBe(firstKeychainId);
    expect(await registry.getApiKey(id)).toBe("sk-rotated");
  });

  it("update() ignores attempts to overwrite apiKeyKeychainId", async () => {
    const id = await registry.add({
      providerType: "anthropic",
      displayName: "A",
      origin: { kind: "byok" },
    });
    await registry.setApiKey(id, "sk-real");
    const realKeychainId = registry.get(id)!.apiKeyKeychainId;
    expect(realKeychainId).not.toBeNull();

    // Bypass the typed Omit to verify the runtime strip refuses to move
    // the keychain pointer (which would orphan the secret or repoint the
    // row at a keychain entry this registry never wrote).
    await registry.update(id, {
      ...({ apiKeyKeychainId: "copilot-v0-provider-attacker" } as Record<string, unknown>),
    });
    expect(registry.get(id)!.apiKeyKeychainId).toBe(realKeychainId);
    // The real secret is still readable.
    expect(await registry.getApiKey(id)).toBe("sk-real");
  });

  it("getApiKey returns null when the provider has no apiKeyKeychainId", async () => {
    const id = await registry.add({
      providerType: "anthropic",
      displayName: "Ollama-like",
      origin: { kind: "byok" },
    });
    expect(await registry.getApiKey(id)).toBeNull();
  });

  it("clearApiKey drops the keychain entry and clears the pointer", async () => {
    const id = await registry.add({
      providerType: "anthropic",
      displayName: "A",
      origin: { kind: "byok" },
    });
    await registry.setApiKey(id, "sk-x");
    await registry.clearApiKey(id);
    expect(registry.get(id)!.apiKeyKeychainId).toBeNull();
    expect(await registry.getApiKey(id)).toBeNull();
  });

  it("remove() drops the row and the keychain entry", async () => {
    const id = await registry.add({
      providerType: "anthropic",
      displayName: "A",
      origin: { kind: "byok" },
    });
    await registry.setApiKey(id, "sk-x");
    const keychainId = registry.get(id)!.apiKeyKeychainId!;
    await registry.remove(id);
    expect(registry.get(id)).toBeUndefined();
    // Verify keychain side cleaned up by reading raw storage.
    expect(KeychainService.getInstance(app).getSecretById(keychainId)).toBeNull();
  });

  it("verify() dispatches to the adapter for the row's providerType", async () => {
    const id = await registry.add({
      providerType: "anthropic",
      displayName: "A",
      origin: { kind: "byok" },
    });
    await registry.setApiKey(id, "sk-x");
    const result = await registry.verify(id);
    expect(result.ok).toBe(true);
    expect(result.message).toBe("stub-ok");
  });

  it("verify() throws for unknown providerId", async () => {
    await expect(registry.verify("nope")).rejects.toThrow(/unknown/);
  });

  it("settings reflect mutations atomically", async () => {
    const id = await registry.add({
      providerType: "anthropic",
      displayName: "A",
      origin: { kind: "byok" },
    });
    expect(getSettings().providers[id]).toBeDefined();
    await registry.remove(id);
    expect(getSettings().providers[id]).toBeUndefined();
  });

  describe("subscribe()", () => {
    it("fires on add/update/remove and on every setApiKey (including key rotation)", async () => {
      const listener = jest.fn();
      const unsubscribe = registry.subscribe(listener);

      const id = await registry.add({
        providerType: "anthropic",
        displayName: "A",
        origin: { kind: "byok" },
      });
      expect(listener).toHaveBeenCalledTimes(1);

      await registry.update(id, { displayName: "A-renamed" });
      expect(listener).toHaveBeenCalledTimes(2);

      // First setApiKey: fresh keychainId, settings row also updates.
      await registry.setApiKey(id, "sk-first");
      expect(listener).toHaveBeenCalledTimes(3);

      // Rotating the key reuses `apiKeyKeychainId` → settings row is
      // unchanged. The emitter must still fire so subprocess backends
      // (opencode) restart and pick up the new key. This is the case that
      // caused the LM Studio silent-failure diagnostic.
      await registry.setApiKey(id, "sk-rotated");
      expect(listener).toHaveBeenCalledTimes(4);

      await registry.clearApiKey(id);
      expect(listener).toHaveBeenCalledTimes(5);

      await registry.remove(id);
      expect(listener).toHaveBeenCalledTimes(6);

      unsubscribe();
      await registry.add({
        providerType: "anthropic",
        displayName: "B",
        origin: { kind: "byok" },
      });
      expect(listener).toHaveBeenCalledTimes(6);
    });

    // Regression: keychain writes must complete before #emit() fires.
    // Otherwise subscribers reading apiKey inside their listener (e.g. the
    // opencode-restart wiring re-reading provider creds) would observe the
    // prior value and the freshly-set key would be lost until the next emit.
    it("setApiKey listener observes the new key synchronously, not stale state", async () => {
      const id = await registry.add({
        providerType: "anthropic",
        displayName: "A",
        origin: { kind: "byok" },
      });
      await registry.setApiKey(id, "sk-old");

      const seenInListener: Array<string | null> = [];
      registry.subscribe(() => {
        // Read the keychain synchronously inside the listener — mirrors what
        // the opencode-restart wiring does (it queues a respawn that reads
        // the just-emitted credentials). If setApiKey emitted before the
        // keychain write was durable, this snapshot would still be "sk-old".
        const row = getSettings().providers[id];
        const keychainId = row?.apiKeyKeychainId ?? null;
        seenInListener.push(
          keychainId ? KeychainService.getInstance(app).getSecretById(keychainId) : null
        );
      });

      await registry.setApiKey(id, "sk-new");
      expect(seenInListener).toEqual(["sk-new"]);
    });

    it("a throwing listener does not block other listeners", async () => {
      const bad = jest.fn(() => {
        throw new Error("boom");
      });
      const good = jest.fn();
      registry.subscribe(bad);
      registry.subscribe(good);
      await registry.add({
        providerType: "anthropic",
        displayName: "A",
        origin: { kind: "byok" },
      });
      expect(bad).toHaveBeenCalledTimes(1);
      expect(good).toHaveBeenCalledTimes(1);
    });
  });
});
