import { type App, type SecretStorage, FileSystemAdapter } from "obsidian";
import { type CopilotSettings, getModelKeyFromModel, getSettings } from "@/settings/model";
import { type CustomModel } from "@/aiParams";
import { isSensitiveKey } from "@/encryptionService";
import {
  stripKeychainFields,
  cleanupLegacyFields,
  isKeychainOnly,
  MODEL_SECRET_FIELDS,
  TOP_LEVEL_SECRET_FIELDS,
} from "@/services/settingsSecretTransforms";
import { Notice } from "obsidian";
import { md5 } from "@/utils/hash";
// Reason: do NOT import logInfo/logWarn/logError here. The logger depends on
// getSettings(), but this module runs during settings loading (before setSettings).
// Use console.* directly for all logging in this file.

/**
 * Fields that are sensitive but don't match the `isSensitiveKey()` heuristic.
 * Reason: `isSensitiveKey()` is the canonical source of truth for sensitive fields.
 * Add entries here only for fields that are NOT covered by `isSensitiveKey()`.
 */
const EXTRA_SECRET_KEYS: readonly string[] = [];

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
 * Reason: on desktop, MD5 of the filesystem base path gives a deterministic
 * seed so the very first run on an existing vault produces a predictable ID.
 * On mobile (no basePath), falls back to random bytes from `crypto.getRandomValues`
 * — guaranteeing per-vault isolation on the device at the cost of non-determinism
 * before `_keychainVaultId` is persisted and synced. When `getRandomValues` is
 * absent, a last-resort MD5 of the string `${Date.now()}-${Math.random()}` is used.
 *
 * Subsequent runs use the persisted `_keychainVaultId` and never re-derive.
 */
function generateVaultId(app: App): string {
  const basePath = getVaultBasePath(app);
  if (basePath) {
    return md5(basePath).slice(0, 8);
  }
  // Reason: on mobile, basePath is unavailable. Use a random ID to guarantee
  // vault isolation — two same-named vaults on one device will NOT share
  // keychain entries. The load path persists this ID to data.json immediately,
  // so the divergence window is limited to first-run before sync propagates.
  // Reason: guard getRandomValues existence — optional chaining on a missing
  // method silently returns undefined, leaving the buffer zero-filled and
  // collapsing all affected vaults to "00000000". Use `window.crypto` rather
  // than `globalThis.crypto` (project rule `obsidianmd/no-global-this`); both
  // resolve to the same WebCrypto instance in Obsidian's Electron renderer
  // and mobile WebView.
  const cryptoApi = window.crypto;
  if (typeof cryptoApi?.getRandomValues === "function") {
    const bytes = new Uint8Array(4);
    cryptoApi.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  return md5(`${Date.now()}-${Math.random()}`).slice(0, 8);
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
  const hash = md5(raw).slice(0, 8);
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
 *
 * DESIGN NOTE — intentionally does NOT run through `normalizeKeychainId()`.
 * Every current top-level secret key is plain camelCase (validated by
 * `isSecretKey` against a fixed heuristic + EXTRA_SECRET_KEYS list), so the
 * regex pipeline above produces a clean kebab-case id. Routing through the
 * full normalizer would add a hash suffix to every id and break id stability
 * for existing keychain entries. If a future field with unusual characters
 * is added to EXTRA_SECRET_KEYS, revisit. Point future reviewers here.
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
  const hash = md5(settingsKey).slice(0, 8);
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

/** Result of a keychain-only hydrate pass. */
export interface HydrateResult {
  settings: CopilotSettings;
  /** True if any keychain read failed — caller may need to fall back to disk. */
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
  // DESIGN NOTE — intentionally only checks for the `secretStorage` object,
  // not individual methods (`getSecret`/`setSecret`/`listSecrets`). Obsidian
  // ships SecretStorage as a single API surface (1.11.4); there is no
  // released version where the object exists but methods are missing.
  // Capability-probing each method would add branching for a partial-API
  // world that does not exist. If a future review flags this again, point
  // them at this note.
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

  // Reason: deleteSecret exists at runtime but is not in the official type
  // definitions. Prefer real deletion; fall back to empty-string tombstone.
  private removeSecret(id: string): void {
    if (typeof this.storage.deleteSecret === "function") {
      this.storage.deleteSecret(id);
    } else {
      this.storage.setSecret(id, "");
    }
  }

  /** Write a value directly to the keychain using a pre-computed ID. */
  setSecretById(keychainId: string, value: string): void {
    this.storage.setSecret(keychainId, value);
  }

  /** Delete a keychain entry by its pre-computed ID. */
  deleteSecretById(keychainId: string): void {
    this.removeSecret(keychainId);
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
  // hydrateFromKeychain — read-only keychain hydration
  // ---------------------------------------------------------------------------

  /**
   * Replace each secret field in `settings` with the keychain value for that
   * field. This method is strictly read-only — it never writes to the keychain
   * and never reads from disk. The simplified opt-in flow performs all keychain
   * writes through `persistSecrets()` (normal saves) or
   * `migrateDiskSecretsToKeychain()` (one-shot user action).
   *
   * Per-field logic:
   * - keychain `""` (tombstone) → set field to `""` (don't resurrect)
   * - keychain has value → use keychain value
   * - keychain `null` → leave the field as-is (caller already loaded from disk
   *   when appropriate; in keychain-only mode `null` simply means "no value")
   *
   * @param settings - Sanitised settings. Values are replaced in a shallow copy.
   * @returns Updated settings with secrets hydrated from the keychain, plus
   *   whether any keychain read threw (so the caller can surface a warning).
   */
  async hydrateFromKeychain(settings: CopilotSettings): Promise<HydrateResult> {
    const hydrated = { ...settings };
    let hadFailures = false;

    // Top-level secrets.
    //
    // Reason: iterate the union of (a) the canonical default secret fields and
    // (b) any secret-shaped keys already on the loaded settings. Hydrating
    // strictly from `Object.keys(hydrated)` would skip fields whose entries
    // exist in this device's keychain but are missing from `data.json` (e.g.
    // partial sync from a downgraded device, schema additions that predate
    // the user's last save, or a manually-edited data.json). Including legacy
    // keys still present on the settings object preserves support for fields
    // that have since been removed from DEFAULT_SETTINGS.
    const topLevelKeys = new Set<string>([
      ...TOP_LEVEL_SECRET_FIELDS,
      ...Object.keys(hydrated).filter((key) => isSecretKey(key)),
    ]);
    for (const key of topLevelKeys) {
      // Reason: wrap keychain reads in try/catch so a locked/unavailable keychain
      // at startup degrades gracefully instead of aborting plugin load.
      let keychainValue: string | null;
      try {
        keychainValue = this.getSecret(key);
      } catch (e) {
        console.warn(`Keychain read failed for "${key}".`, e);
        hadFailures = true;
        continue;
      }

      if (keychainValue === "") {
        // Tombstone — field was explicitly deleted, don't resurrect.
        (hydrated as unknown as Record<string, unknown>)[key] = "";
      } else if (keychainValue !== null) {
        (hydrated as unknown as Record<string, unknown>)[key] = keychainValue;
      }
      // null → leave existing in-memory value untouched.
    }

    // Model-level secrets
    const modelResult = await this.hydrateModelSecrets("chat", hydrated.activeModels ?? []);
    hydrated.activeModels = modelResult.models;
    hadFailures = hadFailures || modelResult.hadFailures;

    const embeddingResult = await this.hydrateModelSecrets(
      "embedding",
      hydrated.activeEmbeddingModels ?? []
    );
    hydrated.activeEmbeddingModels = embeddingResult.models;
    hadFailures = hadFailures || embeddingResult.hadFailures;

    if (hadFailures) {
      console.warn("Keychain hydrate: some keychain reads failed — values left as-is.");
    }

    return { settings: hydrated, hadFailures };
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
   * Delete all keychain entries belonging to this vault's namespace.
   *
   * Reason: uses `removeSecret()` which prefers real deletion via the
   * undocumented `deleteSecret()` and falls back to empty-string tombstone.
   * Resurrection from data.json is prevented by `_diskSecretsCleared = true`
   * (set by the caller after this method succeeds).
   */
  clearAllVaultSecrets(): void {
    const vaultPrefix = `copilot-v${this.vaultId}-`;
    // Reason: defensive feature detection. The destructive flow already
    // stripped data.json by the time it reaches us; if `listSecrets()` is
    // missing on this Obsidian build we cannot enumerate vault entries and
    // would silently leave them behind to resurrect on the next hydrate.
    // Surface this as a hard failure so the caller can preserve disk state.
    if (typeof this.storage.listSecrets !== "function") {
      throw new Error(
        "Obsidian Keychain on this build does not support listing entries; " +
          "cannot guarantee a complete clear."
      );
    }
    const allIds = this.storage.listSecrets();
    const failures: string[] = [];
    for (const id of allIds) {
      if (id.startsWith(vaultPrefix)) {
        try {
          this.removeSecret(id);
        } catch {
          failures.push(id);
        }
      }
    }
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
    // 0. Refuse the operation in a stranded vault (keychain-only mode but
    // SecretStorage unavailable on this build). Otherwise we'd strip disk and
    // memory while leaving the existing OS keychain entries intact — the user
    // would believe their keys are gone, then watch them reappear after
    // upgrading Obsidian or opening the vault on a capable build. Refusing
    // up-front keeps the destructive intent honest.
    const current = getSettings();
    if (isKeychainOnly(current) && !this.isAvailable()) {
      throw new Error(
        "Cannot delete API keys from the Obsidian Keychain because Secure Storage is " +
          "unavailable in this Obsidian build. Update Obsidian to 1.11.4 or later, or open " +
          "this vault on a device with Keychain access, then try again."
      );
    }
    // Reason: if Keychain is available but lacks `listSecrets()`, we cannot
    // enumerate vault entries to clear them. Refuse BEFORE stripping disk so
    // we don't leave the user with stripped data.json AND residual Keychain
    // entries that would resurrect on next hydrate.
    if (this.isAvailable() && typeof this.app.secretStorage?.listSecrets !== "function") {
      throw new Error(
        "Cannot delete all API keys because this Obsidian build does not support " +
          "enumerating Keychain entries. Update Obsidian to a newer version and retry."
      );
    }

    // 1. Build stripped settings — before touching any durable store.
    const stripped = stripKeychainFields(current) as CopilotSettings & {
      _keychainOnly?: boolean;
    };
    // Reason: only flip the vault into keychain-only mode when Secure Storage
    // is actually usable on this build. Without it, the subsequent persist
    // path treats the vault as "stranded" and silently strips any newly
    // entered API keys from data.json — turning "Delete All Keys" into a
    // one-click way to brick auth setup on older Obsidian builds. A vault
    // that was already keychain-only stays that way through
    // `stripKeychainFields(current)`, so this guard never accidentally
    // downgrades a stranded vault.
    if (this.isAvailable()) {
      stripped._keychainOnly = true;
    }

    // 2. Write stripped data.json BEFORE clearing keychain.
    // Reason: if a crash occurs after keychain clear but before disk write,
    // the next startup sees "keychain empty + disk has secrets" and backfill
    // revives the deleted keys. Writing disk first closes that window.
    const toSave = cleanupLegacyFields(stripped);
    try {
      await saveData(toSave);
      refreshDiskState(toSave);
    } catch (error) {
      console.error("forgetAllSecrets: saveData failed — aborting keychain clear", error);
      if (onDiskSaveFailed) onDiskSaveFailed();
      new Notice(
        "Failed to remove API keys from data.json. Obsidian Keychain was NOT cleared. Please try again."
      );
      return;
    }

    // 3. Clear keychain AFTER disk is safely stripped.
    let keychainError: Error | undefined;
    if (this.isAvailable()) {
      try {
        this.clearAllVaultSecrets();
      } catch (e) {
        keychainError = e instanceof Error ? e : new Error(String(e));
      }
    }

    // 4. Always sync in-memory state — even on partial keychain failure.
    // Reason: disk is already stripped. If we leave old secrets in memory,
    // the next normal persist would write them back to keychain/data.json.
    syncMemory(stripped);

    if (keychainError) {
      // KNOWN LIMITATION: this path emits a Notice and then throws, which the
      // UI caller also catches and Notices — producing two Notices with
      // slightly conflicting copy. Triggering requires `clearAllVaultSecrets()`
      // to throw mid-operation (very rare in practice). A user retry generally
      // resolves the residual keychain entries. Restructuring to return a
      // result object instead of throw+Notice is a separate UX cleanup, out of
      // scope for this PR.
      new Notice(
        "Some Obsidian Keychain entries could not be removed. " +
          "Your keys have been cleared from data.json and memory. Please restart and retry."
      );
      throw keychainError;
    }

    new Notice("All API keys for this vault removed. Please re-enter them.");
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Hydrate model-level secrets for a scope (read-only). */
  private async hydrateModelSecrets(
    scope: ModelScope,
    models: CustomModel[]
  ): Promise<{ models: CustomModel[]; hadFailures: boolean }> {
    if (!models?.length) return { models, hadFailures: false };

    let hadFailures = false;
    const result: CustomModel[] = [];

    for (const model of models) {
      const identity = getModelKeyFromModel(model);
      const copy = { ...model };

      for (const field of MODEL_SECRET_FIELDS) {
        let keychainValue: string | null;
        try {
          keychainValue = this.getModelSecret(scope, identity, field);
        } catch (e) {
          console.warn(`Keychain read failed for model "${identity}" field "${field}".`, e);
          hadFailures = true;
          continue;
        }

        if (keychainValue === "") {
          (copy as unknown as Record<string, unknown>)[field] = "";
        } else if (keychainValue !== null) {
          (copy as unknown as Record<string, unknown>)[field] = keychainValue;
        }
        // null → leave existing in-memory value untouched.
      }

      result.push(copy);
    }

    return { models: result, hadFailures };
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
        // Reason: only tombstone models that actually had a secret value.
        // Without this guard, importing to a fresh vault creates spurious
        // tombstones for default models that never had an API key.
        return MODEL_SECRET_FIELDS.flatMap((field) => {
          const prevValue = (m as unknown as Record<string, unknown>)[field];
          if (typeof prevValue !== "string" || prevValue.length === 0) {
            return [];
          }
          return [toModelKeychainId(this.vaultId, scope, identity, field)];
        });
      });
  }
}
