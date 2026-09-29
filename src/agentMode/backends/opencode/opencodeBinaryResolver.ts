import { WELL_KNOWN_BIN_DIRS } from "@/utils/binaryPath";
import { requireNodeModule } from "@/utils/desktopRuntime";
import { nodeToolBinDirCandidates, type NodeToolFs } from "@/utils/nodeToolBinDirs";

export type OpencodeBinaryResolverFs = NodeToolFs;

export interface OpencodeBinaryResolverInput {
  override?: string;
  homeDir: string;
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  fs: OpencodeBinaryResolverFs;
}

export function resolveOpencodeBinary(input: OpencodeBinaryResolverInput): string | null {
  const { override, fs } = input;

  if (override && fs.existsSync(override)) {
    return override;
  }

  const candidates = input.platform === "win32" ? windowsCandidates(input) : unixCandidates(input);

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function unixCandidates(input: OpencodeBinaryResolverInput): Array<string | null> {
  const posix = requireNodeModule<typeof import("node:path")>("path").posix;
  const { homeDir } = input;
  const dirs = [...nodeToolBinDirCandidates(input), ...WELL_KNOWN_BIN_DIRS];
  return [
    posix.join(homeDir, ".opencode", "bin", "opencode"),
    posix.join(homeDir, ".bun", "bin", "opencode"),
    posix.join(homeDir, ".local", "bin", "opencode"),
    ...dirs.map((dir) => posix.join(dir, "opencode")),
  ];
}

function windowsCandidates(input: OpencodeBinaryResolverInput): Array<string | null> {
  const win = requireNodeModule<typeof import("node:path")>("path").win32;
  const { homeDir, env } = input;
  const localAppData = env.LOCALAPPDATA ?? win.join(homeDir, "AppData", "Local");
  const programFiles = env.ProgramFiles ?? "C:\\Program Files";
  const programFilesX86 = env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";

  const out: Array<string | null> = [
    win.join(homeDir, ".opencode", "bin", "opencode.exe"),
    win.join(homeDir, ".bun", "bin", "opencode.exe"),
    win.join(homeDir, ".local", "bin", "opencode.exe"),
    win.join(localAppData, "opencode", "bin", "opencode.exe"),
    win.join(programFiles, "opencode", "bin", "opencode.exe"),
    win.join(programFilesX86, "opencode", "bin", "opencode.exe"),
  ];
  for (const dir of nodeToolBinDirCandidates(input)) {
    out.push(win.join(dir, "opencode.exe"));
  }
  return out;
}
