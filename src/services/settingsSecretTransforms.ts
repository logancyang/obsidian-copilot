/**
 * Pure transform functions for managing sensitive fields in settings.
 *
 * These functions share a single "keychain-covered field set" definition:
 * - Top-level: any key matching `isSensitiveKey()`
 * - Model-level: `apiKey` on each CustomModel
 *
 * Reason: centralising the field-set avoids drift between the callsites
 * (hasPersistedSecrets, stripKeychainFields, cleanupLegacyFields).
 */

import { DEFAULT_SETTINGS } from "@/constants";
import { type CopilotSettings } from "@/settings/model";
import { type CustomModel } from "@/aiParams";
import { isSensitiveKey } from "@/encryptionService";
// Reason: do NOT import from @/logger here. The logger depends on getSettings(),
// but this module runs during settings loading (before setSettings).

/** Model-level fields that are managed by the keychain. */
export const MODEL_SECRET_FIELDS = ["apiKey"] as const;

/**
 * Canonical list of top-level secret field names known at compile time.
 *
 * Reason: the keychain hydrate path must NOT rely solely on `Object.keys(settings)`
 * because cross-version sync, manual edits, or downgrade-then-upgrade cycles can
 * leave a `data.json` that is missing fields whose keychain entries still exist on
 * this device. Iterating this constant (in addition to the in-memory keys) ensures
 * every default secret field is queried even when the in-memory settings object
 * does not list it.
 *
 * Derived from `DEFAULT_SETTINGS` rather than hand-maintained so new secret fields
 * added to the default settings automatically flow through here.
 */
export const TOP_LEVEL_SECRET_FIELDS: readonly string[] = Object.freeze(
  Object.keys(DEFAULT_SETTINGS as unknown as Record<string, unknown>).filter(isSensitiveKey)
);

/** Helper to cast CopilotSettings to a Record for dynamic key access. */
function asRecord(obj: CopilotSettings): Record<string, unknown> {
  return obj as unknown as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// hasPersistedSecrets
// ---------------------------------------------------------------------------

/**
 * Check whether `data.json` (the raw on-disk data) still contains any
 * non-empty sensitive field values.
 *
 * Used as a condition for showing the migration modal: if the disk already
 * has no secrets, there is nothing to clear.
 *
 * @param rawData - The raw data as loaded from disk (before hydration).
 */
export function hasPersistedSecrets(rawData: Record<string, unknown>): boolean {
  // Check top-level sensitive fields
  for (const key of Object.keys(rawData)) {
    if (!isSensitiveKey(key)) continue;
    const value = rawData[key];
    if (typeof value === "string" && value.length > 0) return true;
  }

  // Check model-level secrets
  for (const listKey of ["activeModels", "activeEmbeddingModels"] as const) {
    const models = rawData[listKey];
    if (!Array.isArray(models)) continue;
    for (const model of models) {
      if (!model || typeof model !== "object") continue;
      const rec = model as Record<string, unknown>;
      for (const field of MODEL_SECRET_FIELDS) {
        const value = rec[field];
        if (typeof value === "string" && value.length > 0) return true;
      }
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// stripKeychainFields
// ---------------------------------------------------------------------------

/**
 * Return a deep copy of `settings` with all keychain-covered fields set to `""`.
 *
 * Used when `_diskSecretsCleared === true` — the user has confirmed all
 * devices are upgraded, so data.json should no longer carry secrets.
 *
 * DESIGN NOTE: this iterates `Object.keys(settings)` rather than
 * `TOP_LEVEL_SECRET_FIELDS`. That is intentional and not an asymmetry bug.
 * `hydrateFromKeychain()` writes any non-empty keychain value back onto the
 * in-memory settings object, so every secret that exists in memory also has
 * its key present on the object — `Object.keys` is guaranteed to hit it.
 * When the keychain has no entry, memory holds no secret either, so there is
 * nothing to strip. There is no "secret in memory, sparse on disk" state.
 * If a future review flags this again, point them at this note.
 *
 * @param settings - In-memory settings to strip.
 */
export function stripKeychainFields(settings: CopilotSettings): CopilotSettings {
  const out = asRecord({ ...settings });

  // Strip top-level sensitive fields
  for (const key of Object.keys(out)) {
    if (!isSensitiveKey(key)) continue;
    out[key] = "";
  }

  // Strip model-level secrets
  out.activeModels = stripModelSecrets(settings.activeModels ?? []);
  out.activeEmbeddingModels = stripModelSecrets(settings.activeEmbeddingModels ?? []);

  return out as unknown as CopilotSettings;
}

/** Set secret fields to `""` on each model, returning new array. */
function stripModelSecrets(models: CustomModel[]): CustomModel[] {
  if (!models?.length) return models;

  return models.map((model) => {
    const copy = { ...model } as unknown as Record<string, unknown>;
    for (const field of MODEL_SECRET_FIELDS) {
      copy[field] = "";
    }
    return copy as unknown as CustomModel;
  });
}

// ---------------------------------------------------------------------------
// cleanupLegacyFields
// ---------------------------------------------------------------------------

/**
 * Remove legacy keychain/encryption fields from a settings object and migrate
 * older field names forward.
 *
 * Called on:
 * - Load path (after sanitize, before keychain hydrate)
 * - Save path (before writing data.json)
 * - Configuration file import path (after apply)
 *
 * Returns a new object — does NOT mutate the input.
 */
export function cleanupLegacyFields(settings: CopilotSettings): CopilotSettings {
  const out = asRecord({ ...settings });
  // Reason: these fields are from earlier dev iterations and should not persist.
  delete out.enableEncryption;
  delete out._keychainMigrated;
  // Reason: the simplified opt-in flow no longer uses these transition markers;
  // strip them on every cleanup so they never make it back to data.json.
  delete out._keychainMigratedAt;
  delete out._migrationModalDismissed;
  // Reason: `_diskSecretsCleared` was renamed to `_keychainOnly` for clarity.
  // Migrate the value forward only when the new field is absent so a later
  // explicit set always wins.
  if (out._diskSecretsCleared !== undefined && out._keychainOnly === undefined) {
    out._keychainOnly = out._diskSecretsCleared;
  }
  delete out._diskSecretsCleared;
  return out as unknown as CopilotSettings;
}

// ---------------------------------------------------------------------------
// isKeychainOnly
// ---------------------------------------------------------------------------

/**
 * Whether the OS keychain is the single source of truth for secrets in this
 * vault. Centralised check so business code does not sprinkle
 * `_keychainOnly === true` comparisons throughout the codebase.
 */
export function isKeychainOnly(settings: CopilotSettings): boolean {
  return (settings as unknown as Record<string, unknown>)._keychainOnly === true;
}
