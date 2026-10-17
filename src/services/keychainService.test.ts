jest.mock("obsidian", () => {
  class FileSystemAdapter {
    private readonly _basePath: string;
    constructor(basePath = "/vault/default") {
      this._basePath = basePath;
    }
    getBasePath(): string {
      return this._basePath;
    }
  }

  return {
    App: class App {},
    SecretStorage: class SecretStorage {},
    FileSystemAdapter,
    Notice: jest.fn(),
  };
});

jest.mock("@/settings/model", () => {
  const actual = jest.requireActual<object>("@/settings/model");
  return {
    ...actual,
    getSettings: jest.fn(),
  };
});

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

import { FileSystemAdapter, Notice, type App } from "obsidian";
import { getSettings } from "@/settings/model";
import type { CopilotSettings } from "@/settings/model";
import type { CustomModel } from "@/aiParams";
import type { Provider } from "@/modelManagement";
import {
  KeychainService,
  isCopilotOwnedSecret,
  isSecretKey,
  providerKeychainName,
} from "./keychainService";

function makeSettings(overrides: Partial<CopilotSettings> = {}): CopilotSettings {
  return {
    activeModels: [],
    ...overrides,
  } as unknown as CopilotSettings;
}

function makeModel(overrides: Partial<CustomModel> = {}): CustomModel {
  return {
    name: "gpt-4",
    provider: "openai",
    enabled: true,
    ...overrides,
  };
}

function makeSecretStorage() {
  return {
    getSecret: jest.fn().mockReturnValue(null),
    setSecret: jest.fn(),
    deleteSecret: jest.fn(),
    listSecrets: jest.fn().mockReturnValue([]),
  };
}

function makeMapStorage(entries: Record<string, string>) {
  const secrets = new Map(Object.entries(entries));
  return {
    secrets,
    getSecret: (id: string) => (secrets.has(id) ? secrets.get(id)! : null),
    setSecret: (id: string, value: string) => {
      secrets.set(id, value);
    },
    deleteSecret: (id: string) => {
      secrets.delete(id);
    },
    listSecrets: () => Array.from(secrets.keys()),
  };
}

function makeProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    providerId: "row-1",
    providerType: "anthropic",
    displayName: "Anthropic",
    origin: { kind: "byok", catalogProviderId: "anthropic" },
    addedAt: 0,
    apiKeyKeychainId: null,
    ...overrides,
  };
}

const VAULT_ID = "1234abcd";
const OTHER_VAULT_ID = "0a1b2c3d";

function makeAdapter(basePath: string) {
  const adapter = new FileSystemAdapter();
  (adapter as unknown as { _basePath: string })._basePath = basePath;
  return adapter;
}

function makeApp(options?: {
  basePath?: string;
  adapter?: unknown;
  secretStorage?: object | null;
}) {
  const basePath = options?.basePath ?? "/Users/test/MyVault";
  const hasExplicitStorage = options !== undefined && "secretStorage" in options;
  const secretStorage = hasExplicitStorage ? options.secretStorage : makeSecretStorage();
  return {
    vault: {
      adapter: options?.adapter ?? makeAdapter(basePath),
      getName: jest.fn().mockReturnValue("MyVault"),
      configDir: "test-config-dir",
    },
    secretStorage,
  } as unknown as App;
}

beforeEach(() => {
  jest.clearAllMocks();
  KeychainService.resetInstance();
});

describe("keychainService", () => {
  describe("isSecretKey()", () => {
    it.each(["openAIApiKey", "plusLicenseKey"])("returns true for the secret setting %s", (key) => {
      expect(isSecretKey(key)).toBe(true);
    });

    it.each(["temperature", "defaultModelKey"])("returns false for the plain setting %s", (key) => {
      expect(isSecretKey(key)).toBe(false);
    });
  });

  describe("providerKeychainName()", () => {
    it("names a catalog provider after its catalog id, so every device mints the same name for the vault", () => {
      const provider = makeProvider({ displayName: "My Claude" });

      expect(providerKeychainName(VAULT_ID, provider, { [provider.providerId]: provider })).toBe(
        `copilot-v${VAULT_ID}-provider-anthropic-api-key`
      );
    });

    it("gives the same provider a different name in another vault, so vaults sharing a phone's Keychain keep separate keys", () => {
      const provider = makeProvider();

      expect(providerKeychainName(OTHER_VAULT_ID, provider, {})).not.toBe(
        providerKeychainName(VAULT_ID, provider, {})
      );
    });

    it("names a custom provider after its display name", () => {
      const provider = makeProvider({
        providerType: "openai-compatible",
        displayName: "My Local LLM",
        origin: { kind: "byok" },
      });

      expect(providerKeychainName(VAULT_ID, provider, {})).toBe(
        `copilot-v${VAULT_ID}-provider-my-local-llm-api-key`
      );
    });

    it("names the Copilot Plus provider after plus", () => {
      const provider = makeProvider({ displayName: "Copilot", origin: { kind: "copilot-plus" } });

      expect(providerKeychainName(VAULT_ID, provider, {})).toBe(
        `copilot-v${VAULT_ID}-provider-plus-api-key`
      );
    });

    it("suffixes a name another provider holds but not the provider's own current name", () => {
      const name = `copilot-v${VAULT_ID}-provider-anthropic-api-key`;
      const holder = makeProvider({ providerId: "holder", apiKeyKeychainId: name });
      const candidate = makeProvider({ providerId: "candidate" });

      expect(providerKeychainName(VAULT_ID, candidate, { holder, candidate })).toBe(`${name}-2`);
      expect(providerKeychainName(VAULT_ID, holder, { holder, candidate })).toBe(name);
    });

    it("keeps a collision suffix of any width within Obsidian's 64-character secret id limit", () => {
      const providers: Record<string, Provider> = {};
      for (let i = 0; i < 100; i++) {
        const row = makeProvider({
          providerId: `row-${i}`,
          displayName: "A Very Long Self Hosted Gateway Name That Goes On And On Forever",
          origin: { kind: "byok" },
        });
        row.apiKeyKeychainId = providerKeychainName(VAULT_ID, row, providers);
        providers[row.providerId] = row;
      }

      const names = Object.values(providers).map((row) => row.apiKeyKeychainId!);

      expect(new Set(names).size).toBe(100);
      expect(names[0]).toMatch(
        /^copilot-v1234abcd-provider-a-very-long-[a-z0-9-]*[a-z0-9]-api-key$/
      );
      expect(names[99]).toMatch(/-api-key-100$/);
      expect(Math.max(...names.map((name) => name.length))).toBeLessThanOrEqual(64);
    });
  });

  describe("isCopilotOwnedSecret()", () => {
    it("treats a copilot- name as Copilot-owned", () => {
      expect(isCopilotOwnedSecret(`copilot-v${VAULT_ID}-provider-anthropic-api-key`)).toBe(true);
    });

    it("treats a secret another plugin named as not Copilot-owned", () => {
      expect(isCopilotOwnedSecret("anthropic-api-key")).toBe(false);
    });
  });

  describe("KeychainService", () => {
    describe("migrateProviderNames()", () => {
      function migrate(entries: Record<string, string>, settings: CopilotSettings) {
        const storage = makeMapStorage(entries);
        const service = KeychainService.getInstance(makeApp({ secretStorage: storage }));
        service.setVaultId(VAULT_ID);
        return { storage, service, migrated: service.migrateProviderNames(settings) };
      }

      const legacyPointer = `copilot-v${VAULT_ID}-provider-row-1`;
      const stableName = `copilot-v${VAULT_ID}-provider-anthropic-api-key`;

      it("moves a key from its random-id name to its stable name and rewrites the pointer (https://github.com/logancyang/obsidian-copilot/issues/3618)", () => {
        const { storage, migrated } = migrate(
          { [legacyPointer]: "sk-ant" },
          makeSettings({
            providers: { "row-1": makeProvider({ apiKeyKeychainId: legacyPointer }) },
          })
        );

        expect(migrated.providers["row-1"].apiKeyKeychainId).toBe(stableName);
        expect(storage.secrets.get(stableName)).toBe("sk-ant");
        expect(storage.secrets.has(legacyPointer)).toBe(false);
      });

      it("rewrites a legacy pointer this device never held, so a re-entered key lands on the stable name", () => {
        const { storage, migrated } = migrate(
          {},
          makeSettings({
            providers: { "row-1": makeProvider({ apiKeyKeychainId: legacyPointer }) },
          })
        );

        expect(migrated.providers["row-1"].apiKeyKeychainId).toBe(stableName);
        expect(storage.secrets.has(stableName)).toBe(false);
      });

      it("fills a stable pointer synced from another device with this device's legacy key for the same provider (https://github.com/logancyang/obsidian-copilot/issues/3618)", () => {
        const settings = makeSettings({
          providers: { "row-1": makeProvider({ apiKeyKeychainId: stableName }) },
        });

        const { storage, migrated } = migrate({ [legacyPointer]: "sk-ant-local" }, settings);

        expect(storage.secrets.get(stableName)).toBe("sk-ant-local");
        expect(storage.secrets.has(legacyPointer)).toBe(false);
        expect(migrated).toBe(settings);
      });

      it("leaves an existing stable entry untouched, so a key changed after migration is not reverted", () => {
        const { storage } = migrate(
          { [stableName]: "sk-new", [legacyPointer]: "sk-old" },
          makeSettings({
            providers: { "row-1": makeProvider({ apiKeyKeychainId: legacyPointer }) },
          })
        );

        expect(storage.secrets.get(stableName)).toBe("sk-new");
        expect(storage.secrets.has(legacyPointer)).toBe(false);
      });

      it("does not restore a key deleted from its stable name after migration (https://github.com/logancyang/obsidian-copilot/issues/3618)", () => {
        const { storage, service, migrated } = migrate(
          { [legacyPointer]: "sk-ant" },
          makeSettings({
            providers: { "row-1": makeProvider({ apiKeyKeychainId: legacyPointer }) },
          })
        );

        storage.deleteSecret(stableName);
        service.migrateProviderNames(migrated);

        expect(storage.secrets.size).toBe(0);
      });

      it("leaves another vault's provider entries alone on a Keychain shared between vaults", () => {
        const otherVaultEntry = `copilot-v${OTHER_VAULT_ID}-provider-row-1`;

        const { storage } = migrate(
          { [otherVaultEntry]: "sk-other-vault" },
          makeSettings({ providers: { "row-1": makeProvider({ apiKeyKeychainId: stableName }) } })
        );

        expect(storage.secrets.get(otherVaultEntry)).toBe("sk-other-vault");
        expect(storage.secrets.has(stableName)).toBe(false);
      });

      it("leaves a pointer to another plugin's secret and this vault's legacy entry alone (https://github.com/logancyang/obsidian-copilot/issues/3618)", () => {
        const settings = makeSettings({
          providers: { "row-1": makeProvider({ apiKeyKeychainId: "anthropic-api-key" }) },
        });

        const { storage, migrated } = migrate(
          { "anthropic-api-key": "sk-plugin", [legacyPointer]: "sk-legacy" },
          settings
        );

        expect(migrated).toBe(settings);
        expect(storage.secrets.get("anthropic-api-key")).toBe("sk-plugin");
        expect(storage.secrets.get(legacyPointer)).toBe("sk-legacy");
      });
    });

    describe("getVaultId()", () => {
      it("derives an 8-character hex ID from the desktop vault path", () => {
        const service = KeychainService.getInstance(makeApp({ basePath: "/Users/test/MyVault" }));
        const id = service.getVaultId();

        expect(id).toHaveLength(8);
        expect(/^[0-9a-f]{8}$/.test(id)).toBe(true);
      });

      it("returns the same ID on every call", () => {
        const service = KeychainService.getInstance(makeApp({ basePath: "/Users/test/MyVault" }));
        expect(service.getVaultId()).toBe(service.getVaultId());
      });

      it("falls back to vault name + configDir when no base path is available", () => {
        const service = KeychainService.getInstance(makeApp({ adapter: {} }));
        const id = service.getVaultId();

        expect(id).toHaveLength(8);
        expect(/^[0-9a-f]{8}$/.test(id)).toBe(true);
      });
    });

    describe("deleteSecret()", () => {
      it("removes the vault-namespaced entry for a settings key", () => {
        const secretStorage = makeSecretStorage();
        const service = KeychainService.getInstance(makeApp({ secretStorage }));

        service.deleteSecret("githubCopilotToken");

        expect(secretStorage.deleteSecret).toHaveBeenCalledWith(
          `copilot-v${service.getVaultId()}-github-copilot-token`
        );
      });

      it("falls back to an empty-value tombstone on builds without deleteSecret", () => {
        const secretStorage = makeSecretStorage();
        (secretStorage as unknown as { deleteSecret: unknown }).deleteSecret = undefined;
        const service = KeychainService.getInstance(makeApp({ secretStorage }));

        service.deleteSecret("githubCopilotToken");

        expect(secretStorage.setSecret).toHaveBeenCalledWith(
          `copilot-v${service.getVaultId()}-github-copilot-token`,
          ""
        );
      });
    });

    describe("hydrateFromKeychain()", () => {
      it("honors a keychain tombstone by zeroing the in-memory field", async () => {
        const secretStorage = makeSecretStorage();
        secretStorage.getSecret.mockReturnValue("");
        const service = KeychainService.getInstance(makeApp({ secretStorage }));

        const result = await service.hydrateFromKeychain(
          makeSettings({ openAIApiKey: "leftover-from-disk" })
        );

        expect(result.settings.openAIApiKey).toBe("");
        expect(result.hadFailures).toBe(false);
        expect(secretStorage.setSecret).not.toHaveBeenCalled();
      });

      it("replaces the in-memory value with the keychain value when one exists", async () => {
        const secretStorage = makeSecretStorage();
        secretStorage.getSecret.mockReturnValue("kc-value");
        const service = KeychainService.getInstance(makeApp({ secretStorage }));

        const result = await service.hydrateFromKeychain(
          makeSettings({ openAIApiKey: "stale-disk-value" })
        );

        expect(result.settings.openAIApiKey).toBe("kc-value");
        expect(secretStorage.setSecret).not.toHaveBeenCalled();
      });

      it("leaves the field as-is when the keychain has no entry (null)", async () => {
        const secretStorage = makeSecretStorage();
        secretStorage.getSecret.mockReturnValue(null);
        const service = KeychainService.getInstance(makeApp({ secretStorage }));

        const result = await service.hydrateFromKeychain(makeSettings({ openAIApiKey: "" }));

        expect(result.settings.openAIApiKey).toBe("");
        expect(result.hadFailures).toBe(false);
        expect(secretStorage.setSecret).not.toHaveBeenCalled();
      });

      it("marks hadFailures and skips the field when a keychain read throws", async () => {
        const secretStorage = makeSecretStorage();
        secretStorage.getSecret.mockImplementation(() => {
          throw new Error("locked");
        });
        const service = KeychainService.getInstance(makeApp({ secretStorage }));

        const result = await service.hydrateFromKeychain(makeSettings({ openAIApiKey: "" }));

        expect(result.hadFailures).toBe(true);
        expect(secretStorage.setSecret).not.toHaveBeenCalled();
      });

      it("hydrates model-level apiKey values from the keychain", async () => {
        const secretStorage = makeSecretStorage();
        secretStorage.getSecret.mockReturnValue("kc-model-key");
        const service = KeychainService.getInstance(makeApp({ secretStorage }));

        const result = await service.hydrateFromKeychain(
          makeSettings({
            activeModels: [makeModel({ name: "gpt-4", provider: "openai", apiKey: "" })],
          })
        );

        expect(result.settings.activeModels[0].apiKey).toBe("kc-model-key");
        expect(secretStorage.setSecret).not.toHaveBeenCalled();
      });

      it("hydrates canonical top-level secret fields even when missing from input settings", async () => {
        const secretStorage = makeSecretStorage();
        secretStorage.getSecret.mockImplementation((id: string) =>
          id.endsWith("open-a-i-api-key") ? "sk-recovered" : null
        );
        const service = KeychainService.getInstance(makeApp({ secretStorage }));

        const result = await service.hydrateFromKeychain(makeSettings());

        expect((result.settings as unknown as Record<string, string>).openAIApiKey).toBe(
          "sk-recovered"
        );
        expect(secretStorage.setSecret).not.toHaveBeenCalled();
      });

      it("still hydrates legacy secret keys present on input but not in DEFAULT_SETTINGS", async () => {
        const secretStorage = makeSecretStorage();
        secretStorage.getSecret.mockImplementation((id: string) =>
          id.includes("legacy-provider-api-key") ? "legacy-value" : null
        );
        const service = KeychainService.getInstance(makeApp({ secretStorage }));

        const result = await service.hydrateFromKeychain(
          makeSettings({ legacyProviderApiKey: "" } as unknown as Partial<CopilotSettings>)
        );

        expect((result.settings as unknown as Record<string, string>).legacyProviderApiKey).toBe(
          "legacy-value"
        );
      });
    });

    describe("persistSecrets()", () => {
      it("collects current secrets and tombstones cleared or deleted IDs", () => {
        const service = KeychainService.getInstance(makeApp());

        const current = makeSettings({
          openAIApiKey: "sk-current",
          googleApiKey: "",
          activeModels: [makeModel({ name: "kept", provider: "openai", apiKey: "chat-secret" })],
        });

        const prev = makeSettings({
          openAIApiKey: "sk-prev",
          googleApiKey: "g-prev",
          activeModels: [
            makeModel({ name: "kept", provider: "openai", apiKey: "chat-prev" }),
            makeModel({ name: "deleted", provider: "openai", apiKey: "del-secret" }),
          ],
        });

        const result = service.persistSecrets(current, prev);

        const entryIds = result.secretEntries.map(([id]) => id);
        expect(entryIds.some((id) => id.includes("open-a-i-api-key"))).toBe(true);
        expect(entryIds.some((id) => id.includes("model-api-key-chat"))).toBe(true);

        expect(result.keychainIdsToDelete.some((id) => id.includes("google-api-key"))).toBe(true);
        expect(result.keychainIdsToDelete.some((id) => id.includes("model-api-key-chat"))).toBe(
          true
        );
        expect(current.openAIApiKey).toBe("sk-current");
        expect(current.activeModels[0].apiKey).toBe("chat-secret");
        expect(prev.openAIApiKey).toBe("sk-prev");
        expect(prev.activeModels[0].apiKey).toBe("chat-prev");
      });
    });

    describe("forgetAllSecrets()", () => {
      it("clears vault secrets, strips settings, and notifies the user", async () => {
        const secretStorage = makeSecretStorage();
        const service = KeychainService.getInstance(makeApp({ secretStorage }));
        const vaultId = service.getVaultId();

        secretStorage.listSecrets.mockReturnValue([
          `copilot-v${vaultId}-open-a-i-api-key`,
          "copilot-vother000-google-api-key",
        ]);

        (getSettings as jest.Mock).mockReturnValue(
          makeSettings({
            openAIApiKey: "sk-123",
            activeModels: [makeModel({ apiKey: "model-secret" })],
          })
        );

        const saveData = jest.fn().mockResolvedValue(undefined);
        const syncMemory = jest.fn();

        await service.forgetAllSecrets(saveData, syncMemory);

        expect(secretStorage.deleteSecret).toHaveBeenCalledWith(
          `copilot-v${vaultId}-open-a-i-api-key`
        );
        expect(secretStorage.deleteSecret).not.toHaveBeenCalledWith(
          "copilot-vother000-google-api-key"
        );

        expect(saveData).toHaveBeenCalled();
        const saved = saveData.mock.calls[0][0] as unknown as Record<string, unknown>;
        expect(saved._keychainOnly).toBeUndefined();
        expect(saved.openAIApiKey).toBe("");
        const savedModels = saved.activeModels as Array<Record<string, unknown>>;
        expect(savedModels[0].apiKey).toBe("");

        expect(syncMemory).toHaveBeenCalled();
        const synced = syncMemory.mock.calls[0][0] as unknown as Record<string, unknown>;
        expect(synced.openAIApiKey).toBe("");
        const syncedModels = synced.activeModels as Array<Record<string, unknown>>;
        expect(syncedModels[0].apiKey).toBe("");
        expect(Notice).toHaveBeenCalledWith(
          "All API keys for this vault removed. Please re-enter them."
        );
      });

      it("leaves the keychain untouched and tells the user when saving data.json fails", async () => {
        const secretStorage = makeSecretStorage();
        const service = KeychainService.getInstance(makeApp({ secretStorage }));
        secretStorage.listSecrets.mockReturnValue([]);

        (getSettings as jest.Mock).mockReturnValue(makeSettings({ openAIApiKey: "sk-123" }));

        const saveData = jest.fn().mockRejectedValue(new Error("disk write failed"));
        const syncMemory = jest.fn();

        await service.forgetAllSecrets(saveData, syncMemory);

        expect(secretStorage.deleteSecret).not.toHaveBeenCalled();
        expect(syncMemory).not.toHaveBeenCalled();
        expect(Notice).toHaveBeenCalledWith(
          expect.stringContaining("Failed to remove API keys from data.json")
        );
      });

      it("propagates keychain delete failures after successful disk save so the user can retry", async () => {
        const secretStorage = makeSecretStorage();
        const service = KeychainService.getInstance(makeApp({ secretStorage }));
        const vaultId = service.getVaultId();

        const idA = `copilot-v${vaultId}-open-a-i-api-key`;
        const idB = `copilot-v${vaultId}-google-api-key`;
        secretStorage.listSecrets.mockReturnValue([idA, idB]);

        secretStorage.deleteSecret.mockImplementation((id: string) => {
          if (id === idB) throw new Error("keychain locked");
        });

        (getSettings as jest.Mock).mockReturnValue(makeSettings({ openAIApiKey: "sk-123" }));

        const saveData = jest.fn().mockResolvedValue(undefined);
        const syncMemory = jest.fn();

        await expect(service.forgetAllSecrets(saveData, syncMemory)).rejects.toThrow(
          /Failed to clear 1 keychain/
        );

        expect(saveData).toHaveBeenCalled();
        expect(secretStorage.deleteSecret).toHaveBeenCalledWith(idA);
        expect(syncMemory).toHaveBeenCalled();
      });

      it("refuses to run when Obsidian Keychain is unavailable", async () => {
        const service = KeychainService.getInstance(makeApp({ secretStorage: null }));
        (getSettings as jest.Mock).mockReturnValue(makeSettings({ openAIApiKey: "sk-disk" }));

        const saveData = jest.fn().mockResolvedValue(undefined);
        const syncMemory = jest.fn();

        await expect(service.forgetAllSecrets(saveData, syncMemory)).rejects.toThrow(
          /Secure Storage is unavailable/
        );

        expect(saveData).not.toHaveBeenCalled();
        expect(syncMemory).not.toHaveBeenCalled();
      });

      it("refuses before stripping disk when Keychain entries cannot be enumerated", async () => {
        const secretStorage = makeSecretStorage();
        (secretStorage as unknown as { listSecrets: unknown }).listSecrets = undefined;
        const service = KeychainService.getInstance(makeApp({ secretStorage }));
        (getSettings as jest.Mock).mockReturnValue(makeSettings({ openAIApiKey: "sk-live" }));
        const saveData = jest.fn().mockResolvedValue(undefined);
        const syncMemory = jest.fn();

        await expect(service.forgetAllSecrets(saveData, syncMemory)).rejects.toThrow(
          /does not support enumerating Keychain entries/
        );

        expect(saveData).not.toHaveBeenCalled();
        expect(syncMemory).not.toHaveBeenCalled();
        expect(secretStorage.deleteSecret).not.toHaveBeenCalled();
      });
    });

    describe("removeRetiredEmbeddingSecrets()", () => {
      it("deletes only this vault's embedding-scoped model credentials (https://github.com/logancyang/obsidian-copilot/pull/3094#discussion_r3926692782)", () => {
        const secretStorage = makeSecretStorage();
        const service = KeychainService.getInstance(makeApp({ secretStorage }));
        const vaultId = service.getVaultId();
        const retired = `copilot-v${vaultId}-model-api-key-embedding-text-embedding-3-small`;
        secretStorage.listSecrets.mockReturnValue([
          retired,
          `copilot-v${vaultId}-model-api-key-chat-gpt-4o`,
          `copilot-v${vaultId}-open-a-i-api-key`,
          "copilot-vother000-model-api-key-embedding-text-embedding-3-small",
        ]);

        service.removeRetiredEmbeddingSecrets();

        expect(secretStorage.deleteSecret).toHaveBeenCalledTimes(1);
        expect(secretStorage.deleteSecret).toHaveBeenCalledWith(retired);
      });

      it("leaves entries alone when the build cannot enumerate them", () => {
        const secretStorage = makeSecretStorage();
        (secretStorage as unknown as { listSecrets: unknown }).listSecrets = undefined;
        const service = KeychainService.getInstance(makeApp({ secretStorage }));

        expect(() => service.removeRetiredEmbeddingSecrets()).not.toThrow();
        expect(secretStorage.deleteSecret).not.toHaveBeenCalled();
      });
    });

    describe("clearAllVaultSecrets()", () => {
      it("clears what it can, then throws aggregating the count of failed entries", () => {
        const secretStorage = makeSecretStorage();
        const service = KeychainService.getInstance(makeApp({ secretStorage }));
        const vaultId = service.getVaultId();

        const ok = `copilot-v${vaultId}-open-a-i-api-key`;
        const bad1 = `copilot-v${vaultId}-google-api-key`;
        const bad2 = `copilot-v${vaultId}-cohere-api-key`;
        const foreign = "copilot-vother000-anthropic-api-key";
        secretStorage.listSecrets.mockReturnValue([ok, bad1, bad2, foreign]);

        secretStorage.deleteSecret.mockImplementation((id: string) => {
          if (id === bad1 || id === bad2) throw new Error("os denied");
        });

        expect(() => service.clearAllVaultSecrets()).toThrow(/Failed to clear 2 keychain entries/);

        expect(secretStorage.deleteSecret).toHaveBeenCalledWith(ok);
        expect(secretStorage.deleteSecret).not.toHaveBeenCalledWith(foreign);
      });

      it("throws without touching deleteSecret when listSecrets is not a function", () => {
        const secretStorage = makeSecretStorage();
        (secretStorage as unknown as { listSecrets: unknown }).listSecrets = undefined;
        const service = KeychainService.getInstance(makeApp({ secretStorage }));

        expect(() => service.clearAllVaultSecrets()).toThrow(/does not support listing entries/);
        expect(secretStorage.deleteSecret).not.toHaveBeenCalled();
      });
    });
  });
});
