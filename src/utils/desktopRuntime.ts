import { Platform } from "obsidian";

/**
 * True only in a real desktop (Electron) app — an environment with Node and
 * subprocess support. Use this to gate any desktop-only feature (Agent Mode,
 * Node built-ins, the web viewer, etc.).
 *
 * `Platform.isDesktopApp` alone is NOT sufficient: `app.emulateMobile(true)`
 * keeps `isDesktopApp === true` (you're still in the Electron binary) but stubs
 * Node's built-in modules to `null` to mimic mobile, so desktop-only code that
 * runs there crashes. The flag that flips under emulation *and* on real mobile
 * is `Platform.isMobile`, so the correct check is "desktop app AND not
 * (emulated-)mobile".
 */
export function isDesktopRuntime(): boolean {
  // eslint-disable-next-line no-restricted-properties -- this helper owns the canonical check
  return Platform.isDesktopApp && !Platform.isMobile;
}
