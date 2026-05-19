import { execFile as execFileCb } from "node:child_process";
import * as fs from "node:fs";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

export type OpencodePlatform = "darwin" | "linux" | "windows";
export type OpencodeArch = "x64" | "arm64" | "arm";
export type OpencodeLibc = "glibc" | "musl";

export interface AssetTarget {
  platform: OpencodePlatform;
  arch: OpencodeArch;
  /** Only set on linux. */
  libc?: OpencodeLibc;
  /** Only set on x64. `undefined` ⇒ assume modern (AVX2 present). */
  hasAvx2?: boolean;
}

/**
 * Build the prioritized list of opencode release asset stems (no extension)
 * for the given target. The first match wins; later entries are fallbacks
 * when the preferred variant is not published for a release.
 *
 * Mirrors the fallback order in opencode's own launcher script
 * (`bin/opencode` in sst/opencode).
 */
export function buildAssetCandidates(target: AssetTarget): string[] {
  const base = `opencode-${target.platform}-${target.arch}`;
  const out: string[] = [];

  if (target.platform === "linux" && target.libc === "musl") {
    out.push(`${base}-musl`);
  }

  if (target.arch === "x64" && target.hasAvx2 === false) {
    out.push(`${base}-baseline`);
  }

  out.push(base);

  return [...new Set(out)];
}

export function mapNodePlatform(nodePlatform: NodeJS.Platform): OpencodePlatform | undefined {
  if (nodePlatform === "darwin") return "darwin";
  if (nodePlatform === "linux") return "linux";
  if (nodePlatform === "win32") return "windows";
  return undefined;
}

export function mapNodeArch(nodeArch: string): OpencodeArch | undefined {
  if (nodeArch === "x64") return "x64";
  if (nodeArch === "arm64") return "arm64";
  if (nodeArch === "arm") return "arm";
  return undefined;
}

/**
 * Best-effort musl libc detection. Linux only; returns false on other OSes.
 * Falls back to false if probes fail (glibc is the safer default).
 */
export async function detectMusl(): Promise<boolean> {
  if (process.platform !== "linux") return false;
  try {
    await fs.promises.access("/etc/alpine-release");
    return true;
  } catch {
    // not alpine; try ldd
  }
  try {
    const { stdout, stderr } = await execFile("ldd", ["--version"]);
    return /musl/i.test(`${stdout}\n${stderr}`);
  } catch {
    return false;
  }
}

/**
 * Best-effort AVX2 detection on x64 hosts. Returns `true` when the probe
 * fails — modern hardware is the safer default and the manager already
 * falls back to the non-baseline asset if the baseline asset is missing.
 */
export async function detectAvx2(): Promise<boolean> {
  if (process.arch !== "x64") return false;
  try {
    if (process.platform === "darwin") {
      const { stdout } = await execFile("sysctl", ["-n", "hw.optional.avx2_0"]);
      return stdout.trim() === "1";
    }
    if (process.platform === "linux") {
      const cpuinfo = await fs.promises.readFile("/proc/cpuinfo", "utf-8");
      return /\bavx2\b/.test(cpuinfo);
    }
    if (process.platform === "win32") {
      const { stdout } = await execFile("powershell.exe", [
        "-NoProfile",
        "-Command",
        "[System.Runtime.Intrinsics.X86.Avx2]::IsSupported",
      ]);
      return /true/i.test(stdout);
    }
  } catch {
    // probe failed → assume modern
  }
  return true;
}

export interface ResolvedTarget {
  target: AssetTarget;
  candidates: string[];
}

/**
 * Resolve the current host's opencode asset target by probing the system,
 * and return the prioritized asset-stem candidate list.
 */
export async function resolveOpencodeTarget(): Promise<ResolvedTarget> {
  const platform = mapNodePlatform(process.platform);
  const arch = mapNodeArch(process.arch);
  if (!platform || !arch) {
    throw new Error(
      `Unsupported platform/arch: ${process.platform}/${process.arch}. Agent Mode requires darwin/linux/windows on x64/arm64.`
    );
  }
  const [muslIsh, avx2] = await Promise.all([
    platform === "linux" ? detectMusl() : Promise.resolve(false),
    arch === "x64" ? detectAvx2() : Promise.resolve(undefined),
  ]);
  const libc: OpencodeLibc | undefined =
    platform === "linux" ? (muslIsh ? "musl" : "glibc") : undefined;
  const hasAvx2 = arch === "x64" ? avx2 : undefined;
  const target: AssetTarget = { platform, arch, libc, hasAvx2 };
  return { target, candidates: buildAssetCandidates(target) };
}

/** Expected binary file name inside the extracted archive. */
export function expectedBinaryName(platform: OpencodePlatform): string {
  return platform === "windows" ? "opencode.exe" : "opencode";
}
