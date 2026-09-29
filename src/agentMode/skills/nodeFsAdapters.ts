import { logWarn } from "@/logger";
import type { ProjectDiscoveryFs } from "./discoverProjectSkills";
import type { MigrateSkillFs } from "./migrateProjectSkill";
import { errCode } from "@/utils/errorUtils";
import { requireNodeModule } from "@/utils/desktopRuntime";
import type { ReconcileFs } from "./reconcile";
import type { SymlinksFs } from "./symlinks";

export function createNodeMigrateSkillFs(): MigrateSkillFs {
  const fs = requireNodeModule<typeof import("node:fs")>("fs");
  return {
    ...createNodeSymlinksFs(),
    async readFile(p) {
      return fs.promises.readFile(p, "utf-8");
    },
    async writeFile(p, content) {
      await fs.promises.writeFile(p, content, "utf-8");
    },
    async mkdirRecursive(p) {
      await fs.promises.mkdir(p, { recursive: true });
    },
    list: (p) => nodeList(p, true),
  };
}

async function nodeList(p: string, warn = false): Promise<string[]> {
  const fs = requireNodeModule<typeof import("node:fs")>("fs");
  try {
    return await fs.promises.readdir(p);
  } catch (err) {
    if (warn) {
      logWarn(`[skills] readdir ${p} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    return [];
  }
}

async function nodeReadlinkAbs(p: string): Promise<string | null> {
  const fs = requireNodeModule<typeof import("node:fs")>("fs");
  const path = requireNodeModule<typeof import("node:path")>("path");
  try {
    const target = await fs.promises.readlink(p);
    return path.isAbsolute(target) ? target : path.resolve(path.dirname(p), target);
  } catch {
    return null;
  }
}

export function createNodeSymlinksFs(): SymlinksFs {
  const fs = requireNodeModule<typeof import("node:fs")>("fs");
  const path = requireNodeModule<typeof import("node:path")>("path");
  return {
    async exists(p) {
      try {
        await fs.promises.lstat(p);
        return true;
      } catch {
        return false;
      }
    },
    async isDirectory(p) {
      try {
        const st = await fs.promises.stat(p);
        return st.isDirectory();
      } catch {
        return false;
      }
    },
    async isSymlink(p) {
      try {
        const st = await fs.promises.lstat(p);
        return st.isSymbolicLink();
      } catch {
        return false;
      }
    },
    async symlink(target, linkPath) {
      const type = process.platform === "win32" ? "junction" : "dir";
      const absTarget = path.isAbsolute(target) ? target : path.resolve(target);
      await fs.promises.mkdir(path.dirname(linkPath), { recursive: true });
      await fs.promises.symlink(absTarget, linkPath, type);
    },
    async unlink(p) {
      try {
        await fs.promises.unlink(p);
      } catch (err) {
        if (errCode(err) === "ENOENT") return;
        throw err;
      }
    },
    async rmRecursive(p) {
      await fs.promises.rm(p, { recursive: true, force: true });
    },
  };
}

export function createNodeProjectDiscoveryFs(): ProjectDiscoveryFs {
  const fs = requireNodeModule<typeof import("node:fs")>("fs");
  return {
    ...createNodeSymlinksFs(),
    list: (p) => nodeList(p),
    async readFile(p) {
      return fs.promises.readFile(p, "utf-8");
    },
  };
}

export function createNodeReconcileFs(): ReconcileFs {
  const fs = requireNodeModule<typeof import("node:fs")>("fs");
  return {
    ...createNodeSymlinksFs(),
    list: (p) => nodeList(p),
    readlinkAbs: nodeReadlinkAbs,
    async readFile(p) {
      return fs.promises.readFile(p, "utf-8");
    },
    async writeFile(p, content) {
      await fs.promises.writeFile(p, content, "utf-8");
    },
  };
}
