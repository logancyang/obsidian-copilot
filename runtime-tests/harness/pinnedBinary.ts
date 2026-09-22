import * as path from "node:path";

import { opencodeManagedDataDir } from "@/agentMode/backends/opencode/OpencodeBinaryManager";
import { OPENCODE_PINNED_VERSION } from "@/agentMode/backends/opencode/ui/opencodeVersion";

/**
 * The home directory the suite's opencode install lives under, in place of the
 * user's. Resolved from `__dirname`, which after bundling is `runtime-tests/.build`.
 */
export const BINARY_CACHE_HOME = path.resolve(__dirname, "..", ".opencode");

/**
 * Where the plugin's own installer puts the pinned release when the home
 * directory is {@link BINARY_CACHE_HOME}. The version is part of the path, so
 * bumping the pin can never reuse a binary of another version.
 */
export function pinnedBinaryPath(): string {
  const name = process.platform === "win32" ? "opencode.exe" : "opencode";
  return path.join(opencodeManagedDataDir(BINARY_CACHE_HOME), OPENCODE_PINNED_VERSION, "bin", name);
}
