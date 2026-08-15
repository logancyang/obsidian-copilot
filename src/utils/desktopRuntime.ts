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

/**
 * Lazily load a Node built-in module at call time, guarded by
 * {@link isDesktopRuntime}.
 *
 * A static `import` of a Node built-in compiles to a module-evaluation-time
 * `require`, which also runs on mobile — where the built-ins resolve to
 * `undefined` — so any module-scope use crashes the whole plugin at load.
 * Routing built-in access through this accessor keeps the module graph
 * mobile-safe by construction: nothing touches Node until a desktop-gated
 * code path actually runs, and a non-desktop caller gets a clear error
 * instead of an `undefined`-module TypeError. Type the result with an erased
 * `typeof import("node:...")` query so typing stays exact at zero runtime
 * cost.
 *
 * @param id - Built-in module id without the `node:` prefix (e.g. `"path"`,
 *   `"child_process"`) — the form the desktop runtime's `require` resolves
 *   and the same module instance the `node:`-prefixed id names.
 */
export function requireNodeModule<T>(id: string): T {
  if (!isDesktopRuntime()) {
    throw new Error(`Node built-in module "${id}" is unavailable outside the desktop runtime.`);
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- runtime require is the point: deferring resolution to call time keeps Node built-ins off the mobile load path
  return require(id) as T;
}
