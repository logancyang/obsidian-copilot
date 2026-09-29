import { requireNodeModule } from "@/utils/desktopRuntime";
import { collapseHomeDir } from "@/utils/pathUtils";
import { resolveNodeToolBinDirs } from "@/utils/nodeToolBinDirs";

export const WELL_KNOWN_BIN_DIRS = [
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/usr/bin",
  "/bin",
] as const;

const PATH_SEPARATOR = process.platform === "win32" ? ";" : ":";

export function mergePath(candidates: readonly string[], inherited: string | undefined): string {
  const inheritedParts = (inherited ?? "").split(PATH_SEPARATOR).filter(Boolean);
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const p of [...candidates, ...inheritedParts]) {
    if (!seen.has(p)) {
      seen.add(p);
      merged.push(p);
    }
  }
  return merged.join(PATH_SEPARATOR);
}

function nodeToolBinDirs(): string[] {
  const os = requireNodeModule<typeof import("node:os")>("os");
  const fs = requireNodeModule<typeof import("node:fs")>("fs");
  return resolveNodeToolBinDirs({
    homeDir: os.homedir(),
    platform: process.platform,
    env: process.env,
    fs: {
      existsSync: (p) => fs.existsSync(p),
      readFileSync: (p, encoding) => fs.readFileSync(p, encoding),
      readdirSync: (p) => fs.readdirSync(p),
    },
  });
}

export function detectionSearchDirs(): string[] {
  const wellKnown = process.platform === "win32" ? [] : WELL_KNOWN_BIN_DIRS;
  return [...nodeToolBinDirs(), ...wellKnown];
}

export function augmentPathForDetection(inherited: string | undefined): string {
  return mergePath(detectionSearchDirs(), inherited);
}

export function formatBinaryPathForDisplay(absolutePath: string): string {
  const os = requireNodeModule<typeof import("node:os")>("os");
  return collapseHomeDir(absolutePath, os.homedir(), process.platform === "win32");
}
