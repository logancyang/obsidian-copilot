import { type App, type SecretStorage, FileSystemAdapter } from "obsidian";
import { type CopilotSettings, getModelKeyFromModel, getSettings } from "@/settings/model";
import { type CustomModel } from "@/aiParams";
import { isSensitiveKey, getDecryptedKey } from "@/encryptionService";
import { stripKeychainFields, cleanupLegacyFields } from "@/services/settingsSecretTransforms";
import { Notice } from "obsidian";
import { MD5 } from "crypto-js";
// Reason: do NOT import logInfo/logWarn/logError here. The logger depends on
// getSettings(), but this module runs during settings loading (before setSettings).
// Use console.* directly for all logging in this file.

/**
 * Fields that are sensitive but don't match the `isSensitiveKey()` heuristic.
 * Reason: `isSensitiveKey()` is the canonical source of truth for sensitive fields.
 * Add entries here only for fields that are NOT covered by `isSensitiveKey()`.
 */
const EXTRA_SECRET_KEYS: readonly string[] = [];

import { MODEL_SECRET_FIELDS } from "@/services/settingsSecretTransforms";

type ModelSecretField = (typeof MODEL_SECRET_FIELDS)[number];

/**
 * Scope distinguishing chat models from embedding models in keychain IDs.
 * Reason: `activeModels` and `activeEmbeddingModels` can contain models with
 * the same `name|provider` identity but different API keys. Without scope,
 * they'd collide in the keychain namespace.
 */
type ModelScope = "chat" | "embedding";

/**
 * Check whether a settings key should be stored in the OS keychain.
 * Combines the heuristic `isSensitiveKey()` with an explicit exception list.
 */
export function isSecretKey(key: string): boolean {
  return isSensitiveKey(key) || EXTRA_SECRET_KEYS.includes(key);
}

// ---------------------------------------------------------------------------
// Vault namespace — isolates keychain entries per vault
// ---------------------------------------------------------------------------

/**
 * Generate a fresh 8-char hex vault ID for first-time use.
 *
 * Reason: uses MD5 of the filesystem path as a deterministic seed on desktop
 * so that the very first run on an existing vault produces a predictable ID.
 * On mobile (no basePath), uses MD5 of vault name + configDir to produce a
 * deterministic ID that is stable across synced mobile devices. This prevents
 * two devices from minting different IDs before _keychainVaultId syncs.
 *
 * Subsequent runs use the persisted `_keychainVaultId` and never re-derive.
 */
function generateVaultId(app: App): string {
  const basePath = getVaultBasePath(app);
  if (basePath) {
    return MD5(basePath).toString().slice(0, 8);
  }
  // Reason: on mobile, basePath is unavailable. Use a random ID to guarantee
  // vault isolation — two same-named vaults on one device will NOT share
  // keychain entries. The load path persists this ID to data.json immediately,
  // so the divergence window is limited to first-run before sync propagates.
  // Reason: guard getRandomValues existence — optional chaining on a missing
  // method silently returns undefined, leaving the buffer zero-filled and
  // collapsing all affected vaults to "00000000".
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    const bytes = new Uint8Array(4);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  return MD5(`${Date.now()}-${Math.random()}`).toString().slice(0, 8);
}

/** Resolve the filesystem base path, or undefined on mobile. */
function getVaultBasePath(app: App): string | undefined {
  const adapter = app.vault.adapter;
  if (adapter instanceof FileSystemAdapter) {
    return adapter.getBasePath();
  }
  const adapterAny = adapter as unknown as { getBasePath?: () => string; basePath?: string };
  if (typeof adapterAny.getBasePath === "function") {
    return adapterAny.getBasePath();
  }
  if (typeof adapterAny.basePath === "string") {
    return adapterAny.basePath;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Keychain ID helpers
// ---------------------------------------------------------------------------

/** Max length enforced by Obsidian's SecretStorage API. */
const MAX_SECRET_ID_LENGTH = 64;

/**
 * Normalize a raw string into a keychain-safe ID segment.
 * Reason: SecretStorage IDs must be lowercase alphanumeric with dashes, 64 chars max.
 *
 * Always appends an 8-char MD5 hash of the raw input to prevent collisions
 * between inputs that differ only by punctuation, case, or non-ASCII chars
 * (e.g. "foo.bar|openai" vs "foo-bar|openai" would otherwise normalize
 * to the same string).
 *
 * @param raw - The raw string to normalize.
 * @param maxLength - Maximum total length of the returned segment (including hash).
 *   Callers pass the remaining budget after accounting for their prefix.
 */
function normalizeKeychainId(raw: string, maxLength = MAX_SECRET_ID_LENGTH): string {
  const normalized = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  const hash = MD5(raw).toString().slice(0, 8);
  // Reason: reserve 9 chars for "-" + hash, fill the rest with readable prefix.
  const prefixBudget = Math.max(0, maxLength - 9);
  const prefix = normalized.slice(0, prefixBudget);
  return prefix + "-" + hash;
}

/**
 * Convert a camelCase settings key to a vault-namespaced kebab-case keychain ID.
 * Format: `copilot-v{8hex}-{kebab-key}`, capped at 64 chars.
 *
 * Reason: top-level settings keys are short (e.g. "openAIApiKey" → 22 chars total),
 * so truncation is extremely unlikely, but we enforce the cap defensively.
 */
function toKeychainId(vaultId: string, settingsKey: string): string {
  const prefix = `copilot-v${vaultId}-`;
  const kebab = settingsKey
    .replace(/([A-Z])/g, "-$1")
    .toLowerCase()
    .replace(/^-/, "");
  const id = prefix + kebab;
  if (id.length <= MAX_SECRET_ID_LENGTH) return id;
  // Reason: hash the full key to preserve uniqueness when truncated.
  const hash = MD5(settingsKey).toString().slice(0, 8);
  return id.slice(0, MAX_SECRET_ID_LENGTH - 9) + "-" + hash;
}

/**
 * Build a keychain ID for a model-level secret.
 * Format: `copilot-v{8hex}-model-{field}-{scope}-{normalized}`
 *
 * Reason: the fixed prefix consumes up to ~28 chars, so `normalizeKeychainId`
 * receives the remaining budget to stay within the 64-char SecretStorage limit.
 * Reason: include the field name in the segment so that different secret fields
 * on the same model (e.g. apiKey vs a future field) get distinct keychain IDs.
 */
function toModelKeychainId(
  vaultId: string,
  scope: ModelScope,
  modelIdentity: string,
  field: ModelSecretField
): string {
  // Reason: convert camelCase field name to kebab-case for the keychain ID segment.
  // e.g. "apiKey" → "api-key"
  const kebabField = field.replace(/([A-Z])/g, "-$1").toLowerCase();
  const fieldSegment = `model-${kebabField}`;
  const prefix = `copilot-v${vaultId}-${fieldSegment}-${scope}-`;
  const budget = MAX_SECRET_ID_LENGTH - prefix.length;
  const normalizedModel = normalizeKeychainId(modelIdentity, budget);
  return prefix + normalizedModel;
}

/** Result of a backfill-and-hydrate pass. */
export interface BackfillResult {
  settings: CopilotSettings;
  backfilledAny: boolean;
  /** True if any field failed to decrypt — disk may still hold the only copy. */
  hadFailures: boolean;
}

/** Output of `persistSecrets()` — what to write to keychain and what to clean up. */
export interface PersistSecretsResult {
  /** Entries to write to keychain: `[keychainId, value]` pairs. */
  secretEntries: Array<[string, string]>;
  /** Keychain IDs of deleted models to clear. */
  keychainIdsToDelete: string[];
}

/** Callback type for Obsidian's saveData. */
export type SaveDataFn = (data: CopilotSettings) => Promise<void>;

/**
 * Singleton service for reading/writing secrets via Obsidian's SecretStorage (OS Keychain).
 *
 * Responsibilities:
 * - Store and retrieve API keys and tokens in the OS keychain
 * - Backfill secrets from data.json to keychain on upgrade (one-time per field)
 * - Hydrate in-memory settings with plaintext secrets on startup
 * - Extract secrets from settings for persistence
 * - Forget all secrets (destructive, user-initiated)
 */
export class KeychainService {
  private static instance: KeychainService | null = null;
  private app: App;
  private vaultId: string;

  private constructor(app: App) {
    this.app = app;
    // Reason: vaultId starts as a path-derived fallback. The load path
    // should call setVaultId() with the persisted _keychainVaultId value
    // before any read/write operations to ensure namespace stability.
    this.vaultId = generateVaultId(app);
  }

  /** Get or create the singleton instance. Must be called with `app` on plugin load. */
  static getInstance(app?: App): KeychainService {
    if (!KeychainService.instance) {
      if (!app) {
        throw new Error("KeychainService must be initialized with app on first call");
      }
      KeychainService.instance = new KeychainService(app);
    }
    return KeychainService.instance;
  }

  /** Reset the singleton (for testing). */
  static resetInstance(): void {
    KeychainService.instance = null;
  }

  /** Whether the OS keychain is available in this Obsidian version. */
  isAvailable(): boolean {
    return !!this.app.secretStorage;
  }

  /** Get the current vault namespace ID. */
  getVaultId(): string {
    return this.vaultId;
  }

  /**
   * Set the vault namespace ID from persisted settings.
   * Reason: called during load to replace the path-derived fallback with the
   * stable persisted ID, so vault renames don't orphan keychain entries.
   */
  setVaultId(id: string): void {
    this.vaultId = id;
  }

  /**
   * Access SecretStorage with a runtime guard.
   * Reason: replaces scattered non-null assertions with a single guard
   * that produces a clear error when keychain is unavailable.
   */
  private get storage(): SecretStorage {
    if (!this.app.secretStorage) {
      throw new Error("OS keychain (SecretStorage) is not available.");
    }
    return this.app.secretStorage;
  }

  // ---------------------------------------------------------------------------
  // Low-level read/write
  // ---------------------------------------------------------------------------

  /** Write a value directly to the keychain using a pre-computed ID. */
  setSecretById(keychainId: string, value: string): void {
    this.storage.setSecret(keychainId, value);
  }

  /** Store a top-level secret in the keychain. */
  setSecret(settingsKey: string, value: string): void {
    const id = toKeychainId(this.vaultId, settingsKey);
    this.storage.setSecret(id, value);
  }

  /** Retrieve a top-level secret from the keychain. Returns `null` if not found. */
  getSecret(settingsKey: string): string | null {
    const id = toKeychainId(this.vaultId, settingsKey);
    return this.storage.getSecret(id);
  }

  /** Store a model-level secret in the keychain. */
  setModelSecret(
    scope: ModelScope,
    modelIdentity: string,
    field: ModelSecretField,
    value: string
  ): void {
    const id = toModelKeychainId(this.vaultId, scope, modelIdentity, field);
    this.storage.setSecret(id, value);
  }

  /** Retrieve a model-level secret from the keychain. Returns `null` if not found. */
  getModelSecret(scope: ModelScope, modelIdentity: string, field: ModelSecretField): string | null {
    const id = toModelKeychainId(this.vaultId, scope, modelIdentity, field);
    return this.storage.getSecret(id);
  }

  // ---------------------------------------------------------------------------
  // backfillAndHydrate — replaces old migrateFromLegacy + hydrateSecrets
  // ---------------------------------------------------------------------------

  /**
   * For each sensitive field, decide the in-memory value and backfill keychain
   * when needed.
   *
   * Per-field logic:
   * - keychain `""` (tombstone) → skip (don't resurrect from disk)
   * - keychain has value → use keychain value
   * - keychain `null` + disk has value → decrypt disk value → write to keychain + use plaintext
   * - keychain `null` + disk empty → no value available
   *
   * Failures are per-field — a single undecryptable field does NOT abort the whole pass.
   *
   * @param settings - Sanitised settings (may contain encrypted or plaintext disk values).
   * @returns Updated settings with secrets hydrated, and whether any backfill occurred.
   */
  async backfillAndHydrate(settings: CopilotSettings): Promise<BackfillResult> {
    const hydrated = { ...settings };
    let backfilledAny = false;
    let hadFailures = false;

    // Top-level secrets
    for (const key of Object.keys(hydrated)) {
      if (!isSecretKey(key)) continue;
      const diskValue = (hydrated as unknown as Record<string, unknown>)[key];

      // Reason: wrap keychain reads in try/catch so a locked/unavailable keychain
      // at startup degrades to disk values instead of aborting plugin load.
      let keychainValue: string | null;
      try {
        keychainValue = this.getSecret(key);
      } catch (e) {
        console.warn(`Keychain read failed for "${key}" — falling back to disk value.`, e);
        hadFailures = true;
        // Reason: decrypt disk value so `enc_*` ciphertext doesn't flow into
        // provider requests. If decryption fails, keep original value.
        if (typeof diskValue === "string" && diskValue.length > 0) {
          const plaintext = await getDecryptedKey(diskValue);
          if (plaintext) {
            (hydrated as unknown as Record<string, unknown>)[key] = plaintext;
          }
        }
        continue;
      }

      if (keychainValue === "") {
        // Tombstone — field was explicitly deleted, don't resurrect
        (hydrated as unknown as Record<string, unknown>)[key] = "";
        continue;
      }

      if (keychainValue !== null) {
        // Keychain has a value — use it
        (hydrated as unknown as Record<string, unknown>)[key] = keychainValue;
        continue;
      }

      // Keychain null — try backfill from disk
      if (typeof diskValue === "string" && diskValue.length > 0) {
        const plaintext = await getDecryptedKey(diskValue);
        if (plaintext && plaintext.length > 0) {
          try {
            this.setSecret(key, plaintext);
            // Reason: only count as backfilled when the keychain write succeeds.
            // A failed write should not stamp _keychainMigratedAt (which starts
            // the 7-day auto-clear countdown).
            backfilledAny = true;
          } catch (e) {
            console.warn(`Keychain backfill write failed for "${key}" — using disk value.`, e);
            hadFailures = true;
          }
          (hydrated as unknown as Record<string, unknown>)[key] = plaintext;
          continue;
        }
        // Decryption failed — keep disk value as-is (will be retried next startup)
        console.warn(`Keychain backfill: failed to decrypt "${key}" — skipping (non-fatal).`);
        hadFailures = true;
        continue;
      }

      // Both keychain and disk empty — no value available for this field.
    }

    // Model-level secrets
    const modelResult = await this.backfillModelSecrets("chat", hydrated.activeModels ?? []);
    hydrated.activeModels = modelResult.models;
    backfilledAny = backfilledAny || modelResult.backfilled;
    hadFailures = hadFailures || modelResult.hadFailures;

    const embeddingResult = await this.backfillModelSecrets(
      "embedding",
      hydrated.activeEmbeddingModels ?? []
    );
    hydrated.activeEmbeddingModels = embeddingResult.models;
    backfilledAny = backfilledAny || embeddingResult.backfilled;
    hadFailures = hadFailures || embeddingResult.hadFailures;

    if (backfilledAny) {
      console.log("Keychain backfill: wrote new secrets to OS keychain.");
    }
    if (hadFailures) {
      console.warn("Keychain backfill: some secrets could not be decrypted — disk copy preserved.");
    }

    return { settings: hydrated, backfilledAny, hadFailures };
  }

  // ---------------------------------------------------------------------------
  // persistSecrets — extract secrets for keychain write during save
  // ---------------------------------------------------------------------------

  /**
   * Extract secrets from settings for keychain persistence.
   * Returns entries to write to keychain and IDs to clean up.
   * Does NOT modify the settings object.
   */
  persistSecrets(settings: CopilotSettings, prevSettings?: CopilotSettings): PersistSecretsResult {
    const secretEntries: Array<[string, string]> = [];
    const clearedSecretIds: string[] = [];

    // Collect top-level secrets
    for (const key of Object.keys(settings)) {
      if (!isSecretKey(key)) continue;
      const value = (settings as unknown as Record<string, unknown>)[key];
      const id = toKeychainId(this.vaultId, key);

      if (typeof value === "string" && value.length > 0) {
        secretEntries.push([id, value]);
      } else if (prevSettings) {
        const prevValue = (prevSettings as unknown as Record<string, unknown>)[key];
        if (typeof prevValue === "string" && prevValue.length > 0) {
          clearedSecretIds.push(id);
        }
      }
    }

    // Collect model-level secrets
    this.collectModelSecrets(
      "chat",
      settings.activeModels,
      secretEntries,
      prevSettings?.activeModels,
      clearedSecretIds
    );
    this.collectModelSecrets(
      "embedding",
      settings.activeEmbeddingModels,
      secretEntries,
      prevSettings?.activeEmbeddingModels,
      clearedSecretIds
    );

    // Find deleted models to clean up
    const keychainIdsToDelete = [
      ...this.getDeletedModelKeysForScope(
        "chat",
        prevSettings?.activeModels,
        settings.activeModels
      ),
      ...this.getDeletedModelKeysForScope(
        "embedding",
        prevSettings?.activeEmbeddingModels,
        settings.activeEmbeddingModels
      ),
      ...clearedSecretIds,
    ];

    return { secretEntries, keychainIdsToDelete };
  }

  // ---------------------------------------------------------------------------
  // clearAllVaultSecrets — wipe all keychain entries for this vault
  // ---------------------------------------------------------------------------

  /**
   * Clear all keychain entries belonging to this vault's namespace only.
   *
   * Reason: does NOT touch legacy global `copilot-*` entries because those
   * may be shared by other vaults on the same machine that haven't migrated yet.
   * Instead, legacy fallback is suppressed via `_diskSecretsCleared` flag —
   * when that flag is true, `backfillAndHydrate` skips legacy reads entirely.
   */
  clearAllVaultSecrets(): void {
    const vaultPrefix = `copilot-v${this.vaultId}-`;
    const allIds = this.storage.listSecrets();
    const failures: string[] = [];
    for (const id of allIds) {
      if (id.startsWith(vaultPrefix)) {
        try {
          this.storage.setSecret(id, "");
        } catch {
          failures.push(id);
        }
      }
    }
    // Reason: do NOT roll back successfully-cleared entries on partial failure.
    // Once a user initiates "forget all secrets", each cleared entry's tombstone
    // (empty string) is the correct final state — it prevents backfillAndHydrate()
    // from resurrecting that secret from data.json on next startup. data.json
    // only serves as a migration source for OTHER devices that haven't upgraded
    // to keychain yet; the current device should never fall back to it.
    // The throw below blocks disk/memory stripping so the user can retry the
    // remaining failed entries, while already-cleared entries stay cleared.
    if (failures.length > 0) {
      throw new Error(
        `Failed to clear ${failures.length} keychain ` +
          `entr${failures.length === 1 ? "y" : "ies"}. Please retry.`
      );
    }
  }

  // ---------------------------------------------------------------------------
  // forgetAllSecrets — destructive user-initiated operation
  // ---------------------------------------------------------------------------

  /**
   * Erase all secrets from keychain, data.json, and memory.
   *
   * This is a dedicated transaction — it does NOT use the normal save path
   * (which could potentially resurrect old values).
   *
   * @param saveData - Callback to write data.json.
   * @param refreshDiskState - Callback to refresh the cached disk-secret flag after save.
   * @param syncMemory - Callback to update in-memory settings without re-entering
   *   the normal persist path. The caller must suppress the subscriber-triggered
   *   `persistSettings()` before calling this (via `suppressNextPersistOnce()`).
   */
  async forgetAllSecrets(
    saveData: SaveDataFn,
    refreshDiskState: (data: CopilotSettings) => void,
    syncMemory: (data: Partial<CopilotSettings>) => void,
    /** When true, the caller should NOT suppress the subscriber-triggered persist. */
    onDiskSaveFailed?: () => void
  ): Promise<void> {
    // 1. Clear keychain (all entries in this vault's namespace)
    if (this.isAvailable()) {
      this.clearAllVaultSecrets();
    }

    // 2. Build stripped settings
    const current = getSettings();
    const stripped = stripKeychainFields(current) as CopilotSettings & {
      _diskSecretsCleared?: boolean;
    };
    stripped._diskSecretsCleared = true;

    // 3. Clean legacy fields and write to data.json
    const toSave = cleanupLegacyFields(stripped);
    let diskSaveSucceeded = false;
    try {
      await saveData(toSave);
      refreshDiskState(toSave);
      diskSaveSucceeded = true;
    } catch (error) {
      // Keychain is already cleared. data.json may retain stale values.
      console.error("forgetAllSecrets: saveData failed after keychain clear", error);
    }

    // 4. Always sync in-memory state — even if saveData failed — to prevent
    // the next normal persist from writing old secrets back to keychain.
    // Reason: when disk save succeeded, the caller suppresses the subscriber
    // persist (to avoid double-write). When it failed, we notify the caller
    // so it does NOT suppress — letting the subscriber retry the disk write.
    if (!diskSaveSucceeded && onDiskSaveFailed) {
      onDiskSaveFailed();
    }
    syncMemory(stripped);

    // 5. Notify user
    if (diskSaveSucceeded) {
      new Notice("All API keys for this vault removed. Please re-enter them.");
    } else {
      new Notice(
        "API keys removed from this vault's keychain and memory, but data.json save failed. " +
          "Old disk copies remain until the next successful save."
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Backfill and hydrate model-level secrets for a scope. */
  private async backfillModelSecrets(
    scope: ModelScope,
    models: CustomModel[]
  ): Promise<{ models: CustomModel[]; backfilled: boolean; hadFailures: boolean }> {
    if (!models?.length) return { models, backfilled: false, hadFailures: false };

    let backfilled = false;
    let hadFailures = false;
    const result: CustomModel[] = [];

    for (const model of models) {
      const identity = getModelKeyFromModel(model);
      const copy = { ...model };

      for (const field of MODEL_SECRET_FIELDS) {
        const diskValue = model[field];

        // Reason: wrap keychain reads in try/catch so a locked/unavailable keychain
        // at startup degrades to disk values instead of aborting plugin load.
        let keychainValue: string | null;
        try {
          keychainValue = this.getModelSecret(scope, identity, field);
        } catch (e) {
          console.warn(`Keychain read failed for model "${identity}" field "${field}".`, e);
          hadFailures = true;
          // Reason: decrypt disk value so `enc_*` ciphertext doesn't flow into
          // provider requests. If decryption fails, keep original value.
          if (typeof diskValue === "string" && diskValue.length > 0) {
            const plaintext = await getDecryptedKey(diskValue);
            if (plaintext) {
              (copy as unknown as Record<string, unknown>)[field] = plaintext;
            }
          }
          continue;
        }

        if (keychainValue === "") {
          // Tombstone
          (copy as unknown as Record<string, unknown>)[field] = "";
          continue;
        }

        if (keychainValue !== null) {
          (copy as unknown as Record<string, unknown>)[field] = keychainValue;
          continue;
        }

        // Keychain null — try backfill from disk
        if (typeof diskValue === "string" && diskValue.length > 0) {
          const plaintext = await getDecryptedKey(diskValue);
          if (plaintext && plaintext.length > 0) {
            try {
              this.setModelSecret(scope, identity, field, plaintext);
              // Reason: only count as backfilled when the keychain write succeeds.
              // See top-level backfill comment for rationale.
              backfilled = true;
            } catch (e) {
              console.warn(
                `Keychain backfill write failed for model "${identity}" field "${field}".`,
                e
              );
              hadFailures = true;
            }
            (copy as unknown as Record<string, unknown>)[field] = plaintext;
            continue;
          }
          console.warn(
            `Keychain backfill: failed to decrypt model "${field}" for "${identity}" — skipping.`
          );
          hadFailures = true;
          continue;
        }

        // Both keychain and disk empty — no value available for this field.
      }

      result.push(copy);
    }

    return { models: result, backfilled, hadFailures };
  }

  /** Collect model-level secret entries and cleared IDs without modifying models. */
  private collectModelSecrets(
    scope: ModelScope,
    models: CustomModel[],
    secretEntries: Array<[string, string]>,
    prevModels?: CustomModel[],
    clearedSecretIds?: string[]
  ): void {
    if (!models?.length) return;

    const prevModelMap = new Map<string, CustomModel>();
    if (prevModels) {
      for (const m of prevModels) {
        prevModelMap.set(getModelKeyFromModel(m), m);
      }
    }

    for (const model of models) {
      const identity = getModelKeyFromModel(model);
      const prevModel = prevModelMap.get(identity);

      for (const field of MODEL_SECRET_FIELDS) {
        const value = model[field];
        const id = toModelKeychainId(this.vaultId, scope, identity, field);

        if (typeof value === "string" && value.length > 0) {
          secretEntries.push([id, value]);
        } else if (prevModel && clearedSecretIds) {
          const prevValue = prevModel[field];
          if (typeof prevValue === "string" && prevValue.length > 0) {
            clearedSecretIds.push(id);
          }
        }
      }
    }
  }

  /** Find keychain IDs for models deleted from a specific scope. */
  private getDeletedModelKeysForScope(
    scope: ModelScope,
    prevModels: CustomModel[] | undefined,
    currentModels: CustomModel[]
  ): string[] {
    if (!prevModels?.length) return [];

    const currentIds = new Set((currentModels ?? []).map(getModelKeyFromModel));

    return prevModels
      .filter((m) => !currentIds.has(getModelKeyFromModel(m)))
      .flatMap((m) => {
        const identity = getModelKeyFromModel(m);
        return MODEL_SECRET_FIELDS.map((field) =>
          toModelKeychainId(this.vaultId, scope, identity, field)
        );
      });
  }
}
