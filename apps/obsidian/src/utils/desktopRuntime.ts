import { Platform } from "obsidian";

export function isDesktopRuntime(): boolean {
  // eslint-disable-next-line no-restricted-properties -- this helper owns the canonical check
  return Platform.isDesktopApp && !Platform.isMobile;
}

export function requireNodeModule<T>(id: string): T {
  if (!isDesktopRuntime()) {
    throw new Error(`Node built-in module "${id}" is unavailable outside the desktop runtime.`);
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- runtime require is the point: deferring resolution to call time keeps Node built-ins off the mobile load path
  return require(id) as T;
}
