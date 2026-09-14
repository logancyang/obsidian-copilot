import { CopilotSettings } from "@/settings/model";
import { Platform } from "obsidian";

/**
 * Low-level Miyo runtime-policy predicates. These are pure functions of the
 * settings (plus the platform) with no dependency on the Miyo status store, so
 * both {@link miyoStatusStore} and {@link miyoUtils} can import them without
 * forming an import cycle. `miyoUtils` re-exports them, so existing callers keep
 * importing from `@/miyo/miyoUtils` unchanged.
 */

export function getMiyoConnectionMode(settings: CopilotSettings): "local" | "remote" {
  // A legacy explicit URL must keep targeting that server, including loopback.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/466
  return (
    settings.miyoConnectionMode ?? ((settings.miyoServerUrl || "").trim() ? "remote" : "local")
  );
}

/** Returns the active server override, leaving a saved remote URL unused in local mode.
 * @param settings Current connection settings.
 */
export function getMiyoCustomUrl(settings: CopilotSettings): string {
  return getMiyoConnectionMode(settings) === "local" ? "" : (settings.miyoServerUrl || "").trim();
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
 * @param settings - Current Copilot settings.
 */
export function shouldUseMiyo(settings: CopilotSettings): boolean {
  if (
    !settings.enableMiyo ||
    (getMiyoConnectionMode(settings) === "remote" && !getMiyoCustomUrl(settings))
  ) {
    return false;
  }
  return !Platform.isMobile || !!getMiyoCustomUrl(settings);
}
