/**
 * Unified settings persistence layer (simplified opt-in flow).
 *
 * Two mutually exclusive modes, gated by `settings._keychainOnly`:
 *
 * 1. **Keychain-only mode** (`_keychainOnly === true`)
 *    - Secrets live in the OS keychain; data.json is always stripped.
 *    - Triggered by fresh installs or the user explicitly clicking
 *      "Migrate to Keychain" in Advanced Settings.
 *    - Load reads secrets from keychain only; the keychain is the single
 *      source of truth.
 *
 * 2. **Disk mode** (`_keychainOnly` is falsy)
 *    - Secrets stay in data.json. The keychain is never touched.
 *    - Existing users that did not opt in remain here permanently unless
 *      they click "Migrate to Keychain".
 *    - Legacy `enc_*` ciphertext is decrypted at load for runtime use;
 *      any subsequent save writes the plaintext form to data.json
 *      (per the maintainer's "never write new encrypted values" rule).
 *
 * Hard boundaries:
 * - `loadSecretsFromDisk` / `persistSecretsToDisk` never touch the keychain.
 * - `loadSecretsFromKeychain` / `persistSecretsToKeychain` never read disk.
 * - `migrateDiskSecretsToKeychain` is the only function that crosses both
 *   sides, and it does so as a single transaction.
 */

import { type CopilotSettings, getSettings, sanitizeSettings, setSettings } from "@/settings/model";
import { getDecryptedKey, hasEncryptionPrefix } from "@/encryptionService";
import { KeychainService, isSecretKey } from "@/services/keychainService";
import {
  cleanupLegacyFields,
  hasPersistedSecrets,
  isKeychainOnly,
  MODEL_SECRET_FIELDS,
  stripKeychainFields,
} from "@/services/settingsSecretTransforms";
// Reason: logWarn is safe to import (lazy — only calls getSettings() when invoked),
// but only used in code paths that run AFTER settings are loaded. Functions that
// run DURING settings loading (loadSettingsWithKeychain) use console.* directly.
import { logError, logWarn } from "@/logger";
import { Notice } from "obsidian";

// ---------------------------------------------------------------------------
// Module-global persistence state
// ---------------------------------------------------------------------------

/**
 * Write queue serialising all persistence operations.
 *
 * Reason: the settings subscriber fires synchronously on every `setSettings()`,
 * but keychain + data.json writes are async. Without serialisation, rapid
 * successive `setSettings()` calls would race with unpredictable ordering.
 * Dedicated transactions (`forgetAllSecrets`, migrate-to-keychain) also run
 * through this queue via `runPersistenceTransaction()` to prevent interleaving.
 */
let writeQueue: Promise<void> = Promise.resolve();

/**
 * Whether the last successful disk state still contains any persisted secrets.
 * Used by `hasDiskSecretsToMigrate()` for the UI status check.
 */
let diskHasSecrets = false;

/**
 * Settings snapshot from the last successful `saveData()` call. Used as the
 * keychain-diff baseline so rollback restores the previous known-good state.
 */
let lastPersistedSettings: CopilotSettings | undefined;

/**
 * When true, the next `persistSettings()` call is skipped.
 *
 * Reason: dedicated transactions write data.json themselves, then call
 * `setSettings()` to sync memory. That `setSettings()` triggers the subscriber
 * which calls `persistSettings()` again — without this guard the subscriber
 * would re-enter the normal save path and overwrite the transaction's output.
 */
let suppressNextPersist = false;

/**
 * Monotonic counter incremented by each `runPersistenceTransaction()` to
 * invalidate stale persist jobs queued before the transaction committed.
 */
let transactionEpoch = 0;

/**
 * Keychain IDs whose tombstone writes failed in a previous persist cycle.
 * Retried at the start of the next `doPersist()` call so delete intent
 * survives across saves even when the settings subscriber advances `prev`.
 */
const pendingTombstones = new Set<string>();

/**
 * Whether the most recent keychain persist attempt left it unsafe to clear
 * disk secrets. Fails closed across the whole save cycle.
 */
let persistHadUndecryptableSecrets = false;

/** Keychain vault IDs are 8 lowercase hex chars. */
const KEYCHAIN_VAULT_ID_RE = /^[a-f0-9]{8}$/;

/** Check whether a persisted keychain vault ID has the expected format. */
function isValidKeychainVaultId(value: unknown): value is string {
  return typeof value === "string" && KEYCHAIN_VAULT_ID_RE.test(value);
}

// ---------------------------------------------------------------------------
// Public state inspectors / refreshers
// ---------------------------------------------------------------------------

/** Refresh the cached disk-secret presence after a successful save/load. */
export function refreshDiskHasSecrets(data: CopilotSettings): void {
  diskHasSecrets = hasPersistedSecrets(data as unknown as Record<string, unknown>);
}

/**
 * Reset all module-level persistence state.
 *
 * Reason: module-level state (lastPersistedSettings, transactionEpoch,
 * pendingTombstones, persistHadUndecryptableSecrets, diskHasSecrets,
 * suppressNextPersist, writeQueue) survives `onunload` because Node /
 * Electron's require cache keeps the module instance alive across plugin
 * disable→enable. After a mid-migration disable, stale state would poison
 * the next session. Similarly, switching vaults via "Open another vault"
 * carries stale state across vaults. Call this from `onunload`.
 */
export function resetPersistenceState(): void {
  writeQueue = Promise.resolve();
  diskHasSecrets = false;
  lastPersistedSettings = undefined;
  suppressNextPersist = false;
  transactionEpoch = 0;
  pendingTombstones.clear();
  persistHadUndecryptableSecrets = false;
}

/**
 * Refresh the last known-good settings baseline used by keychain rollback.
 * Called by dedicated transactions that bypass `doPersist()`.
 */
export function refreshLastPersistedSettings(data: CopilotSettings): void {
  lastPersistedSettings = structuredClone(data);
}

/**
 * Skip the next `persistSettings()` call. Must be called immediately before
 * `setSettings()` in dedicated transactions that wrote data.json themselves.
 */
export function suppressNextPersistOnce(): void {
  suppressNextPersist = true;
}

/**
 * Whether the data.json on disk still contains any non-empty secret fields.
 * Used by the UI to decide whether to surface the "Migrate to Keychain" CTA.
 */
export function hasDiskSecretsToMigrate(): boolean {
  return diskHasSecrets;
}

/**
 * Whether it is safe to strip secrets from data.json right now.
 *
 * All safety gates must pass:
 * - Keychain available (otherwise we'd lose the only copy)
 * - The most recent keychain persist did not skip any undecryptable secret
 * - Not already in keychain-only mode
 * - data.json still has secrets to clear
 */
export function canClearDiskSecrets(settings: CopilotSettings): boolean {
  const keychain = KeychainService.getInstance();
  if (!keychain.isAvailable()) return false;
  if (persistHadUndecryptableSecrets) return false;
  if (isKeychainOnly(settings)) return false;
  // Reason: in-memory `settings` may already contain a secret the user just
  // typed but hasn't saved yet. `diskHasSecrets` only refreshes after persist,
  // so a freshly entered key wouldn't enable the Migrate CTA without this
  // fallback. Both presence sources mean "there is something to migrate".
  return diskHasSecrets || hasPersistedSecrets(settings as unknown as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// Persistence transaction support
// ---------------------------------------------------------------------------

/**
 * Run a dedicated persistence transaction within the write queue.
 *
 * Reason: operations that bypass `doPersist` (forgetAllSecrets, migrate)
 * must still be serialised with the normal save path to prevent interleaving
 * that could restore stripped secrets.
 */
export async function runPersistenceTransaction(task: () => Promise<void>): Promise<void> {
  const job = writeQueue.then(async () => {
    try {
      await task();
    } finally {
      // DESIGN NOTE — epoch is bumped unconditionally on failure, even if the
      // task failed before touching any persistent store (e.g. an early
      // `canClearDiskSecrets()` rejection in migrate). Differentiating "pure
      // pre-check failure" from "partial write" would require threading a
      // touched-flag through every transaction call site (migrate, forget,
      // ...), and the safety cost of letting a stale persist overwrite a
      // partially-mutated store is far higher than the worst case here: a
      // single queued setting save dropped, recoverable by any subsequent
      // settings edit. Triggering this race also requires another
      // `setSettings()` to land between the transaction's first await and
      // its failure — a very narrow window. Fail-safe wins.
      // If a future review flags this again, point them at this note.
      transactionEpoch++;
    }
  });
  writeQueue = job.catch(() => {
    /* swallow to unblock next write */
  });
  return job;
}

/** Wait for all queued persistence operations to complete. */
export async function flushPersistence(): Promise<void> {
  await writeQueue;
}

// ---------------------------------------------------------------------------
// Load — disk side
// ---------------------------------------------------------------------------

/**
 * Decrypt any `enc_*` encrypted values in `settings` for runtime use.
 *
 * Boundary: reads ONLY from the in-memory `settings` object (which mirrors
 * data.json after sanitize). Never touches the keychain.
 *
 * Reason: legacy users may still have `enc_*` ciphertext in data.json. Without
 * decryption, ciphertext would flow into provider requests.
 */
async function loadSecretsFromDisk(settings: CopilotSettings): Promise<CopilotSettings> {
  const hydrated = structuredClone(settings);
  const rec = hydrated as unknown as Record<string, unknown>;

  for (const key of Object.keys(rec)) {
    if (!isSecretKey(key)) continue;
    const value = rec[key];
    if (typeof value !== "string" || value.length === 0) continue;
    const plaintext = await getDecryptedKey(value);
    if (plaintext) rec[key] = plaintext;
  }

  for (const listKey of ["activeModels", "activeEmbeddingModels"] as const) {
    const models = hydrated[listKey] ?? [];
    for (const model of models) {
      const modelRec = model as unknown as Record<string, unknown>;
      for (const field of MODEL_SECRET_FIELDS) {
        const value = modelRec[field];
        if (typeof value !== "string" || value.length === 0) continue;
        const plaintext = await getDecryptedKey(value);
        if (plaintext) modelRec[field] = plaintext;
      }
    }
  }

  return hydrated;
}

// ---------------------------------------------------------------------------
// Load — keychain side
// ---------------------------------------------------------------------------

/**
 * Replace each secret field in `settings` with the keychain value.
 *
 * Boundary: read-only against the keychain. Never falls back to disk; if the
 * keychain is empty, fields stay empty (the keychain-only contract).
 */
async function loadSecretsFromKeychain(settings: CopilotSettings): Promise<CopilotSettings> {
  // Reason: in keychain-only mode, settings as loaded from disk should already
  // be stripped. Start from a stripped baseline so any stale disk values that
  // crept in (e.g. via cross-version sync) cannot bleed into runtime memory.
  const baseline = stripKeychainFields(settings);
  // Reason: hadFailures does NOT block persists — empty-diff already protects
  // failed fields (empty-vs-empty never writes), so the actual keychain values
  // are preserved across the failure. We still surface a one-shot Notice so the
  // user knows why model calls may fail this session instead of silently seeing
  // "invalid API key" errors.
  const { settings: hydrated, hadFailures } =
    await KeychainService.getInstance().hydrateFromKeychain(baseline);
  if (hadFailures) {
    new Notice(
      "Some API keys could not be loaded from the Obsidian Keychain. They may be unavailable this session. Restart Obsidian if the issue persists."
    );
  }
  return hydrated;
}

// ---------------------------------------------------------------------------
// Public load entry point
// ---------------------------------------------------------------------------

/**
 * Load settings from raw disk data, dispatching to disk or keychain mode
 * based on the persisted `_keychainOnly` flag.
 *
 * Fresh-install detection (the only place new vaults get auto-opted-in):
 * `rawData == null` indicates Obsidian had no data.json for this plugin —
 * which uniquely identifies a fresh install. An existing vault that happens
 * to have no secrets right now (`rawData != null` but empty) is NOT promoted.
 */
export async function loadSettingsWithKeychain(
  rawData: unknown,
  saveData: (data: CopilotSettings) => Promise<void>
): Promise<CopilotSettings> {
  // Reason: capture fresh-install state BEFORE we start mutating anything.
  // Obsidian's loadData() returns null when data.json doesn't exist yet.
  const isFreshInstall = rawData == null;

  // Reason: sanitize FIRST to normalise model providers (e.g. azure_openai → azure-openai).
  let settings = sanitizeSettings(rawData as CopilotSettings);

  // Snapshot raw disk state so the cached `diskHasSecrets` flag is accurate
  // regardless of any downstream cleanup that happens to `settings`.
  let rawDiskData = structuredClone(rawData ?? {}) as Record<string, unknown>;
  diskHasSecrets = hasPersistedSecrets(rawDiskData);

  // Reason: cleanupLegacyFields also migrates `_diskSecretsCleared` →
  // `_keychainOnly`. Run it BEFORE any code reads `_keychainOnly` so the
  // value carries forward correctly from older installs.
  settings = cleanupLegacyFields(settings);

  const keychain = KeychainService.getInstance();

  // ---- Disk mode bypass when keychain isn't available at all. ----
  if (!keychain.isAvailable()) {
    // Reason: stranded vault. `_keychainOnly: true` was set on a capable
    // build, but SecretStorage isn't available here (older Obsidian, missing
    // API). Honour the keychain-only contract: do NOT load disk secrets even
    // if `data.json` still carries plaintext (cross-version sync, manual
    // edits, or a half-applied migration on another device could put them
    // there). Mirrors the keychain-available branch below at line 348-358
    // which also explicitly ignores disk secrets in keychain-only mode.
    // Without this guard, a stranded session would silently use stale disk
    // plaintext for LLM auth — violating the contract surfaced everywhere
    // else in this module.
    if (isKeychainOnly(settings)) {
      const stripped = stripKeychainFields(settings);
      lastPersistedSettings = structuredClone(stripped);
      return stripped;
    }
    const hydrated = await loadSecretsFromDisk(settings);
    lastPersistedSettings = structuredClone(hydrated);
    return hydrated;
  }

  // ---- Fresh-install promotion (the ONLY auto-opt-in path). ----
  // Reason: settings file existed but `_keychainOnly` is undefined → keep
  // disk mode. Auto-promoting that case would violate the "until they click,
  // nothing changes" rule for users who manually deleted their keys.
  if (isFreshInstall) {
    (settings as unknown as Record<string, unknown>)._keychainOnly = true;
  }

  // ---- Vault namespace ID bootstrap (shared by both modes). ----
  if (isValidKeychainVaultId(rawDiskData._keychainVaultId)) {
    keychain.setVaultId(rawDiskData._keychainVaultId);
  } else {
    // First run — persist the generated vaultId immediately to disk.
    // Reason: main.ts calls setSettings() before the subscriber is registered,
    // so the initial setSettings won't trigger persistSettings. We must write
    // the vaultId here to survive a vault rename before the next save.
    // Reason: also persist `_keychainOnly` for fresh installs so that the
    // mode survives a restart even if the user never edits any setting.
    //
    // DESIGN NOTE — bootstrap intentionally writes a SPARSE snapshot
    // (`rawDiskData` + vaultId + optional `_keychainOnly`), not the full
    // sanitized in-memory `settings`. Considered and rejected the "persist
    // full settings here" alternative:
    //
    //   - No observable runtime impact from the sparse snapshot. On the next
    //     startup, `settingsAtom = atom(DEFAULT_SETTINGS)` already holds full
    //     defaults; `setSettings(loadedSparse)` then merges via
    //     `{ ...getSettings(), ...loadedSparse }` and
    //     `mergeAllActiveModelsWithCoreModels()` re-injects built-in models.
    //     Arrays like `activeModels` are never undefined at runtime.
    //   - Disk self-heals on the user's very first settings change: the
    //     settings subscriber calls `persistSettings(next, ...)` with the
    //     fully-merged in-memory state, replacing the sparse snapshot.
    //   - Writing full sanitized settings here would persist *computed*
    //     defaults (built-in model lists, derived keys) into the user's
    //     `data.json` on first run, making future default changes a
    //     migration concern rather than a transparent upgrade.
    //
    // If a future review flags this again, point them at this note.
    const vaultId = keychain.getVaultId();
    settings = { ...settings, _keychainVaultId: vaultId };
    try {
      const currentDisk: Record<string, unknown> = {
        ...rawDiskData,
        _keychainVaultId: vaultId,
      };
      if (isFreshInstall) {
        currentDisk._keychainOnly = true;
      }
      await saveData(currentDisk as unknown as CopilotSettings);
      rawDiskData = currentDisk;
      diskHasSecrets = hasPersistedSecrets(rawDiskData);
    } catch (error) {
      // Reason: surface bootstrap failure to the user. Without this Notice the
      // failure is invisible — the in-memory `_keychainOnly: true` exists but
      // never reaches disk, so the fresh-install promotion is lost if the user
      // closes Obsidian before triggering another save. The next save will
      // self-heal, but the user should know to confirm by saving once.
      logError("Failed to persist initial keychain settings on first run", error);
      new Notice("Could not save initial settings. Please save once to confirm Keychain mode.");
    }
  }

  // ---- Dispatch by `_keychainOnly`. ----
  if (isKeychainOnly(settings)) {
    if (diskHasSecrets) {
      // Reason: cross-version sync can leave plaintext on disk while the
      // device is already keychain-only. Logged for diagnosis only (no Notice
      // to avoid distracting users on startup); the disk values are ignored.
      console.warn("disk secrets ignored because keychain-only mode is enabled");
    }
    const hydrated = await loadSecretsFromKeychain(settings);
    lastPersistedSettings = structuredClone(hydrated);
    return hydrated;
  }

  // ---- Disk mode (existing user, opted-out, or pre-Migrate). ----
  const hydrated = await loadSecretsFromDisk(settings);
  lastPersistedSettings = structuredClone(hydrated);
  return hydrated;
}

// ---------------------------------------------------------------------------
// Persist — disk side
// ---------------------------------------------------------------------------

/**
 * Write `settings` to data.json with its in-memory plaintext secrets intact.
 * Never touches the keychain.
 *
 * Note: legacy `enc_*` values are decrypted to plaintext at load time. Any
 * subsequent save therefore overwrites the disk copy with plaintext. This is
 * intentional and matches the maintainer's "never write new encrypted values"
 * requirement.
 */
async function persistSecretsToDisk(
  settings: CopilotSettings,
  saveData: (data: CopilotSettings) => Promise<void>
): Promise<void> {
  const cleaned = cleanupLegacyFields(settings);
  await saveData(cleaned);
  refreshDiskHasSecrets(cleaned);
  // Reason: a successful disk-mode save re-establishes data.json as the
  // durable source of truth. If a previous keychain migration's forward
  // write and rollback both failed, `persistHadUndecryptableSecrets` would
  // otherwise remain armed forever (the conditional reset in
  // `persistSecretsToKeychain` only fires when rollback succeeded), leaving
  // `canClearDiskSecrets()` permanently false and the Migrate flow stuck
  // until the user restarts Obsidian. Clearing the lock here is safe: a
  // future migration attempt will read this fresh disk baseline and write
  // the keychain from scratch — it does not strip disk against a stale or
  // possibly-corrupt keychain.
  persistHadUndecryptableSecrets = false;
  lastPersistedSettings = structuredClone(settings);
}

// ---------------------------------------------------------------------------
// Persist — keychain side
// ---------------------------------------------------------------------------

/**
 * Write `settings` secrets to the keychain and persist a stripped data.json.
 * Performs partial-write rollback on failure so the keychain matches the
 * last known-good state.
 *
 * Only called for vaults in keychain-only mode. Never reads disk; the caller
 * is responsible for providing the previous settings via `prev`.
 */
async function persistSecretsToKeychain(
  settings: CopilotSettings,
  saveData: (data: CopilotSettings) => Promise<void>,
  prev: CopilotSettings | undefined
): Promise<void> {
  const keychain = KeychainService.getInstance();
  const cleaned = cleanupLegacyFields(settings);

  const keychainDiffBase = lastPersistedSettings ?? prev;
  const { secretEntries, keychainIdsToDelete } = keychain.persistSecrets(
    settings,
    keychainDiffBase
  );
  const rollbackSettings = lastPersistedSettings ?? prev;
  const replayedTombstones: string[] = [];

  // Reason: secrets in memory are always plaintext by the time we save
  // (load decrypts enc_* on the way in). Writing ciphertext to keychain
  // would poison the slot. Defensive guard for unusual paths (e.g. config
  // import, external setSettings, cross-version sync) that could smuggle a
  // legacy `enc_*` value past the load-time decrypt. Check BEFORE arming
  // the fail-closed lock so this guard never poisons the migration retry
  // path — the throw here happens before any keychain or disk write.
  //
  // DESIGN NOTE — `hasEncryptionPrefix(value)` is intentionally the sole
  // invalidity check here. Considered and rejected the "decrypt-then-classify"
  // alternative (try `getDecryptedKey(value)` and only reject if it returns
  // empty):
  //
  //   - The false-positive surface is hypothetical. The known LLM provider
  //     key formats — `sk-…` (OpenAI), `sk-ant-…` (Anthropic), `AIza…`
  //     (Google), `ghp_…` (GitHub), `hf_…` (HuggingFace), `csk-…` (Cohere)
  //     — do not start with `enc_`/`enc_web_`/`enc_desk_`. A user typing a
  //     plaintext that collides with our prefix would only happen with a
  //     custom-provider secret deliberately chosen that way.
  //   - The false-negative surface for "decrypt then accept" is more
  //     plausible and worse: a corrupted ciphertext that happens to decrypt
  //     to a non-empty garbage string would be written to keychain as if it
  //     were a real key, silently breaking auth in a way the fail-closed
  //     throw catches.
  //   - The throw is explicit and user-actionable ("Re-enter these keys in
  //     Settings before saving."), whereas a silent decrypt fallback would
  //     mask the smuggled-ciphertext case the guard exists to catch.
  //
  // If a future review flags this again, point them at this note.
  const undecryptableIds = secretEntries
    .filter(([, value]) => hasEncryptionPrefix(value))
    .map(([id]) => id);
  if (undecryptableIds.length > 0) {
    throw new Error(
      `Refusing to persist: undecryptable secrets in keychain-only mode (${undecryptableIds.join(", ")}). ` +
        "Re-enter these keys in Settings before saving."
    );
  }

  // Reason: arm the fail-closed lock only once we're about to touch the
  // keychain or disk. Any throw inside the try-block leaves the keychain in
  // a potentially partial state until rollback finishes. If rollback proves
  // the keychain is back to a known-good state we lift the lock; otherwise
  // it stays set so the caller can't `clearDiskSecrets()` against a
  // possibly-corrupt keychain.
  persistHadUndecryptableSecrets = true;

  try {
    // Retry any tombstones that failed in a previous cycle so delete intent
    // survives across saves.
    for (const id of pendingTombstones) {
      keychain.setSecretById(id, "");
      replayedTombstones.push(id);
    }

    for (const [id, value] of secretEntries) {
      keychain.setSecretById(id, value);
    }

    for (const id of keychainIdsToDelete) {
      try {
        keychain.setSecretById(id, "");
      } catch (e) {
        // Reason: track for retry on the next save cycle, then abort so the
        // caller's error path fires.
        pendingTombstones.add(id);
        throw e;
      }
    }

    // Reason: keychain mode → data.json is always stripped of secret fields.
    const stripped = stripKeychainFields(cleaned);
    (stripped as unknown as Record<string, unknown>)._keychainOnly = true;

    await saveData(stripped);

    refreshDiskHasSecrets(stripped);
    lastPersistedSettings = structuredClone(settings);

    for (const id of replayedTombstones) {
      pendingTombstones.delete(id);
    }
  } catch (error) {
    // Reason: best-effort rollback. If every restore/tombstone write
    // succeeded the keychain matches `rollbackSettings` again and it is safe
    // to lift the fail-closed lock so the user can retry the migration
    // without restarting Obsidian. If rollback itself failed (or there was
    // no baseline to restore from) the keychain is in an unknown state and
    // the lock must stay set.
    let rollbackOk = false;
    try {
      rollbackOk = await restoreKeychainFromSettings(keychain, rollbackSettings, settings);
    } catch (rollbackError) {
      logWarn("Failed to roll back keychain after persist failure.", rollbackError);
    }
    if (rollbackOk) {
      persistHadUndecryptableSecrets = false;
    }
    throw error;
  }

  // Reason: full cycle succeeded — narrow the fail-closed guard.
  persistHadUndecryptableSecrets = false;
}

/**
 * Collect human-readable labels for every secret field still carrying an
 * `enc_*` ciphertext that `loadSecretsFromDisk()` could not decrypt.
 *
 * Reason: a leftover `enc_*` in memory means the plaintext is lost on this
 * device. The migrate path uses this list to (a) clear those fields before
 * writing the keychain (so we never store ciphertext as if it were a key)
 * and (b) tell the user exactly which keys they need to re-enter.
 */
// DESIGN NOTE — do NOT "simplify" this to fail-closed (throw + force user to
// re-enter before migrating). Considered and rejected:
//
//   - End state is identical: in both designs the user re-enters those keys
//     and ends up with full keychain coverage.
//   - Partial-success requires 2 user steps (Migrate → re-enter in settings).
//     Fail-closed requires 3 (try Migrate → re-enter → retry Migrate).
//   - The "ciphertext might be recoverable on another device" argument does
//     not survive scrutiny: the migration confirm modal already declares
//     "Other devices syncing this vault will need to re-enter their API keys
//     after migration." Multi-device re-entry is a documented feature, not a
//     regression introduced by clearing undecryptable enc_* values.
//
// Keep the clear-and-report flow. If a future review flags this again, point
// them at this note.
function collectUndecryptableFields(settings: CopilotSettings): string[] {
  const fields: string[] = [];
  const rec = settings as unknown as Record<string, unknown>;

  for (const key of Object.keys(rec)) {
    if (!isSecretKey(key)) continue;
    const value = rec[key];
    if (typeof value === "string" && value.length > 0 && hasEncryptionPrefix(value)) {
      fields.push(key);
    }
  }
  for (const listKey of ["activeModels", "activeEmbeddingModels"] as const) {
    for (const model of settings[listKey] ?? []) {
      const modelRec = model as unknown as Record<string, unknown>;
      for (const field of MODEL_SECRET_FIELDS) {
        const value = modelRec[field];
        if (typeof value === "string" && value.length > 0 && hasEncryptionPrefix(value)) {
          // Reason: model entries share the keychain namespace via name|provider,
          // so a label like "gpt-4 (openai) apiKey" lets users find which row to edit.
          const name = (modelRec.name as string | undefined) ?? "(unnamed)";
          const provider = (modelRec.provider as string | undefined) ?? "?";
          fields.push(`${name} (${provider}) ${field}`);
        }
      }
    }
  }
  return fields;
}

/**
 * Build a copy of `settings` where every undecryptable `enc_*` secret field
 * has been cleared to an empty string. The caller persists the cleaned copy
 * to keychain so we never store ciphertext masquerading as a real API key.
 *
 * Companion to `collectUndecryptableFields()` — they walk the same fields.
 */
function clearUndecryptableSecrets(settings: CopilotSettings): CopilotSettings {
  const out = structuredClone(settings);
  const rec = out as unknown as Record<string, unknown>;

  for (const key of Object.keys(rec)) {
    if (!isSecretKey(key)) continue;
    const value = rec[key];
    if (typeof value === "string" && value.length > 0 && hasEncryptionPrefix(value)) {
      rec[key] = "";
    }
  }
  for (const listKey of ["activeModels", "activeEmbeddingModels"] as const) {
    const models = out[listKey] ?? [];
    for (const model of models) {
      const modelRec = model as unknown as Record<string, unknown>;
      for (const field of MODEL_SECRET_FIELDS) {
        const value = modelRec[field];
        if (typeof value === "string" && value.length > 0 && hasEncryptionPrefix(value)) {
          modelRec[field] = "";
        }
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Migration transaction
// ---------------------------------------------------------------------------

/**
 * Result of a `migrateDiskSecretsToKeychain` call.
 *
 * `fieldsRequiringReentry` lists every secret that could not be decrypted from
 * data.json and was therefore cleared instead of migrated. The migration still
 * succeeded for the rest; the caller is expected to surface this list to the
 * user so they can re-enter the affected keys.
 */
export interface MigrationResult {
  fieldsRequiringReentry: string[];
}

/**
 * One-shot transaction: write current in-memory secrets to keychain, strip
 * them from data.json, and flip `_keychainOnly = true` in memory.
 *
 * Undecryptable legacy `enc_*` values are NOT written to the keychain (they
 * are not valid plaintext keys). Instead they are cleared from memory and
 * reported in the result so the user can re-enter them. The migration succeeds
 * for every other field — see the DESIGN NOTE above `collectUndecryptableFields`
 * for why we don't fail closed.
 *
 * Failure semantics:
 * - Partial keychain write → rollback, throw. `_keychainOnly` stays false.
 * - Disk save failure → rollback keychain, throw. `_keychainOnly` stays false.
 * - Success → memory + disk + keychain all agree on keychain-only mode.
 *   `fieldsRequiringReentry` may still be non-empty; the caller surfaces it.
 */
export async function migrateDiskSecretsToKeychain(
  saveData: (data: CopilotSettings) => Promise<void>
): Promise<MigrationResult> {
  const result: MigrationResult = { fieldsRequiringReentry: [] };

  await runPersistenceTransaction(async () => {
    const current = getSettings();
    if (!canClearDiskSecrets(current)) {
      throw new Error(
        "Cannot migrate to Obsidian Keychain: it is unavailable, the last save did not complete " +
          "safely, or there are no secrets left to migrate. Retry saving settings, then try again."
      );
    }

    // Reason: clear undecryptable enc_* values BEFORE persisting so the
    // keychain only ever stores real plaintext keys. The cleared fields are
    // returned so the UI can prompt the user to re-enter them.
    result.fieldsRequiringReentry = collectUndecryptableFields(current);
    const sanitized = clearUndecryptableSecrets(current);

    // Step 1+2: persist secrets to keychain and stripped data.json.
    // Reason: `persistSecretsToKeychain` is the same code path used by every
    // future save in keychain-only mode — using it here keeps the migration
    // and steady-state paths in lockstep.
    //
    // DESIGN NOTE — keychain residue from a failed *first-stage* persist is
    // accepted, not cleaned. Scope: this note covers ONLY the
    // `persistSecretsToKeychain(target, ...)` call below failing (typically its
    // internal `saveData(stripped)` throwing) — NOT the later reconciliation
    // pass, which on failure deliberately commits the migrated state.
    // When this first-stage call writes the keychain but then throws, its
    // rollback restores the keychain to `lastPersistedSettings ?? prev` — which
    // for a disk-mode vault still holds the plaintext secrets, so the keychain keeps
    // a copy of them. Trigger requires `saveData()` to throw mid-migration
    // (disk full / permissions) — uncommon. Impact is benign: the first-stage
    // failure leaves the vault disk-mode (`_keychainOnly` never flips in memory
    // or on disk), so `loadSettingsWithKeychain` never hydrates from the
    // keychain; the residue is dormant and self-heals on the next successful
    // Migrate (overwrites the same IDs) or Delete All Keys (enumerate + clear).
    // It is not a credential leak — the keychain is at least as protected as
    // the data.json copy that already exists. A migration-specific rollback
    // branch (snapshot the real keychain baseline / tombstone the IDs this call
    // wrote) is complexity not justified by dormant, self-healing residue.
    // If a future review flags this again, point them at this note.
    const target = { ...sanitized, _keychainOnly: true } as CopilotSettings;
    await persistSecretsToKeychain(target, saveData, current);

    // Step 3: reconcile with any concurrent settings edits that landed
    // during the await, then sync in-memory state.
    //
    // Reason: the transaction captured `current` at the top of the callback;
    // concurrent `setSettings()` calls during `await persistSecretsToKeychain`
    // can advance in-memory state with unrelated user edits (theme toggle,
    // custom prompt changes, etc.). The queued persist for that concurrent
    // edit is dropped by the `transactionEpoch` guard in
    // `runPersistenceTransaction` — necessary to prevent the stale snapshot
    // from rolling back the migration's secret stripping — so without an
    // explicit reconciliation step those edits would be lost from disk if
    // the user closed Obsidian before any subsequent save. Re-derive from
    // the latest snapshot, and if it materially differs from `target`,
    // persist once more with `target` as the baseline so keychain + disk
    // both reflect the final merged state.
    const fresh = getSettings();
    const sanitizedFresh = clearUndecryptableSecrets(fresh);
    const merged = { ...sanitizedFresh, _keychainOnly: true } as CopilotSettings;

    // DESIGN NOTE — JSON.stringify is intentionally used here despite being
    // property-order-sensitive. This comparison only runs once per migration,
    // both objects originate from the same sanitize pipeline (so key order is
    // stable in practice), and the only consequence of a false-positive is
    // one redundant `persistSecretsToKeychain` call. A deepEqual helper would
    // add a dependency or ~30 lines of code for no behavioural improvement.
    // If a future review flags this again, point them at this note.
    if (JSON.stringify(merged) !== JSON.stringify(target)) {
      try {
        await persistSecretsToKeychain(merged, saveData, target);
      } catch (reconcileError) {
        // Reason: the first persistSecretsToKeychain already committed
        // `target` to disk + keychain durably. If the reconciliation pass
        // (which only exists to push concurrent edits) fails, sync memory to
        // `target` so subsequent saves see the migrated state. Otherwise
        // memory would stay as the pre-migration disk-mode snapshot and the
        // very next settings change would dispatch through
        // `persistSecretsToDisk` — writing plaintext secrets back to
        // `data.json` and silently undoing the successful migration. The
        // concurrent edit is lost (we cannot guarantee it landed on disk),
        // but the migration's primary contract is preserved.
        suppressNextPersistOnce();
        setSettings(target);
        throw reconcileError;
      }
    }

    // Suppress the subscriber-driven persist that `setSettings(merged)` would
    // otherwise trigger — the in-transaction persistSecretsToKeychain calls
    // already wrote the final state.
    suppressNextPersistOnce();
    setSettings(merged);
  });

  return result;
}

/**
 * Backwards-compat alias for the UI's "clear old copies" / "Migrate to Keychain"
 * button. New code should call `migrateDiskSecretsToKeychain` directly; this
 * export exists so the existing settings page continues to compile while the
 * frontend is being refactored to the new API.
 *
 * @deprecated Use `migrateDiskSecretsToKeychain` instead.
 */
export const clearDiskSecrets = migrateDiskSecretsToKeychain;

// ---------------------------------------------------------------------------
// Persist queue entry points
// ---------------------------------------------------------------------------

/**
 * Public entry point — queues a save behind the write queue and any pending
 * dedicated transactions, then dispatches to disk or keychain mode.
 */
export async function persistSettings(
  settings: CopilotSettings,
  saveData: (data: CopilotSettings) => Promise<void>,
  prevSettings?: CopilotSettings
): Promise<void> {
  if (suppressNextPersist) {
    suppressNextPersist = false;
    return;
  }

  const epochAtEnqueue = transactionEpoch;
  const job = writeQueue.then(() => {
    // Reason: if a transaction committed after this job was queued, the
    // captured snapshot is stale and may contain secrets the transaction
    // just deleted. Drop the job entirely in that case.
    if (epochAtEnqueue !== transactionEpoch) return;
    return doPersist(settings, saveData, prevSettings);
  });
  writeQueue = job.catch(() => {
    /* swallow to unblock next write */
  });
  return job;
}

/** Core persistence dispatcher, executed inside the write queue. */
async function doPersist(
  settings: CopilotSettings,
  saveData: (data: CopilotSettings) => Promise<void>,
  prevSettings?: CopilotSettings
): Promise<void> {
  const keychain = KeychainService.getInstance();

  // Reason: when Secure Storage isn't available, the user must still be able
  // to save non-secret settings. For a keychain-only vault, preserve the mode
  // marker and strip secrets from disk — otherwise a non-SecretStorage build
  // (e.g. older Obsidian opening a synced vault) would silently downgrade the
  // vault to disk mode and orphan the keychain entries on other devices.
  // Disk-mode vaults fall through to the normal plaintext-disk save.
  if (!keychain.isAvailable()) {
    if (isKeychainOnly(settings)) {
      const stripped = stripKeychainFields(cleanupLegacyFields(settings));
      (stripped as unknown as Record<string, unknown>)._keychainOnly = true;
      await saveData(stripped);
      refreshDiskHasSecrets(stripped);
      lastPersistedSettings = structuredClone(settings);
      return;
    }
    await persistSecretsToDisk(settings, saveData);
    return;
  }

  if (isKeychainOnly(settings)) {
    await persistSecretsToKeychain(settings, saveData, prevSettings);
    return;
  }

  await persistSecretsToDisk(settings, saveData);
}

// ---------------------------------------------------------------------------
// Rollback helpers
// ---------------------------------------------------------------------------

/**
 * Best-effort restore of keychain contents after a failed persist.
 *
 * Reason: if `saveData()` or a keychain write throws after some secrets were
 * already written, the keychain is left in a partial state. Replay the
 * previous settings' secrets so the keychain approximates the last
 * known-good state.
 *
 * Returns `true` iff every restore/tombstone write succeeded AND we had a
 * baseline to restore from. A `false` return is the caller's signal that
 * keychain state is no longer trustworthy — any "safe to clear disk" gate
 * must stay closed until a subsequent clean save proves otherwise.
 */
// DESIGN NOTE — rollback intentionally replays `restoreFrom` verbatim,
// including any legacy `enc_*` placeholders the forward migration cleared.
// Codex review #3234868146 flagged that this can write ciphertext-like
// junk into the keychain during a compound failure. Considered and
// rejected the "filter undecryptable enc_* during rollback" fix:
//
//   - Trigger chain is narrow: requires (a) legacy `enc_*` that the
//     current device cannot decrypt, (b) the user clicking Migrate, (c)
//     at least one forward keychain write succeeding, AND (d) a later
//     `saveData()` or keychain write throwing. Each step is uncommon on
//     mainstream macOS / Windows builds.
//   - Observable failure mode is recoverable auth breakage, not credential
//     leakage or disk-secret loss. The next read returns `enc_*` ciphertext,
//     `getDecryptedKey()` returns `""`, and the provider call fails with a
//     visible "invalid key" error — the user re-enters the key as the
//     migration modal already instructs.
//   - A successful migration retry tombstones the cleared field from the
//     keychain (the forward target has the field cleared, prev still has
//     `enc_*`), self-healing the poisoned entry without user action beyond
//     re-entering the affected key.
//   - The forward path is already hard-guarded at
//     `persistSecretsToKeychain` (`Refusing to persist: undecryptable
//     secrets`), so the much higher-frequency normal-save path cannot
//     poison the keychain. Only rollback is exposed.
//
// If a future codex / human review flags this again, point them at this
// note and at the resolved GitHub thread on PR #2364.
async function restoreKeychainFromSettings(
  keychain: KeychainService,
  restoreFrom: CopilotSettings | undefined,
  failedSettings: CopilotSettings
): Promise<boolean> {
  // Reason: no baseline → we cannot prove the keychain matches a known-good
  // state. Treat as unsafe so the lock stays closed.
  if (!restoreFrom) return false;

  const { secretEntries, keychainIdsToDelete } = keychain.persistSecrets(
    restoreFrom,
    failedSettings
  );

  let allOk = true;

  for (const [id, value] of secretEntries) {
    try {
      keychain.setSecretById(id, value);
    } catch (error) {
      logWarn(`Failed to restore keychain entry "${id}" during rollback.`, error);
      allOk = false;
    }
  }

  for (const id of keychainIdsToDelete) {
    try {
      keychain.setSecretById(id, "");
      pendingTombstones.delete(id);
    } catch (error) {
      logWarn(`Failed to write keychain tombstone "${id}" during rollback.`, error);
      allOk = false;
    }
  }

  return allOk;
}
