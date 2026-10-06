import { logWarn } from "@/logger";
import { requireNodeModule } from "@/utils/desktopRuntime";

export interface ContextCacheFs {
  exists(path: string): Promise<boolean>;
  mkdirRecursive(path: string): Promise<void>;
  list(path: string): Promise<string[]>;
  readText(path: string): Promise<string>;
  writeText(path: string, content: string): Promise<void>;
  remove(path: string): Promise<void>;
}

export interface NodeContextCacheFs extends ContextCacheFs {
  clear(): Promise<void>;
}

const ATOMIC_TEMP_PREFIX = ".copilot-cache-tmp-";

let atomicTempSeq = 0;

export function createNodeContextCacheFs(root: string): NodeContextCacheFs {
  const fs = requireNodeModule<typeof import("node:fs")>("fs");
  const nodePath = requireNodeModule<typeof import("node:path")>("path");

  const rootAbs = nodePath.resolve(root);

  const renameWithRetry = async (from: string, to: string, attempts = 3): Promise<void> => {
    let lastErr: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        await fs.promises.rename(from, to);
        return;
      } catch (e) {
        lastErr = e;
        await new Promise((resolve) => window.setTimeout(resolve, 200));
      }
    }
    throw lastErr;
  };

  const resolveWithin = (cachePath: string): string => {
    if (cachePath.split(/[\\/]+/).includes("..")) {
      throw new Error(`unsafe context-cache path (".." segment): ${cachePath}`);
    }
    if (nodePath.isAbsolute(cachePath)) {
      throw new Error(`unsafe context-cache path (absolute): ${cachePath}`);
    }
    const resolved = nodePath.resolve(rootAbs, cachePath);
    const rel = nodePath.relative(rootAbs, resolved);
    if (rel === "" || (!rel.startsWith("..") && !nodePath.isAbsolute(rel))) {
      return resolved;
    }
    throw new Error(`unsafe context-cache path (escapes root): ${cachePath}`);
  };

  const removeBestEffort = async (target: string, recursive: boolean): Promise<void> => {
    try {
      await fs.promises.rm(target, { recursive, force: true });
    } catch (error) {
      logWarn("[ContextCache] Could not remove a cache entry", error);
    }
  };

  return {
    async exists(cachePath) {
      const resolved = resolveWithin(cachePath);
      try {
        await fs.promises.stat(resolved);
        return true;
      } catch {
        return false;
      }
    },
    async mkdirRecursive(cachePath) {
      await fs.promises.mkdir(resolveWithin(cachePath), { recursive: true });
    },
    async list(cachePath) {
      const resolved = resolveWithin(cachePath);
      try {
        const entries = await fs.promises.readdir(resolved);
        return entries.filter((entry) => !entry.startsWith(ATOMIC_TEMP_PREFIX));
      } catch {
        return [];
      }
    },
    async readText(cachePath) {
      return fs.promises.readFile(resolveWithin(cachePath), "utf-8");
    },
    async writeText(cachePath, content) {
      const target = resolveWithin(cachePath);
      if (target === rootAbs) {
        throw new Error(`refusing to write the cache root itself: ${cachePath}`);
      }
      const temp = nodePath.join(
        nodePath.dirname(target),
        `${ATOMIC_TEMP_PREFIX}${nodePath.basename(target)}-${Date.now()}-${(atomicTempSeq++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`
      );
      try {
        await fs.promises.writeFile(temp, content, "utf-8");
        await renameWithRetry(temp, target);
      } catch (error) {
        await removeBestEffort(temp, false);
        throw error;
      }
    },
    async remove(cachePath) {
      await removeBestEffort(resolveWithin(cachePath), false);
    },
    async clear() {
      await removeBestEffort(rootAbs, true);
    },
  };
}
