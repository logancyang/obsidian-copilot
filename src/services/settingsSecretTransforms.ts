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

import { type CopilotSettings } from "@/settings/model";
import { type CustomModel } from "@/aiParams";
import { isSensitiveKey } from "@/encryptionService";
// Reason: do NOT import from @/logger here. The logger depends on getSettings(),
// but this module runs during settings loading (before setSettings).

/** Model-level fields that are managed by the keychain. */
export const MODEL_SECRET_FIELDS = ["apiKey"] as const;

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
 * Remove legacy keychain/encryption fields from a settings object.
 *
 * Called on:
 * - Load path (after sanitize, before backfill)
 * - Save path (before writing data.json)
 * - Setup URI import path (after apply)
 *
 * Returns a new object — does NOT mutate the input.
 */
export function cleanupLegacyFields(settings: CopilotSettings): CopilotSettings {
  const out = asRecord({ ...settings });
  delete out.enableEncryption;
  delete out._keychainMigrated;
  return out as unknown as CopilotSettings;
}
