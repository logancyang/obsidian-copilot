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

jest.mock("crypto-js", () => ({
  MD5: jest.fn((value: string) => ({
    toString: () => {
      // Reason: deterministic fake hash for test assertions.
      // Uses a simple char-code sum to produce reproducible 32-char hex strings.
      let sum = 0;
      for (let i = 0; i < value.length; i++) sum += value.charCodeAt(i);
      return sum.toString(16).padStart(32, "0");
    },
  })),
}));

jest.mock("@/encryptionService", () => ({
  isSensitiveKey: jest.fn((key: string) => {
    const lower = key.toLowerCase();
    const normalized = lower.replace(/[_-]/g, "");
    return (
      normalized.includes("apikey") ||
      lower.endsWith("token") ||
      lower.endsWith("accesstoken") ||
      lower.endsWith("secret") ||
      lower.endsWith("password") ||
      lower.endsWith("licensekey")
    );
  }),
  getDecryptedKey: jest.fn(async (value: string) => value.replace(/^enc_/, "")),
}));

jest.mock("@/settings/model", () => {
  const actual = jest.requireActual("@/settings/model");
  return {
    ...actual,
    getSettings: jest.fn(),
  };
});

jest.mock("@/services/settingsSecretTransforms", () => ({
  MODEL_SECRET_FIELDS: ["apiKey"] as const,
  stripKeychainFields: jest.fn((settings: Record<string, unknown>) => {
    const out = { ...settings };
    // Reason: mirror the real isSensitiveKey heuristic for top-level fields
    for (const key of Object.keys(out)) {
      const lower = key.toLowerCase();
      const normalized = lower.replace(/[_-]/g, "");
      const isSensitive =
        normalized.includes("apikey") ||
        lower.endsWith("token") ||
        lower.endsWith("accesstoken") ||
        lower.endsWith("secret") ||
        lower.endsWith("password") ||
        lower.endsWith("licensekey");
      if (isSensitive) out[key] = "";
    }
    if (Array.isArray(out.activeModels)) {
      out.activeModels = (out.activeModels as Array<Record<string, unknown>>).map((m) => ({
        ...m,
        apiKey: "",
      }));
    }
    if (Array.isArray(out.activeEmbeddingModels)) {
      out.activeEmbeddingModels = (
        out.activeEmbeddingModels as Array<Record<string, unknown>>
      ).map((m) => ({ ...m, apiKey: "" }));
    }
    return out;
  }),
  cleanupLegacyFields: jest.fn((settings: Record<string, unknown>) => {
    const out = { ...settings };
    delete out.enableEncryption;
    delete out._keychainMigrated;
    return out;
  }),
}));

import { FileSystemAdapter, Notice } from "obsidian";
import { getDecryptedKey } from "@/encryptionService";
import { getSettings } from "@/settings/model";
import type { CopilotSettings } from "@/settings/model";
import type { CustomModel } from "@/aiParams";
import { KeychainService, isSecretKey } from "./keychainService";

/** Build a lightweight settings object. */
function makeSettings(overrides: Partial<CopilotSettings> = {}): CopilotSettings {
  return {
    activeModels: [],
    activeEmbeddingModels: [],
    ...overrides,
  } as unknown as CopilotSettings;
}

/** Build a minimal custom model. */
function makeModel(overrides: Partial<CustomModel> = {}): CustomModel {
  return {
    name: "gpt-4",
    provider: "openai",
    enabled: true,
    ...overrides,
  } as CustomModel;
}

/** Fake SecretStorage with controllable Jest spies. */
function makeSecretStorage() {
  return {
    getSecret: jest.fn().mockReturnValue(null),
    setSecret: jest.fn(),
    listSecrets: jest.fn().mockReturnValue([]),
  };
}

/** Create a FileSystemAdapter mock with a given basePath. */
function makeAdapter(basePath: string) {
  const adapter = new FileSystemAdapter();
  // Reason: override the default basePath from the mock constructor
  (adapter as unknown as { _basePath: string })._basePath = basePath;
  return adapter;
}

/** Create a minimal Obsidian app shape for KeychainService. */
function makeApp(options?: {
  basePath?: string;
  adapter?: unknown;
  secretStorage?: ReturnType<typeof makeSecretStorage> | null;
}) {
  const basePath = options?.basePath ?? "/Users/test/MyVault";
  return {
    vault: {
      adapter: options?.adapter ?? makeAdapter(basePath),
      getName: jest.fn().mockReturnValue("MyVault"),
      configDir: ".obsidian",
    },
    secretStorage: options?.secretStorage ?? makeSecretStorage(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

beforeEach(() => {
  jest.clearAllMocks();
  KeychainService.resetInstance();
  (getDecryptedKey as jest.Mock).mockImplementation(async (value: string) =>
    value.replace(/^enc_/, "")
  );
});

// ---------------------------------------------------------------------------
// isSecretKey
// ---------------------------------------------------------------------------

describe("isSecretKey", () => {
  it.each(["openAIApiKey", "googleApiKey", "githubCopilotToken", "plusLicenseKey", "myPassword"])(
    "returns true for %s",
    (key) => {
      expect(isSecretKey(key)).toBe(true);
    }
  );

  it.each(["temperature", "defaultModelKey", "userId"])("returns false for %s", (key) => {
    expect(isSecretKey(key)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Vault ID generation
// ---------------------------------------------------------------------------

describe("vault ID generation", () => {
  it("produces a deterministic 8-char hex ID from desktop vault path", () => {
    const service = KeychainService.getInstance(makeApp({ basePath: "/Users/test/MyVault" }));
    const id = service.getVaultId();

    expect(id).toHaveLength(8);
    expect(/^[0-9a-f]{8}$/.test(id)).toBe(true);
  });

  it("produces a stable ID across multiple calls", () => {
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

// ---------------------------------------------------------------------------
// backfillAndHydrate
// ---------------------------------------------------------------------------

describe("backfillAndHydrate", () => {
  it("honors a keychain tombstone and does not resurrect from disk", async () => {
    const secretStorage = makeSecretStorage();
    secretStorage.getSecret.mockReturnValue("");
    const service = KeychainService.getInstance(makeApp({ secretStorage }));

    const result = await service.backfillAndHydrate(
      makeSettings({ openAIApiKey: "enc_disk_openai" })
    );

    expect(result.settings.openAIApiKey).toBe("");
    expect(result.backfilledAny).toBe(false);
    expect(result.hadFailures).toBe(false);
    expect(secretStorage.setSecret).not.toHaveBeenCalled();
  });

  it("uses the keychain value when one exists", async () => {
    const secretStorage = makeSecretStorage();
    secretStorage.getSecret.mockReturnValue("kc-value");
    const service = KeychainService.getInstance(makeApp({ secretStorage }));

    const result = await service.backfillAndHydrate(
      makeSettings({ openAIApiKey: "enc_disk_openai" })
    );

    expect(result.settings.openAIApiKey).toBe("kc-value");
    expect(result.backfilledAny).toBe(false);
  });

  it("backfills a missing top-level secret from disk into the keychain", async () => {
    const secretStorage = makeSecretStorage();
    // Reason: null means "not in keychain yet"
    secretStorage.getSecret.mockReturnValue(null);
    const service = KeychainService.getInstance(makeApp({ secretStorage }));

    (getDecryptedKey as jest.Mock).mockResolvedValue("plain-openai");

    const result = await service.backfillAndHydrate(
      makeSettings({ openAIApiKey: "enc_disk_openai" })
    );

    expect(secretStorage.setSecret).toHaveBeenCalledWith(
      expect.stringContaining("copilot-v"),
      "plain-openai"
    );
    expect(result.settings.openAIApiKey).toBe("plain-openai");
    expect(result.backfilledAny).toBe(true);
    expect(result.hadFailures).toBe(false);
  });

  it("marks failures and falls back to disk when keychain reads throw", async () => {
    const secretStorage = makeSecretStorage();
    secretStorage.getSecret.mockImplementation(() => {
      throw new Error("locked");
    });
    const service = KeychainService.getInstance(makeApp({ secretStorage }));

    const result = await service.backfillAndHydrate(
      makeSettings({ openAIApiKey: "enc_disk_openai" })
    );

    // Reason: when keychain is locked, the disk value should be preserved as-is
    expect(result.settings.openAIApiKey).toBe("enc_disk_openai");
    expect(result.backfilledAny).toBe(false);
    expect(result.hadFailures).toBe(true);
  });

  it("keeps hydrated plaintext when keychain backfill writes throw", async () => {
    const secretStorage = makeSecretStorage();
    secretStorage.getSecret.mockReturnValue(null);
    secretStorage.setSecret.mockImplementation(() => {
      throw new Error("write failed");
    });
    const service = KeychainService.getInstance(makeApp({ secretStorage }));

    (getDecryptedKey as jest.Mock).mockResolvedValue("plain-openai");

    const result = await service.backfillAndHydrate(
      makeSettings({ openAIApiKey: "enc_disk_openai" })
    );

    // Reason: even if keychain write fails, the decrypted value should be in memory
    expect(result.settings.openAIApiKey).toBe("plain-openai");
    // Reason: backfilledAny is false because the keychain write failed — only
    // successful writes count, to prevent premature _keychainMigratedAt stamping.
    expect(result.backfilledAny).toBe(false);
    expect(result.hadFailures).toBe(true);
  });

  it("backfills model-level apiKey values", async () => {
    const secretStorage = makeSecretStorage();
    secretStorage.getSecret.mockReturnValue(null);
    const service = KeychainService.getInstance(makeApp({ secretStorage }));

    (getDecryptedKey as jest.Mock).mockResolvedValue("plain-model");

    const result = await service.backfillAndHydrate(
      makeSettings({
        activeModels: [makeModel({ name: "gpt-4", provider: "openai", apiKey: "enc_model" })],
      })
    );

    expect(secretStorage.setSecret).toHaveBeenCalledWith(
      expect.stringContaining("model-api-key-chat"),
      "plain-model"
    );
    expect(result.settings.activeModels[0].apiKey).toBe("plain-model");
    expect(result.backfilledAny).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// persistSecrets
// ---------------------------------------------------------------------------

describe("persistSecrets", () => {
  it("collects current secrets and tombstones cleared or deleted IDs", () => {
    const service = KeychainService.getInstance(makeApp());

    const current = makeSettings({
      openAIApiKey: "sk-current",
      googleApiKey: "",
      activeModels: [makeModel({ name: "kept", provider: "openai", apiKey: "chat-secret" })],
      activeEmbeddingModels: [],
    });

    const prev = makeSettings({
      openAIApiKey: "sk-prev",
      googleApiKey: "g-prev",
      activeModels: [
        makeModel({ name: "kept", provider: "openai", apiKey: "chat-prev" }),
        makeModel({ name: "deleted", provider: "openai", apiKey: "del-secret" }),
      ],
      activeEmbeddingModels: [
        makeModel({ name: "del-embed", provider: "openai", apiKey: "embed-secret" }),
      ],
    });

    const result = service.persistSecrets(current, prev);

    // Reason: should collect the current openAIApiKey and the kept model's apiKey
    const entryIds = result.secretEntries.map(([id]) => id);
    expect(entryIds.some((id) => id.includes("open-a-i-api-key"))).toBe(true);
    expect(entryIds.some((id) => id.includes("model-api-key-chat"))).toBe(true);

    // Reason: should mark deleted models and cleared googleApiKey for tombstone
    expect(result.keychainIdsToDelete.some((id) => id.includes("google-api-key"))).toBe(true);
    expect(result.keychainIdsToDelete.some((id) => id.includes("model-api-key-chat"))).toBe(true);
    expect(result.keychainIdsToDelete.some((id) => id.includes("model-api-key-embedding"))).toBe(true);

    // Reason: persistSecrets must not mutate the input settings objects
    expect(current.openAIApiKey).toBe("sk-current");
    expect(current.activeModels[0].apiKey).toBe("chat-secret");
    expect(prev.openAIApiKey).toBe("sk-prev");
    expect(prev.activeModels[0].apiKey).toBe("chat-prev");
  });
});

// ---------------------------------------------------------------------------
// forgetAllSecrets
// ---------------------------------------------------------------------------

describe("forgetAllSecrets", () => {
  it("clears vault secrets, strips settings, and notifies the user", async () => {
    const secretStorage = makeSecretStorage();
    const service = KeychainService.getInstance(makeApp({ secretStorage }));
    const vaultId = service.getVaultId();

    // Reason: listSecrets returns IDs for this vault and one from another vault
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
    const refreshSnapshot = jest.fn();
    const syncMemory = jest.fn();

    await service.forgetAllSecrets(saveData, refreshSnapshot, syncMemory);

    // Reason: should only clear entries for THIS vault, not other vaults
    expect(secretStorage.setSecret).toHaveBeenCalledWith(
      `copilot-v${vaultId}-open-a-i-api-key`,
      ""
    );
    expect(secretStorage.setSecret).not.toHaveBeenCalledWith(
      "copilot-vother000-google-api-key",
      expect.anything()
    );

    // Reason: should save stripped settings to disk with secrets blanked
    expect(saveData).toHaveBeenCalled();
    const saved = saveData.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(saved._diskSecretsCleared).toBe(true);
    expect(saved.openAIApiKey).toBe("");
    const savedModels = saved.activeModels as Array<Record<string, unknown>>;
    expect(savedModels[0].apiKey).toBe("");

    expect(refreshSnapshot).toHaveBeenCalled();
    expect(syncMemory).toHaveBeenCalled();
    // Reason: synced memory should also have secrets blanked
    const synced = syncMemory.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(synced.openAIApiKey).toBe("");
    const syncedModels = synced.activeModels as Array<Record<string, unknown>>;
    expect(syncedModels[0].apiKey).toBe("");
    expect(Notice).toHaveBeenCalledWith("All API keys for this vault removed. Please re-enter them.");
  });

  it("handles saveData failure gracefully", async () => {
    const secretStorage = makeSecretStorage();
    const service = KeychainService.getInstance(makeApp({ secretStorage }));
    secretStorage.listSecrets.mockReturnValue([]);

    (getSettings as jest.Mock).mockReturnValue(makeSettings({ openAIApiKey: "sk-123" }));

    const saveData = jest.fn().mockRejectedValue(new Error("disk write failed"));
    const refreshSnapshot = jest.fn();
    const syncMemory = jest.fn();
    const onDiskSaveFailed = jest.fn();

    await service.forgetAllSecrets(saveData, refreshSnapshot, syncMemory, onDiskSaveFailed);

    // Reason: memory should still be synced even when disk save fails
    expect(syncMemory).toHaveBeenCalled();
    expect(onDiskSaveFailed).toHaveBeenCalled();
    expect(refreshSnapshot).not.toHaveBeenCalled();
    expect(Notice).toHaveBeenCalledWith(expect.stringContaining("data.json save failed"));
  });
});
