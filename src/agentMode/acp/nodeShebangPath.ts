import * as path from "node:path";

import { WELL_KNOWN_BIN_DIRS, mergePath } from "@/utils/binaryPath";

/**
 * macOS GUI apps (Obsidian) inherit a minimal PATH that omits Homebrew and
 * common Node installer locations. Adapters that ship as `#!/usr/bin/env
 * node` launchers fail to spawn with `env: node: No such file or directory`
 * unless we put `node` on PATH ourselves.
 *
 * Prepend the directory containing the binary (npm globals install the
 * launcher script next to `node`) plus the well-known Homebrew / system
 * prefixes, then keep the inherited PATH for everything else.
 */
export function augmentPathForNodeShebang(
  binaryPath: string,
  inherited: string | undefined
): string {
  return mergePath([path.dirname(binaryPath), ...WELL_KNOWN_BIN_DIRS], inherited);
}
