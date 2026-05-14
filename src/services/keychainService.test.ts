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

jest.mock("@/utils/hash", () => ({
  md5: jest.fn((value: string) => {
    // Reason: deterministic fake hash for test assertions.
    // Uses a simple char-code sum to produce reproducible 32-char hex strings.
    let sum = 0;
    for (let i = 0; i < value.length; i++) sum += value.charCodeAt(i);
    return sum.toString(16).padStart(32, "0");
  }),
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
  const actual = jest.requireActual<object>("@/settings/model");
  return {
    ...actual,
    getSettings: jest.fn(),
  };
});

jest.mock("@/services/settingsSecretTransforms", () => ({
  MODEL_SECRET_FIELDS: ["apiKey"] as const,
  // Reason: stub the canonical secret-field list used by hydrateFromKeychain.
  // Keep it minimal so tests targeting a single field don't accidentally
  // trigger hydration for every default provider.
  TOP_LEVEL_SECRET_FIELDS: ["openAIApiKey"] as const,
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
      out.activeEmbeddingModels = (out.activeEmbeddingModels as Array<Record<string, unknown>>).map(
        (m) => ({ ...m, apiKey: "" })
      );
    }
    return out;
  }),
  cleanupLegacyFields: jest.fn((settings: Record<string, unknown>) => ({ ...settings })),
  // Reason: mirrors the production helper so the stranded-vault guard in
  // forgetAllSecrets sees the same truth as the rest of the codebase.
  isKeychainOnly: jest.fn((settings: Record<string, unknown>) => settings._keychainOnly === true),
}));

import { FileSystemAdapter, Notice, type App } from "obsidian";
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
  };
}

/** Fake SecretStorage with controllable Jest spies. */
function makeSecretStorage() {
  return {
    getSecret: jest.fn().mockReturnValue(null),
    setSecret: jest.fn(),
    deleteSecret: jest.fn(),
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
  /**
   * Reason: distinguish "default to fake storage" from "explicitly omit the
   * field". Production code reads `app.secretStorage` and falsy means the
   * runtime lacks the API entirely — the `??` short-circuit had hidden
   * that case in tests.
   *   - omit the key   → falls back to the fake storage (most tests)
   *   - secretStorage: null → simulate an Obsidian build without SecretStorage
   */
  secretStorage?: ReturnType<typeof makeSecretStorage> | null;
}) {
  const basePath = options?.basePath ?? "/Users/test/MyVault";
  const hasExplicitStorage = options !== undefined && "secretStorage" in options;
  const secretStorage = hasExplicitStorage ? options.secretStorage : makeSecretStorage();
  return {
    vault: {
      adapter: options?.adapter ?? makeAdapter(basePath),
      getName: jest.fn().mockReturnValue("MyVault"),
      // Reason: any non-empty string works here — the production code resolves
      // `app.vault.configDir` rather than hardcoding ".obsidian", and the lint
      // rule `obsidianmd/hardcoded-config-path` flags ".obsidian" specifically.
      configDir: "test-config-dir",
    },
    secretStorage,
  } as unknown as App;
}

beforeEach(() => {
  jest.clearAllMocks();
  KeychainService.resetInstance();
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
// hydrateFromKeychain — read-only keychain hydration
// ---------------------------------------------------------------------------

describe("hydrateFromKeychain", () => {
  it("honors a keychain tombstone by zeroing the in-memory field", async () => {
    const secretStorage = makeSecretStorage();
    secretStorage.getSecret.mockReturnValue("");
    const service = KeychainService.getInstance(makeApp({ secretStorage }));

    const result = await service.hydrateFromKeychain(
      makeSettings({ openAIApiKey: "leftover-from-disk" })
    );

    expect(result.settings.openAIApiKey).toBe("");
    expect(result.hadFailures).toBe(false);
    // Reason: hydrateFromKeychain is strictly read-only.
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
    // Reason: covers the partial-settings scenario — data.json from cross-version
    // sync, downgrade-then-upgrade, or manual edits may omit some secret fields,
    // but a corresponding keychain entry can still exist on this device. Hydrate
    // must iterate the canonical field set, not just Object.keys(settings).
    const secretStorage = makeSecretStorage();
    secretStorage.getSecret.mockImplementation((id: string) =>
      id.endsWith("open-a-i-api-key") ? "sk-recovered" : null
    );
    const service = KeychainService.getInstance(makeApp({ secretStorage }));

    // Note: makeSettings() intentionally does NOT seed openAIApiKey on the input.
    const result = await service.hydrateFromKeychain(makeSettings());

    expect((result.settings as unknown as Record<string, string>).openAIApiKey).toBe(
      "sk-recovered"
    );
    expect(secretStorage.setSecret).not.toHaveBeenCalled();
  });

  it("still hydrates legacy secret keys present on input but not in DEFAULT_SETTINGS", async () => {
    // Reason: deprecated fields may have been removed from DEFAULT_SETTINGS yet
    // remain in a user's data.json with a live keychain entry. The union of
    // canonical fields + in-memory secret-shaped keys keeps them readable so
    // upgrading never silently drops a key.
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
    expect(result.keychainIdsToDelete.some((id) => id.includes("model-api-key-embedding"))).toBe(
      true
    );

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
    const refreshDiskState = jest.fn();
    const syncMemory = jest.fn();

    await service.forgetAllSecrets(saveData, refreshDiskState, syncMemory);

    // Reason: should only delete entries for THIS vault, not other vaults
    expect(secretStorage.deleteSecret).toHaveBeenCalledWith(`copilot-v${vaultId}-open-a-i-api-key`);
    expect(secretStorage.deleteSecret).not.toHaveBeenCalledWith("copilot-vother000-google-api-key");

    // Reason: should save stripped settings to disk with secrets blanked
    expect(saveData).toHaveBeenCalled();
    const saved = saveData.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(saved._keychainOnly).toBe(true);
    expect(saved.openAIApiKey).toBe("");
    const savedModels = saved.activeModels as Array<Record<string, unknown>>;
    expect(savedModels[0].apiKey).toBe("");

    expect(refreshDiskState).toHaveBeenCalled();
    expect(syncMemory).toHaveBeenCalled();
    // Reason: synced memory should also have secrets blanked
    const synced = syncMemory.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(synced.openAIApiKey).toBe("");
    const syncedModels = synced.activeModels as Array<Record<string, unknown>>;
    expect(syncedModels[0].apiKey).toBe("");
    expect(Notice).toHaveBeenCalledWith(
      "All API keys for this vault removed. Please re-enter them."
    );
  });

  it("handles saveData failure gracefully — keychain NOT cleared", async () => {
    const secretStorage = makeSecretStorage();
    const service = KeychainService.getInstance(makeApp({ secretStorage }));
    secretStorage.listSecrets.mockReturnValue([]);

    (getSettings as jest.Mock).mockReturnValue(makeSettings({ openAIApiKey: "sk-123" }));

    const saveData = jest.fn().mockRejectedValue(new Error("disk write failed"));
    const refreshDiskState = jest.fn();
    const syncMemory = jest.fn();
    const onDiskSaveFailed = jest.fn();

    await service.forgetAllSecrets(saveData, refreshDiskState, syncMemory, onDiskSaveFailed);

    // Reason: disk failed → abort before keychain clear
    expect(secretStorage.deleteSecret).not.toHaveBeenCalled();
    expect(syncMemory).not.toHaveBeenCalled();
    expect(onDiskSaveFailed).toHaveBeenCalled();
    expect(refreshDiskState).not.toHaveBeenCalled();
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

    // Reason: simulate partial failure — first delete succeeds, second throws.
    secretStorage.deleteSecret.mockImplementation((id: string) => {
      if (id === idB) throw new Error("keychain locked");
    });

    (getSettings as jest.Mock).mockReturnValue(makeSettings({ openAIApiKey: "sk-123" }));

    const saveData = jest.fn().mockResolvedValue(undefined);
    const refreshDiskState = jest.fn();
    const syncMemory = jest.fn();
    const onDiskSaveFailed = jest.fn();

    await expect(
      service.forgetAllSecrets(saveData, refreshDiskState, syncMemory, onDiskSaveFailed)
    ).rejects.toThrow(/Failed to clear 1 keychain/);

    // Reason: disk save succeeds first (new ordering), then keychain clear fails.
    expect(saveData).toHaveBeenCalled();
    expect(refreshDiskState).toHaveBeenCalled();
    expect(secretStorage.deleteSecret).toHaveBeenCalledWith(idA);
    // Reason: memory MUST be synced even on partial keychain failure, otherwise
    // the next normal persist would write old secrets back from stale memory.
    expect(syncMemory).toHaveBeenCalled();
    expect(onDiskSaveFailed).not.toHaveBeenCalled();
  });

  it("does NOT flip a disk-mode vault into keychain-only when Secure Storage is unavailable", async () => {
    // Reason: on Obsidian builds without `secretStorage`, "Delete All Keys"
    // must not write `_keychainOnly: true` to disk. Otherwise the next save
    // takes the stranded path and silently strips any newly entered key,
    // bricking auth setup on older builds with one click.
    const service = KeychainService.getInstance(makeApp({ secretStorage: null }));
    expect(service.isAvailable()).toBe(false);

    (getSettings as jest.Mock).mockReturnValue(makeSettings({ openAIApiKey: "sk-disk" }));

    const saveData = jest.fn().mockResolvedValue(undefined);
    const refreshDiskState = jest.fn();
    const syncMemory = jest.fn();

    await service.forgetAllSecrets(saveData, refreshDiskState, syncMemory);

    const saved = saveData.mock.calls[0][0] as unknown as Record<string, unknown>;
    // Reason: secrets are still cleared from data.json — the user did ask to delete them.
    expect(saved.openAIApiKey).toBe("");
    // Reason: but the vault stays in disk mode so future key entries can persist.
    expect(saved._keychainOnly).toBeUndefined();
    const synced = syncMemory.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(synced._keychainOnly).toBeUndefined();
  });

  it("refuses to run on a stranded vault and never touches disk/memory", async () => {
    // Reason: in a stranded vault (keychain-only + no SecretStorage) we can't
    // actually reach the OS keychain to clear its entries. If we still stripped
    // disk and cleared memory, the user would see a success Notice but the
    // keychain entries would survive — and reappear after upgrading Obsidian
    // (or moving to a SecretStorage-capable build). Refuse up-front instead so
    // the destructive contract stays honest.
    const service = KeychainService.getInstance(makeApp({ secretStorage: null }));

    (getSettings as jest.Mock).mockReturnValue(
      makeSettings({ openAIApiKey: "", _keychainOnly: true })
    );

    const saveData = jest.fn().mockResolvedValue(undefined);
    const refreshDiskState = jest.fn();
    const syncMemory = jest.fn();

    await expect(service.forgetAllSecrets(saveData, refreshDiskState, syncMemory)).rejects.toThrow(
      /Secure Storage is unavailable/
    );

    // Reason: nothing destructive ran — no disk write, no memory sync, no
    // refresh of cached state.
    expect(saveData).not.toHaveBeenCalled();
    expect(refreshDiskState).not.toHaveBeenCalled();
    expect(syncMemory).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// clearAllVaultSecrets — partial-failure surface area
// ---------------------------------------------------------------------------

describe("clearAllVaultSecrets", () => {
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

    // Reason: the successful delete survives; foreign-vault entry is never touched.
    expect(secretStorage.deleteSecret).toHaveBeenCalledWith(ok);
    expect(secretStorage.deleteSecret).not.toHaveBeenCalledWith(foreign);
  });

  it("throws without touching deleteSecret when listSecrets is not a function", () => {
    // Reason: defensive feature detection — if a future Obsidian build exposes
    // secretStorage without listSecrets we cannot enumerate vault entries, so
    // we must refuse rather than silently leave residual entries behind.
    const secretStorage = makeSecretStorage();
    (secretStorage as unknown as { listSecrets: unknown }).listSecrets = undefined;
    const service = KeychainService.getInstance(makeApp({ secretStorage }));

    expect(() => service.clearAllVaultSecrets()).toThrow(/does not support listing entries/);
    expect(secretStorage.deleteSecret).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// forgetAllSecrets — listSecrets feature detection
// ---------------------------------------------------------------------------

describe("forgetAllSecrets with missing listSecrets", () => {
  it("refuses BEFORE stripping disk when keychain is available but listSecrets is missing", async () => {
    // Reason: if we cannot enumerate the keychain, stripping disk first would
    // leave the user with cleared data.json AND residual keychain entries
    // that resurrect on the next hydrate. Refuse up-front instead.
    const secretStorage = makeSecretStorage();
    (secretStorage as unknown as { listSecrets: unknown }).listSecrets = undefined;
    const service = KeychainService.getInstance(makeApp({ secretStorage }));

    (getSettings as jest.Mock).mockReturnValue(makeSettings({ openAIApiKey: "sk-live" }));

    const saveData = jest.fn().mockResolvedValue(undefined);
    const refreshDiskState = jest.fn();
    const syncMemory = jest.fn();

    await expect(service.forgetAllSecrets(saveData, refreshDiskState, syncMemory)).rejects.toThrow(
      /does not support enumerating Keychain entries/
    );

    expect(saveData).not.toHaveBeenCalled();
    expect(refreshDiskState).not.toHaveBeenCalled();
    expect(syncMemory).not.toHaveBeenCalled();
    expect(secretStorage.deleteSecret).not.toHaveBeenCalled();
  });
});
