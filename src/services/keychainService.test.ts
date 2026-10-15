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
import { md5 } from "@/utils/hash";
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

const SYNCED_VAULT_ID = "1234abcd";
const EARLIER_VAULT_ID = "0a1b2c3d";

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
    it("names a catalog provider after its catalog id, so every device mints the same name", () => {
      const provider = makeProvider({ displayName: "My Claude" });

      expect(providerKeychainName(provider, { [provider.providerId]: provider })).toBe(
        "copilot-anthropic-api-key"
      );
    });

    it("names a custom provider after its display name", () => {
      const provider = makeProvider({
        providerType: "openai-compatible",
        displayName: "My Local LLM",
        origin: { kind: "byok" },
      });

      expect(providerKeychainName(provider, {})).toBe("copilot-my-local-llm-api-key");
    });

    it("names the Copilot Plus provider copilot-plus-api-key", () => {
      const provider = makeProvider({ displayName: "Copilot", origin: { kind: "copilot-plus" } });

      expect(providerKeychainName(provider, {})).toBe("copilot-plus-api-key");
    });

    it("suffixes a name another provider holds but not the provider's own current name", () => {
      const holder = makeProvider({
        providerId: "holder",
        apiKeyKeychainId: "copilot-anthropic-api-key",
      });
      const candidate = makeProvider({ providerId: "candidate" });

      expect(providerKeychainName(candidate, { holder, candidate })).toBe(
        "copilot-anthropic-api-key-2"
      );
      expect(providerKeychainName(holder, { holder, candidate })).toBe("copilot-anthropic-api-key");
    });

    it("keeps a long display name within Obsidian's 64-character secret id limit", () => {
      const provider = makeProvider({
        displayName: "A Very Long Self Hosted Gateway Name That Goes On And On Forever",
        origin: { kind: "byok" },
      });

      const name = providerKeychainName(provider, {});

      expect(name.length).toBeLessThanOrEqual(64);
      expect(name).toMatch(/^copilot-a-very-long-[a-z0-9-]*[a-z0-9]-api-key$/);
    });
  });

  describe("isCopilotOwnedSecret()", () => {
    it.each(["copilot-anthropic-api-key", "copilot-v1234abcd-plus-license-key"])(
      "treats %s as Copilot-owned",
      (id) => {
        expect(isCopilotOwnedSecret(id)).toBe(true);
      }
    );

    it("treats a secret another plugin named as not Copilot-owned", () => {
      expect(isCopilotOwnedSecret("anthropic-api-key")).toBe(false);
    });
  });

  describe("KeychainService", () => {
    describe("migrateLegacyNames()", () => {
      function migrate(
        entries: Record<string, string>,
        settings: CopilotSettings,
        syncedVaultId?: string
      ) {
        const storage = makeMapStorage(entries);
        const service = KeychainService.getInstance(makeApp({ secretStorage: storage }));
        const migrated = service.migrateLegacyNames(settings, syncedVaultId);
        return { secrets: storage.secrets, migrated };
      }

      it("copies a top-level secret from the synced vault id's name to its stable name and keeps the original (https://github.com/logancyang/obsidian-copilot/issues/3618)", () => {
        const legacyId = `copilot-v${SYNCED_VAULT_ID}-plus-license-key`;

        const { secrets } = migrate({ [legacyId]: "lic-current" }, makeSettings(), SYNCED_VAULT_ID);

        expect(secrets.get("copilot-setting-plus-license-key")).toBe("lic-current");
        expect(secrets.get(legacyId)).toBe("lic-current");
      });

      it("recovers a key this device saved under a vault id that a later sync replaced (https://github.com/logancyang/obsidian-copilot/issues/3618)", () => {
        const { secrets } = migrate(
          { [`copilot-v${EARLIER_VAULT_ID}-plus-license-key`]: "lic-earlier" },
          makeSettings(),
          SYNCED_VAULT_ID
        );

        expect(secrets.get("copilot-setting-plus-license-key")).toBe("lic-earlier");
      });

      it("prefers the entry under the synced vault id, which is the key the previous version resolves today", () => {
        const { secrets } = migrate(
          {
            [`copilot-v${EARLIER_VAULT_ID}-plus-license-key`]: "lic-stale",
            [`copilot-v${SYNCED_VAULT_ID}-plus-license-key`]: "lic-current",
          },
          makeSettings(),
          SYNCED_VAULT_ID
        );

        expect(secrets.get("copilot-setting-plus-license-key")).toBe("lic-current");
      });

      it("leaves an existing stable entry untouched, so a key changed after migration is not reverted", () => {
        const { secrets } = migrate(
          {
            "copilot-setting-plus-license-key": "lic-new",
            [`copilot-v${SYNCED_VAULT_ID}-plus-license-key`]: "lic-old",
          },
          makeSettings(),
          SYNCED_VAULT_ID
        );

        expect(secrets.get("copilot-setting-plus-license-key")).toBe("lic-new");
      });

      it("copies a model-level apiKey to its stable model name", () => {
        const identityHash = md5("gpt-4|openai").slice(0, 8);

        const { secrets } = migrate(
          {
            [`copilot-v${SYNCED_VAULT_ID}-model-api-key-chat-gpt-4-openai-${identityHash}`]:
              "sk-model",
          },
          makeSettings({ activeModels: [makeModel({ name: "gpt-4", provider: "openai" })] }),
          SYNCED_VAULT_ID
        );

        expect(secrets.get(`copilot-model-api-key-chat-gpt-4-openai-${identityHash}`)).toBe(
          "sk-model"
        );
      });

      it("rewrites a legacy provider pointer to its readable name and copies the key (https://github.com/logancyang/obsidian-copilot/issues/3618)", () => {
        const legacyPointer = `copilot-v${SYNCED_VAULT_ID}-provider-row-1`;
        const provider = makeProvider({ apiKeyKeychainId: legacyPointer });

        const { secrets, migrated } = migrate(
          { [legacyPointer]: "sk-ant" },
          makeSettings({ providers: { "row-1": provider } })
        );

        expect(migrated.providers["row-1"].apiKeyKeychainId).toBe("copilot-anthropic-api-key");
        expect(secrets.get("copilot-anthropic-api-key")).toBe("sk-ant");
        expect(secrets.get(legacyPointer)).toBe("sk-ant");
      });

      it("prefers the entry the provider's current pointer names over other legacy entries for that provider", () => {
        const currentPointer = `copilot-v${EARLIER_VAULT_ID}-provider-row-1`;
        const provider = makeProvider({ apiKeyKeychainId: currentPointer });

        const { secrets } = migrate(
          {
            [`copilot-v${SYNCED_VAULT_ID}-provider-row-1`]: "sk-stale",
            [currentPointer]: "sk-current",
          },
          makeSettings({ providers: { "row-1": provider } }),
          SYNCED_VAULT_ID
        );

        expect(secrets.get("copilot-anthropic-api-key")).toBe("sk-current");
      });

      it("fills a readable pointer synced from another device with this device's legacy key for the same provider (https://github.com/logancyang/obsidian-copilot/issues/3618)", () => {
        const provider = makeProvider({ apiKeyKeychainId: "copilot-anthropic-api-key" });
        const settings = makeSettings({ providers: { "row-1": provider } });

        const { secrets, migrated } = migrate(
          { [`copilot-v${EARLIER_VAULT_ID}-provider-row-1`]: "sk-ant-local" },
          settings
        );

        expect(secrets.get("copilot-anthropic-api-key")).toBe("sk-ant-local");
        expect(migrated).toBe(settings);
      });

      it("rewrites a legacy pointer this device never held, so a re-entered key lands on the shared name", () => {
        const provider = makeProvider({
          apiKeyKeychainId: `copilot-v${SYNCED_VAULT_ID}-provider-row-1`,
        });

        const { secrets, migrated } = migrate(
          {},
          makeSettings({ providers: { "row-1": provider } })
        );

        expect(migrated.providers["row-1"].apiKeyKeychainId).toBe("copilot-anthropic-api-key");
        expect(secrets.has("copilot-anthropic-api-key")).toBe(false);
      });
    });

    describe("deleteSecret()", () => {
      it("removes the stable entry for a settings key", () => {
        const secretStorage = makeSecretStorage();
        const service = KeychainService.getInstance(makeApp({ secretStorage }));

        service.deleteSecret("githubCopilotToken");

        expect(secretStorage.deleteSecret).toHaveBeenCalledWith(
          "copilot-setting-github-copilot-token"
        );
      });

      it("falls back to an empty-value tombstone on builds without deleteSecret", () => {
        const secretStorage = makeSecretStorage();
        (secretStorage as unknown as { deleteSecret: unknown }).deleteSecret = undefined;
        const service = KeychainService.getInstance(makeApp({ secretStorage }));

        service.deleteSecret("githubCopilotToken");

        expect(secretStorage.setSecret).toHaveBeenCalledWith(
          "copilot-setting-github-copilot-token",
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
      it("clears Copilot's keychain entries, strips settings, and notifies the user", async () => {
        const secretStorage = makeSecretStorage();
        const service = KeychainService.getInstance(makeApp({ secretStorage }));

        secretStorage.listSecrets.mockReturnValue([
          "copilot-setting-open-a-i-api-key",
          "anthropic-api-key",
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

        expect(secretStorage.deleteSecret).toHaveBeenCalledWith("copilot-setting-open-a-i-api-key");
        expect(secretStorage.deleteSecret).not.toHaveBeenCalledWith("anthropic-api-key");

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

        const idA = "copilot-setting-open-a-i-api-key";
        const idB = "copilot-anthropic-api-key";
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
      it("deletes only embedding-scoped model credentials (https://github.com/logancyang/obsidian-copilot/pull/3094#discussion_r3926692782)", () => {
        const secretStorage = makeSecretStorage();
        const service = KeychainService.getInstance(makeApp({ secretStorage }));
        const retired = "copilot-v1234abcd-model-api-key-embedding-text-embedding-3-small";
        secretStorage.listSecrets.mockReturnValue([
          retired,
          "copilot-v1234abcd-model-api-key-chat-gpt-4o",
          "copilot-model-api-key-chat-gpt-4o-1a2b3c4d",
          "copilot-v1234abcd-open-a-i-api-key",
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

    describe("clearCopilotSecrets()", () => {
      it("deletes stable and legacy Copilot entries but leaves other plugins' secrets (https://github.com/logancyang/obsidian-copilot/issues/3618)", () => {
        const secretStorage = makeSecretStorage();
        const service = KeychainService.getInstance(makeApp({ secretStorage }));
        secretStorage.listSecrets.mockReturnValue([
          "copilot-anthropic-api-key",
          "copilot-v1234abcd-provider-row-1",
          "anthropic-api-key",
        ]);

        service.clearCopilotSecrets();

        expect(secretStorage.deleteSecret).toHaveBeenCalledWith("copilot-anthropic-api-key");
        expect(secretStorage.deleteSecret).toHaveBeenCalledWith("copilot-v1234abcd-provider-row-1");
        expect(secretStorage.deleteSecret).not.toHaveBeenCalledWith("anthropic-api-key");
      });

      it("clears what it can, then throws aggregating the count of failed entries", () => {
        const secretStorage = makeSecretStorage();
        const service = KeychainService.getInstance(makeApp({ secretStorage }));

        const ok = "copilot-setting-open-a-i-api-key";
        const bad1 = "copilot-setting-google-api-key";
        const bad2 = "copilot-v1234abcd-cohere-api-key";
        const foreign = "anthropic-api-key";
        secretStorage.listSecrets.mockReturnValue([ok, bad1, bad2, foreign]);

        secretStorage.deleteSecret.mockImplementation((id: string) => {
          if (id === bad1 || id === bad2) throw new Error("os denied");
        });

        expect(() => service.clearCopilotSecrets()).toThrow(/Failed to clear 2 keychain entries/);

        expect(secretStorage.deleteSecret).toHaveBeenCalledWith(ok);
        expect(secretStorage.deleteSecret).not.toHaveBeenCalledWith(foreign);
      });

      it("throws without touching deleteSecret when listSecrets is not a function", () => {
        const secretStorage = makeSecretStorage();
        (secretStorage as unknown as { listSecrets: unknown }).listSecrets = undefined;
        const service = KeychainService.getInstance(makeApp({ secretStorage }));

        expect(() => service.clearCopilotSecrets()).toThrow(/does not support listing entries/);
        expect(secretStorage.deleteSecret).not.toHaveBeenCalled();
      });
    });
  });
});
