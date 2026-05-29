import * as path from "node:path";

import { detectionSearchDirs, mergePath } from "@/utils/binaryPath";

/**
 * macOS GUI apps (Obsidian) inherit a minimal PATH that omits Homebrew and
 * common Node installer locations. Adapters that ship as `#!/usr/bin/env
 * node` launchers fail to spawn with `env: node: No such file or directory`
 * unless we put `node` on PATH ourselves.
 *
 * Prepend the directory containing the binary (npm globals install the
 * launcher script next to `node`) plus the same version-manager and
 * well-known dirs detection searches, then keep the inherited PATH for
 * everything else. Reusing {@link detectionSearchDirs} keeps spawn-time and
 * detect-time PATH in lockstep: a binary detected under nvm/fnm/asdf spawns
 * with that same version manager's `node` resolvable.
 */
export function augmentPathForNodeShebang(
  binaryPath: string,
  inherited: string | undefined
): string {
  return mergePath([path.dirname(binaryPath), ...detectionSearchDirs()], inherited);
}
