import { WELL_KNOWN_BIN_DIRS } from "@/utils/binaryPath";
import { requireNodeModule } from "@/utils/desktopRuntime";
import { nodeToolBinDirCandidates, type NodeToolFs } from "@/utils/nodeToolBinDirs";

export type CursorBinaryResolverFs = NodeToolFs;

export interface CursorBinaryResolverInput {
  override?: string;
  homeDir: string;
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  fs: CursorBinaryResolverFs;
}

export function resolveCursorBinary(input: CursorBinaryResolverInput): string | null {
  const { override, fs } = input;
  if (override && fs.existsSync(override)) return override;

  for (const candidate of cursorBinaryCandidates(input)) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export function cursorBinarySearchDirs(input: CursorBinaryResolverInput): string[] {
  const path = requireNodeModule<typeof import("node:path")>("path");
  const pathImpl = input.platform === "win32" ? path.win32 : path.posix;
  return Array.from(
    new Set(cursorBinaryCandidates(input).map((candidate) => pathImpl.dirname(candidate)))
  );
}

function cursorBinaryCandidates(input: CursorBinaryResolverInput): string[] {
  const path = requireNodeModule<typeof import("node:path")>("path");
  const pathImpl = input.platform === "win32" ? path.win32 : path.posix;
  const agentName = input.platform === "win32" ? "agent.exe" : "agent";
  const legacyName = input.platform === "win32" ? "cursor-agent.exe" : "cursor-agent";
  const officialDirs = [
    pathImpl.join(input.homeDir, ".local", "bin"),
    pathImpl.join(input.homeDir, ".cursor", "bin"),
  ];
  const legacyDirs =
    input.platform === "win32"
      ? [...officialDirs, ...nodeToolBinDirCandidates(input)]
      : [...officialDirs, ...nodeToolBinDirCandidates(input), ...WELL_KNOWN_BIN_DIRS];

  return [
    ...officialDirs.map((dir) => pathImpl.join(dir, agentName)),
    ...legacyDirs.map((dir) => pathImpl.join(dir, legacyName)),
  ];
}
