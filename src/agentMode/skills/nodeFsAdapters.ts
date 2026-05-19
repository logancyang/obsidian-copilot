import { logWarn } from "@/logger";
import * as fs from "node:fs";
import * as path from "node:path";
import type { BulkMoveFs } from "./bulkMove";
import type { ImportDetectorFs } from "./importDetector";
import { errCode } from "@/utils/errorUtils";
import type { ReconcileFs } from "./reconcile";
import type { SymlinksFs } from "./symlinks";

/**
 * Production `node:fs`-backed adapter for the bulk-move / symlinks helpers.
 * Lives here so the leaf modules stay pure (no `node:fs` import) and the
 * orchestrator (`SkillManager`) wires this in at the edge.
 *
 * All paths must be **absolute**. Symlinks on Windows are created as
 * directory junctions (`'junction'`) — `fs.symlink` plain mode requires
 * admin/Developer Mode privileges; junctions work for stock users and are
 * directory-only (which is exactly what skills need).
 */
export function createNodeBulkMoveFs(): BulkMoveFs {
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
  try {
    const target = await fs.promises.readlink(p);
    return path.isAbsolute(target) ? target : path.resolve(path.dirname(p), target);
  } catch {
    return null;
  }
}

/**
 * Subset of {@link createNodeBulkMoveFs} that satisfies the `SymlinksFs`
 * surface. Reused both by bulk-move and by toggle logic.
 */
export function createNodeSymlinksFs(): SymlinksFs {
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
      // Junctions require an absolute target — caller is contracted to
      // pass an absolute path. Resolve defensively anyway.
      const absTarget = path.isAbsolute(target) ? target : path.resolve(target);
      // Per-agent skill dirs (e.g. `<vault>/.codex/skills/`) may not exist
      // yet on a fresh vault — `symlink` would fail with ENOENT. mkdir is
      // a no-op when the dir already exists.
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

/**
 * Production adapter for {@link detectImportCandidates}. Uses `lstat` to
 * detect symlinks portably (Windows junctions still report as symbolic
 * links via lstat).
 */
export function createNodeImportDetectorFs(): ImportDetectorFs {
  return {
    ...createNodeSymlinksFs(),
    readlinkAbs: nodeReadlinkAbs,
    list: (p) => nodeList(p),
    async statSize(p) {
      try {
        const st = await fs.promises.stat(p);
        return st.size;
      } catch {
        return 0;
      }
    },
  };
}

/**
 * Production adapter for {@link reconcile}. Combines the SymlinksFs surface
 * with shallow listing + readlink resolution used for orphan sweep.
 */
export function createNodeReconcileFs(): ReconcileFs {
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
