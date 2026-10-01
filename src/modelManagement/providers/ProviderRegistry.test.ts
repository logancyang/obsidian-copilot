import { resetSettings, getSettings, setSettings } from "@/settings/model";
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
  let secrets: SecretStore;
  let adapters: ProviderAdapterRegistry;
  let registry: ProviderRegistry;

  beforeEach(() => {
    resetSettings();
    setSettings({ providers: {} });
    KeychainService.resetInstance();
    const fake = makeFakeApp();
    app = fake.app;
    secrets = fake.secrets;
    KeychainService.getInstance(app);
    adapters = new ProviderAdapterRegistry();
    adapters.register(anthropicStub);
    registry = new ProviderRegistry(app, adapters);
  });

  describe("add()", () => {
    it("persists a new provider with a minted id, its addedAt time, and no API key pointer", async () => {
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
  });

  describe("get()", () => {
    it("returns the persisted row and undefined for an unknown provider", async () => {
      const id = await registry.add({
        providerType: "anthropic",
        displayName: "A",
        origin: { kind: "byok" },
      });
      expect(registry.get(id)).toBe(getSettings().providers[id]);
      expect(registry.get("unknown")).toBeUndefined();
    });
  });

  describe("listByOrigin()", () => {
    it("returns stable references while settings are unchanged", async () => {
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
      const rows = registry.listByOrigin("byok");
      expect(registry.listByOrigin("byok")).toBe(rows);
      expect(rows).toHaveLength(1);
    });
    it("returns the same empty list for every origin that has no providers", () => {
      const empty1 = registry.listByOrigin("byok");
      const empty2 = registry.listByOrigin("copilot-plus");
      expect(empty1).toBe(empty2);
      expect(empty1.length).toBe(0);
    });
  });

  describe("update()", () => {
    it("applies the patch but keeps providerId, addedAt, providerType, and origin unchanged", async () => {
      const id = await registry.add({
        providerType: "anthropic",
        displayName: "Original",
        origin: { kind: "byok" },
      });
      const originalAddedAt = registry.get(id)!.addedAt;

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
    it("rejects an unknown providerId", async () => {
      await expect(registry.update("nope", { displayName: "x" })).rejects.toThrow(/unknown/);
    });
    it("ignores an attempt to overwrite apiKeyKeychainId", async () => {
      const id = await registry.add({
        providerType: "anthropic",
        displayName: "A",
        origin: { kind: "byok" },
      });
      await registry.setApiKey(id, "sk-real");
      const realKeychainId = registry.get(id)!.apiKeyKeychainId;
      expect(realKeychainId).not.toBeNull();

      await registry.update(id, {
        ...({ apiKeyKeychainId: "copilot-v0-provider-attacker" } as Record<string, unknown>),
      });
      expect(registry.get(id)!.apiKeyKeychainId).toBe(realKeychainId);
      expect(await registry.getApiKey(id)).toBe("sk-real");
    });
  });

  describe("setApiKey()", () => {
    it("mints the keychain pointer on the first key and reuses it when the key is rotated", async () => {
      const id = await registry.add({
        providerType: "anthropic",
        displayName: "A",
        origin: { kind: "byok" },
      });
      expect(registry.get(id)!.apiKeyKeychainId).toBeNull();

      await registry.setApiKey(id, "sk-first");
      const firstKeychainId = registry.get(id)!.apiKeyKeychainId;
      const vaultId = KeychainService.getInstance(app).getVaultId();
      expect(firstKeychainId).toBe(`copilot-v${vaultId}-provider-${id}`);
      expect(await registry.getApiKey(id)).toBe("sk-first");

      await registry.setApiKey(id, "sk-rotated");
      expect(registry.get(id)!.apiKeyKeychainId).toBe(firstKeychainId);
      expect(await registry.getApiKey(id)).toBe("sk-rotated");
    });

    it("re-writes a key whose keychain entry went missing behind a live pointer (https://github.com/Brevilabs/obsidian-copilot-private/issues/472)", async () => {
      const id = await registry.add({
        providerType: "anthropic",
        displayName: "A",
        origin: { kind: "byok" },
      });
      await registry.setApiKey(id, "sk-live");
      const keychainId = registry.get(id)!.apiKeyKeychainId!;

      secrets.delete(keychainId);

      await registry.setApiKey(id, "sk-live");
      expect(await registry.getApiKey(id)).toBe("sk-live");
    });
  });

  describe("getApiKey()", () => {
    it("returns null when the provider has no stored key", async () => {
      const id = await registry.add({
        providerType: "anthropic",
        displayName: "Ollama-like",
        origin: { kind: "byok" },
      });
      expect(await registry.getApiKey(id)).toBeNull();
    });
  });

  describe("clearApiKey()", () => {
    it("deletes the stored key and clears the keychain pointer", async () => {
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
  });

  describe("remove()", () => {
    it("deletes the provider row and its stored key", async () => {
      const id = await registry.add({
        providerType: "anthropic",
        displayName: "A",
        origin: { kind: "byok" },
      });
      await registry.setApiKey(id, "sk-x");
      const keychainId = registry.get(id)!.apiKeyKeychainId!;
      await registry.remove(id);
      expect(registry.get(id)).toBeUndefined();
      expect(KeychainService.getInstance(app).getSecretById(keychainId)).toBeNull();
    });
  });

  describe("list()", () => {
    it("returns stable references while settings are unchanged", async () => {
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
      const rows = registry.list();
      expect(registry.list()).toBe(rows);
      expect(rows).toHaveLength(2);
    });
  });

  describe("verify()", () => {
    it("returns the adapter result for the provider's type", async () => {
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

    it("rejects an unknown providerId", async () => {
      await expect(registry.verify("nope")).rejects.toThrow(/unknown/);
    });

    it.each([null, "", "   "])(
      "rejects a missing stored key (%p) without probing a public endpoint (https://github.com/logancyang/obsidian-copilot/issues/3147)",
      async (secret) => {
        const id = await registry.add({
          providerType: "anthropic",
          displayName: "A",
          origin: { kind: "byok" },
          requiresApiKey: true,
        });
        await registry.setApiKey(id, "old-key");
        const pointer = registry.get(id)!.apiKeyKeychainId!;
        if (secret === null) KeychainService.getInstance(app).deleteSecretById(pointer);
        else KeychainService.getInstance(app).setSecretById(pointer, secret);
        const probe = jest.spyOn(adapters, "verifyCredentials");
        expect(await registry.verify(id)).toMatchObject({ ok: false, code: "missing_api_key" });
        expect(probe).not.toHaveBeenCalled();
        expect(registry.get(id)!.apiKeyKeychainId).toBe(pointer);
      }
    );

    it("verifies an optional-auth endpoint without a key but rejects its dangling stored credential (https://github.com/logancyang/obsidian-copilot/issues/3147)", async () => {
      const id = await registry.add({
        providerType: "anthropic",
        displayName: "Local",
        origin: { kind: "byok" },
        requiresApiKey: false,
      });
      expect(await registry.verify(id)).toMatchObject({ ok: true });
      await registry.setApiKey(id, "old-key");
      KeychainService.getInstance(app).deleteSecretById(registry.get(id)!.apiKeyKeychainId!);
      expect(await registry.verify(id)).toMatchObject({ ok: false, code: "missing_api_key" });
    });
  });

  describe("subscribe()", () => {
    it("identifies the changed provider on add/update/remove and key changes (https://github.com/Brevilabs/obsidian-copilot-private/issues/475)", async () => {
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

      await registry.setApiKey(id, "sk-first");
      expect(listener).toHaveBeenCalledTimes(3);

      await registry.setApiKey(id, "sk-rotated");
      expect(listener).toHaveBeenCalledTimes(4);

      await registry.clearApiKey(id);
      expect(listener).toHaveBeenCalledTimes(5);

      await registry.remove(id);
      expect(listener).toHaveBeenCalledTimes(6);
      expect(listener.mock.calls).toEqual(Array.from({ length: 6 }, () => [id]));

      unsubscribe();
      await registry.add({
        providerType: "anthropic",
        displayName: "B",
        origin: { kind: "byok" },
      });
      expect(listener).toHaveBeenCalledTimes(6);
    });

    it("stays silent when a provider is re-registered with the key it already has (https://github.com/Brevilabs/obsidian-copilot-private/issues/472)", async () => {
      const id = await registry.add({
        providerType: "anthropic",
        displayName: "A",
        origin: { kind: "byok" },
      });
      await registry.setApiKey(id, "sk-same");

      const listener = jest.fn();
      registry.subscribe(listener);

      await registry.setApiKey(id, "sk-same");

      expect(listener).not.toHaveBeenCalled();
      expect(await registry.getApiKey(id)).toBe("sk-same");
    });

    it("does not notify Agent consumers for a Quick Chat-only CORS update (https://github.com/logancyang/obsidian-copilot-preview/issues/313)", async () => {
      const id = await registry.add({
        providerType: "openai-compatible",
        displayName: "Work endpoint",
        origin: { kind: "byok" },
      });
      const listener = jest.fn();
      registry.subscribe(listener);

      await registry.update(id, { enableCors: true });

      expect(registry.get(id)?.enableCors).toBe(true);
      expect(listener).not.toHaveBeenCalled();
    });

    it("lets a setApiKey listener read the new key rather than the stale one", async () => {
      const id = await registry.add({
        providerType: "anthropic",
        displayName: "A",
        origin: { kind: "byok" },
      });
      await registry.setApiKey(id, "sk-old");

      const seenInListener: Array<string | null> = [];
      registry.subscribe(() => {
        const row = getSettings().providers[id];
        const keychainId = row?.apiKeyKeychainId ?? null;
        seenInListener.push(
          keychainId ? KeychainService.getInstance(app).getSecretById(keychainId) : null
        );
      });

      await registry.setApiKey(id, "sk-new");
      expect(seenInListener).toEqual(["sk-new"]);
    });

    it("still notifies other listeners when one listener throws", async () => {
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
