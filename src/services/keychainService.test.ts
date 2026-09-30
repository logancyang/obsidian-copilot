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
import { KeychainService, isSecretKey } from "./keychainService";

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

function makeAdapter(basePath: string) {
  const adapter = new FileSystemAdapter();
  (adapter as unknown as { _basePath: string })._basePath = basePath;
  return adapter;
}

function makeApp(options?: {
  basePath?: string;
  adapter?: unknown;
  secretStorage?: ReturnType<typeof makeSecretStorage> | null;
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

  describe("KeychainService", () => {
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
