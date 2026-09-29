import { requireNodeModule } from "./desktopRuntime";

export interface OpencodeLogRuntime {
  join: (...parts: string[]) => string;
  readdir: (dir: string) => Promise<string[]>;
  stat: (path: string) => Promise<{ mtimeMs: number }>;
}

export function opencodeLogDir(
  env: Record<string, string | undefined>,
  homeDir: string,
  join: (...parts: string[]) => string
): string {
  const xdgDataHome = env.XDG_DATA_HOME?.trim();
  const dataRoot = xdgDataHome ? xdgDataHome : join(homeDir, ".local", "share");
  return join(dataRoot, "opencode", "log");
}

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
      } catch {}
    }
    return newestPath;
  } catch {
    return null;
  }
}

function getNodeOpencodeLogRuntime(): OpencodeLogRuntime {
  const fs = requireNodeModule<typeof import("node:fs/promises")>("fs/promises");
  const path = requireNodeModule<typeof import("node:path")>("path");
  return {
    join: (...parts: string[]) => path.join(...parts),
    readdir: (dir: string) => fs.readdir(dir),
    stat: async (p: string) => {
      const s = await fs.stat(p);
      return { mtimeMs: s.mtimeMs };
    },
  };
}
