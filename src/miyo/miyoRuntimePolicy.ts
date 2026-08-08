import { CopilotSettings } from "@/settings/model";
import { Platform } from "obsidian";

/**
 * Low-level Miyo runtime-policy predicates. These are pure functions of the
 * settings (plus the platform) with no dependency on the Miyo status store, so
 * both {@link miyoStatusStore} and {@link miyoUtils} can import them without
 * forming an import cycle. `miyoUtils` re-exports them, so existing callers keep
 * importing from `@/miyo/miyoUtils` unchanged.
 */

/**
 * Return the user-configured Miyo server URL, or "" to fall back to local service discovery.
 * Uses `|| ""` to guard against undefined when loaded from older saved settings.
 *
 * @param settings - Current Copilot settings.
 * @returns Trimmed URL string like "http://192.168.1.10:8742", or "" when not configured.
 */
export function getMiyoCustomUrl(settings: CopilotSettings): string {
  return (settings.miyoServerUrl || "").trim();
}

/**
 * Single source of truth for whether Miyo should be used.
 *
 * Returns false when:
 * - `enableMiyo` is off, or
 * - running on mobile without a remote server URL (local service discovery
 *   is unavailable on mobile, so Miyo can only work via an explicit URL).
 *
 * Miyo is free: there is no self-host license / validation gate here anymore
 * (Layer C — "open Miyo"). On desktop, enabling Miyo is all it takes.
 *
 * Note: `enableSemanticSearchV3` need not be checked — the UI enforces that
 * enabling Miyo also enables semantic search, and disabling semantic search
 * also disables Miyo.
 *
 * @param settings - Current Copilot settings.
 */
export function shouldUseMiyo(settings: CopilotSettings): boolean {
  if (!settings.enableMiyo) {
    return false;
  }
  return !Platform.isMobile || !!getMiyoCustomUrl(settings);
}
