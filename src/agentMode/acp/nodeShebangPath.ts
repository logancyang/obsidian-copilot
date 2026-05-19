import * as path from "node:path";

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
  const sep = process.platform === "win32" ? ";" : ":";
  const candidates = [
    path.dirname(binaryPath),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
  ];
  const inheritedParts = (inherited ?? "").split(sep).filter(Boolean);
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const p of [...candidates, ...inheritedParts]) {
    if (!seen.has(p)) {
      seen.add(p);
      merged.push(p);
    }
  }
  return merged.join(sep);
}
