/**
 * Desktop-only filesystem probe for the device-profiles migration.
 *
 * Kept in its own module with a top-level `node:fs` import so it is only ever
 * evaluated via the migration's `await import()` under a `Platform.isDesktopApp`
 * guard. `node:fs` is an esbuild external (a runtime `require`), so importing it
 * at module scope would throw on mobile, where it does not exist.
 */

import * as fs from "node:fs";

/** True iff `p` exists on disk. Returns false on any error (treated as missing). */
export function pathExists(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}
