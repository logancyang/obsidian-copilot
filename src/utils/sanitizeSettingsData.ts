/**
 * Sanitizes a raw settings object (the on-disk `data.json`) so it can be
 * shared in a public bug report. Sensitive values are masked with a
 * placeholder rather than removed, so maintainers can still see which
 * providers/keys are configured without seeing the values.
 *
 * Leaf module by design: it receives the raw data as a plain object and has
 * no settings/singleton dependencies, so it is directly unit-testable.
 */

import { hasEncryptionPrefix, isSensitiveKey } from "@/encryptionService";

/** Placeholder that replaces every sensitive value in the shared copy. */
export const REDACTED_VALUE = "[REDACTED]";

/**
 * Infrastructure identifiers that could leak deployment details (Azure
 * instance/deployment names, org IDs). Mirrors the redaction set used by
 * `LogFileManager` for the copilot log file.
 */
const INFRA_KEY_PATTERNS = [/orgId$/i, /instanceName$/i, /deploymentName$/i, /apiVersion$/i];

/**
 * Env-var override maps (agent backend settings) can carry arbitrary
 * credentials whose names don't match any key pattern (e.g.
 * AWS_ACCESS_KEY_ID), so every value inside them is masked wholesale.
 */
const ENV_OVERRIDES_KEY = "envOverrides";

/**
 * Check whether a key should have its value masked in the shared copy.
 */
function isRedactedKey(key: string): boolean {
  if (isSensitiveKey(key)) return true;
  if (key === "userId") return true;
  if (key.startsWith("enc_")) return true;
  return INFRA_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

/**
 * Mask a single value: empty strings, null, and undefined pass through so
 * "not configured" remains visible; everything else becomes the placeholder.
 */
function maskValue(value: unknown): unknown {
  if (value === null || value === undefined || value === "") return value;
  return REDACTED_VALUE;
}

/**
 * Recursively clone a raw settings object, masking the values of sensitive
 * keys (API keys, license keys, tokens, secrets, passwords), infrastructure
 * identifiers, `userId`, every entry of any `envOverrides` map, and any
 * string still carrying a legacy `enc_*` encryption prefix.
 *
 * @param raw - The raw data as loaded from disk (e.g. `plugin.loadData()`).
 * @returns A sanitized deep copy safe to include in a public bug report.
 */
export function sanitizeSettingsDataForReport(raw: unknown): unknown {
  if (raw === null || raw === undefined) return raw;

  if (typeof raw === "string") {
    // Legacy encrypted secrets are still secrets (the key may live on this
    // device); mask them wherever they appear, regardless of key name.
    return hasEncryptionPrefix(raw) ? REDACTED_VALUE : raw;
  }

  if (Array.isArray(raw)) {
    return raw.map((item) => sanitizeSettingsDataForReport(item));
  }

  if (typeof raw === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (
        key === ENV_OVERRIDES_KEY &&
        value &&
        typeof value === "object" &&
        !Array.isArray(value)
      ) {
        const masked: Record<string, unknown> = {};
        for (const [envKey, envValue] of Object.entries(value as Record<string, unknown>)) {
          masked[envKey] = maskValue(envValue);
        }
        result[key] = masked;
      } else if (isRedactedKey(key)) {
        result[key] = maskValue(value);
      } else {
        result[key] = sanitizeSettingsDataForReport(value);
      }
    }
    return result;
  }

  return raw;
}
