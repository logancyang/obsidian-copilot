import { WELL_KNOWN_BIN_DIRS } from "@/utils/binaryPath";
import { requireNodeModule } from "@/utils/desktopRuntime";

export const ANTIGRAVITY_BINARY_NAME = "agy";

export interface AntigravityBinaryResolverInput {
  override?: string;
  homeDir: string;
  platform: NodeJS.Platform;
  fs: { existsSync(path: string): boolean };
}

export function resolveAntigravityBinary(input: AntigravityBinaryResolverInput): string | null {
  const candidates = [input.override, ...antigravityCandidates(input)];
  return candidates.find((candidate) => candidate && input.fs.existsSync(candidate)) ?? null;
}

export function antigravitySearchDirs(input: AntigravityBinaryResolverInput): string[] {
  const path = requireNodeModule<typeof import("node:path")>("path");
  const pathImpl = input.platform === "win32" ? path.win32 : path.posix;
  return antigravityCandidates(input).map((candidate) => pathImpl.dirname(candidate));
}

function antigravityCandidates(input: AntigravityBinaryResolverInput): string[] {
  const path = requireNodeModule<typeof import("node:path")>("path");
  if (input.platform === "win32") {
    return [path.win32.join(input.homeDir, ".local", "bin", `${ANTIGRAVITY_BINARY_NAME}.exe`)];
  }
  const dirs = [path.posix.join(input.homeDir, ".local", "bin"), ...WELL_KNOWN_BIN_DIRS];
  return dirs.map((dir) => path.posix.join(dir, ANTIGRAVITY_BINARY_NAME));
}
