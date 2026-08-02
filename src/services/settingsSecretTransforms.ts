/**
 * Pure transform functions for managing sensitive fields in settings.
 *
 * These functions share a single "keychain-covered field set" definition:
 * - Top-level: any key matching `isSensitiveKey()`
 * - Model-level: `apiKey` on each CustomModel
 * - Agent Mode: secret-shaped nested fields, legacy BYOK values, and MCP
 *   environment/header values
 *
 * Reason: centralising the field-set avoids drift between the callsites
 * (hasPersistedSecrets, stripKeychainFields, cleanupLegacyFields).
 */

import { DEFAULT_SETTINGS } from "@/constants";
import { type CopilotSettings } from "@/settings/model";
import { type CustomModel } from "@/aiParams";
// Reason: do NOT import from @/logger here. The logger depends on getSettings(),
// but this module runs during settings loading (before setSettings).

/** Model-level fields that are managed by the keychain. */
export const MODEL_SECRET_FIELDS = ["apiKey"] as const;

/** Check whether a settings key holds a sensitive value. */
export function isSensitiveKey(key: string): boolean {
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
}

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

function isAgentModeSecretPath(path: readonly string[]): boolean {
  const leaf = path[path.length - 1];
  if (leaf && isSensitiveKey(leaf)) return true;
  if (path[0] === "byok" && path.length === 2) return true;
  if (path[path.length - 2] === "envOverrides") return true;
  return (
    path[0] === "mcpServers" &&
    leaf === "value" &&
    path.some((segment) => segment === "env" || segment === "headers")
  );
}

function arrayPathSegment(parentPath: readonly string[], item: unknown, index: number): string {
  if (parentPath.length === 1 && parentPath[0] === "mcpServers") {
    const id = item && typeof item === "object" ? (item as Record<string, unknown>).id : undefined;
    if (typeof id === "string" && id.length > 0) return `id:${id}`;
  }
  return String(index);
}

function mapAgentModeValue(
  value: unknown,
  path: readonly string[],
  mapper: (path: readonly string[], value: string) => string
): { value: unknown; changed: boolean } {
  if (typeof value === "string") {
    if (!isAgentModeSecretPath(path)) return { value, changed: false };
    const mapped = mapper(path, value);
    return { value: mapped, changed: mapped !== value };
  }

  if (Array.isArray(value)) {
    let next: unknown[] | undefined;
    value.forEach((item, index) => {
      const segment = arrayPathSegment(path, item, index);
      const mapped = mapAgentModeValue(item, [...path, segment], mapper);
      if (!mapped.changed) return;
      next ??= [...value];
      next[index] = mapped.value;
    });
    return next ? { value: next, changed: true } : { value, changed: false };
  }

  if (!value || typeof value !== "object") return { value, changed: false };
  let next: Record<string, unknown> | undefined;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const mapped = mapAgentModeValue(child, [...path, key], mapper);
    if (!mapped.changed) continue;
    next ??= { ...(value as Record<string, unknown>) };
    next[key] = mapped.value;
  }
  return next ? { value: next, changed: true } : { value, changed: false };
}

/**
 * Map every Keychain-backed Agent Mode value without mutating the input.
 * MCP server ids replace array positions in logical paths so reordering servers
 * does not detach their credentials.
 *
 * @param settings - Settings snapshot whose Agent Mode secrets should be mapped.
 * @param mapper - Replacement callback receiving each stable path and current value.
 */
export function mapAgentModeSecrets(
  settings: CopilotSettings,
  mapper: (path: readonly string[], value: string) => string
): CopilotSettings {
  if (!settings.agentMode) return settings;
  const mapped = mapAgentModeValue(settings.agentMode, [], mapper);
  if (!mapped.changed) return settings;
  return { ...settings, agentMode: mapped.value as CopilotSettings["agentMode"] };
}

// ---------------------------------------------------------------------------
// hasPersistedSecrets
// ---------------------------------------------------------------------------

/**
 * Check whether a settings snapshot contains any non-empty sensitive values
 * or provider-scoped Keychain references.
 *
 * @param rawData - Raw or hydrated settings snapshot to inspect.
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

  let hasAgentModeSecret = false;
  mapAgentModeSecrets(rawData as unknown as CopilotSettings, (_path, value) => {
    if (value.length > 0) hasAgentModeSecret = true;
    return value;
  });
  if (hasAgentModeSecret) return true;

  const providers = rawData.providers;
  if (providers && typeof providers === "object" && !Array.isArray(providers)) {
    for (const provider of Object.values(providers)) {
      if (!provider || typeof provider !== "object") continue;
      const keychainId = (provider as Record<string, unknown>).apiKeyKeychainId;
      if (typeof keychainId === "string" && keychainId.length > 0) return true;
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
  if ("activeModels" in out) {
    out.activeModels = stripModelSecrets(settings.activeModels ?? []);
  }
  if ("activeEmbeddingModels" in out) {
    out.activeEmbeddingModels = stripModelSecrets(settings.activeEmbeddingModels ?? []);
  }

  return mapAgentModeSecrets(out as unknown as CopilotSettings, () => "");
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
  delete out._diskSecretsCleared;
  delete out._keychainOnly;
  return out as unknown as CopilotSettings;
}
