import * as path from "node:path";

import { OPENCODE_PINNED_VERSION } from "@/agentMode/backends/opencode/ui/opencodeVersion";

/**
 * Where the suite caches the pinned opencode executable. The version is part of
 * the path so bumping the pin downloads afresh instead of reusing a stale
 * binary under the same name.
 *
 * Resolved from `__dirname`, which after bundling is `runtime-tests/.build`.
 */
export function pinnedBinaryPath(): string {
  const name = process.platform === "win32" ? "opencode.exe" : "opencode";
  return path.resolve(__dirname, "..", ".opencode", OPENCODE_PINNED_VERSION, name);
}
