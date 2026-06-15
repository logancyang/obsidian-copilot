/**
 * Locates the opencode CLI's own diagnostic log so the Report-issue flow can
 * optionally bundle it (Zero's request on logancyang/obsidian-copilot-preview#155).
 *
 * opencode writes session logs under its XDG data dir at `opencode/log/*.log`
 * (honoring `XDG_DATA_HOME`, else `~/.local/share`). We don't override that at
 * spawn time, so this resolves opencode's default location. Best-effort: the
 * directory may not exist, in which case the caller proceeds without the log.
 */

export interface OpencodeLogRuntime {
  join: (...parts: string[]) => string;
  readdir: (dir: string) => Promise<string[]>;
  stat: (path: string) => Promise<{ mtimeMs: number }>;
}

/** Resolve opencode's default log directory for the given env/home. */
export function opencodeLogDir(
  env: Record<string, string | undefined>,
  homeDir: string,
  join: (...parts: string[]) => string
): string {
  const xdgDataHome = env.XDG_DATA_HOME?.trim();
  const dataRoot = xdgDataHome ? xdgDataHome : join(homeDir, ".local", "share");
  return join(dataRoot, "opencode", "log");
}

/**
 * Return the absolute path of the most recently modified `.log` file in
 * opencode's log directory, or `null` when the directory is missing/empty or
 * the runtime is unavailable.
 */
export async function findLatestOpencodeLog(
  env: Record<string, string | undefined>,
  homeDir: string,
  runtime: OpencodeLogRuntime = getNodeOpencodeLogRuntime()
): Promise<string | null> {
  try {
    const dir = opencodeLogDir(env, homeDir, runtime.join);
    const entries = await runtime.readdir(dir);
    const logs = entries.filter((name) => name.endsWith(".log"));
    if (logs.length === 0) return null;

    let newestPath: string | null = null;
    let newestMtime = Number.NEGATIVE_INFINITY;
    for (const name of logs) {
      const full = runtime.join(dir, name);
      try {
        const { mtimeMs } = await runtime.stat(full);
        if (mtimeMs > newestMtime) {
          newestMtime = mtimeMs;
          newestPath = full;
        }
      } catch {
        // File vanished between readdir and stat; skip it.
      }
    }
    return newestPath;
  } catch {
    return null;
  }
}

function getNodeOpencodeLogRuntime(): OpencodeLogRuntime {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("node:fs/promises") as typeof import("node:fs/promises");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("node:path") as typeof import("node:path");
  return {
    join: (...parts: string[]) => path.join(...parts),
    readdir: (dir: string) => fs.readdir(dir),
    stat: async (p: string) => {
      const s = await fs.stat(p);
      return { mtimeMs: s.mtimeMs };
    },
  };
}
