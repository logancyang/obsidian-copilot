import { augmentPathForDetection } from "@/utils/binaryPath";
import { requireNodeModule } from "@/utils/desktopRuntime";

function getExecFileAsync(): (
  cmd: string,
  args: readonly string[],
  options: { timeout: number; env: NodeJS.ProcessEnv }
) => Promise<{ stdout: string; stderr: string }> {
  const { execFile } = requireNodeModule<typeof import("node:child_process")>("child_process");
  const { promisify } = requireNodeModule<typeof import("node:util")>("util");
  return promisify(execFile);
}

const BINARY_NAME_PATTERN = /^[A-Za-z0-9._+-]+$/;

export async function detectBinary(name: string): Promise<string | null> {
  if (!BINARY_NAME_PATTERN.test(name)) {
    throw new Error(`Invalid binary name: ${JSON.stringify(name)}`);
  }
  const isWindows = process.platform === "win32";
  const cmd = isWindows ? "where" : "which";
  const env = { ...process.env, PATH: augmentPathForDetection(process.env.PATH) };
  const execFileAsync = getExecFileAsync();
  try {
    const { stdout } = await execFileAsync(cmd, [name], { timeout: 5000, env });
    const matches = stdout
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    return isWindows ? pickWindowsExecutable(matches) : (matches[0] ?? null);
  } catch {
    return null;
  }
}

function pickWindowsExecutable(matches: string[]): string | null {
  const path = requireNodeModule<typeof import("node:path")>("path");
  const spawnable = matches.filter(
    (m) => !/\.(cmd|bat|ps1)$/i.test(m) && path.win32.extname(m) !== ""
  );
  const exe = spawnable.find((m) => /\.exe$/i.test(m));
  return exe ?? spawnable[0] ?? null;
}

export async function validateExecutableFile(p: string): Promise<string | null> {
  const fs = requireNodeModule<typeof import("node:fs")>("fs");
  const stat = await fs.promises.stat(p).catch(() => null);
  if (!stat || !stat.isFile()) return `No file at ${p}.`;
  if (process.platform !== "win32") {
    try {
      await fs.promises.access(p, fs.constants.X_OK);
    } catch {
      return `${p} is not executable. chmod +x and try again.`;
    }
  }
  return null;
}
