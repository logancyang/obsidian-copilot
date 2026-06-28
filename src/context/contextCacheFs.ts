/**
 * Minimal filesystem surface the project-context materializer needs. Kept as an
 * injectable interface so the cache logic stays pure and unit-testable with an
 * in-memory fake — the only production implementation,
 * {@link createNodeContextCacheFs}, loads `node:fs` lazily at the desktop edge.
 *
 * All paths are **cache-root-relative**, POSIX-separated (the node backend
 * resolves them under the off-vault cache root). Keeping the interface itself
 * free of Node builtins lets node-free, mobile-reachable code import the TYPE
 * without pulling `node:fs` into the bundle.
 */
export interface ContextCacheFs {
  exists(path: string): Promise<boolean>;
  mkdirRecursive(path: string): Promise<void>;
  /** Shallow directory listing (entry names only). Returns `[]` when missing. */
  list(path: string): Promise<string[]>;
  readText(path: string): Promise<string>;
  writeText(path: string, content: string): Promise<void>;
  /** Idempotent delete — a missing path is not an error. */
  remove(path: string): Promise<void>;
}

/**
 * {@link ContextCacheFs} plus the destructive `clear` the off-vault node
 * backend needs. Kept separate from the base interface so the vault adapter
 * (which must never wipe a whole tree) is not forced to implement it.
 */
export interface NodeContextCacheFs extends ContextCacheFs {
  /**
   * Recursively delete the entire cache root. Root-confined by construction:
   * it targets `root` itself and never ascends to the parent `vaults/<id>/`,
   * which also hosts `agent-chat-index.json`. Best-effort: a missing root is a
   * no-op.
   */
  clear(): Promise<void>;
}

/**
 * Hidden filename prefix marking an in-progress atomic write. {@link list}
 * filters these out so a half-written snapshot never appears as a real entry.
 */
const ATOMIC_TEMP_PREFIX = ".copilot-cache-tmp-";

/** Monotonic suffix making concurrent temp filenames in one directory unique. */
let atomicTempSeq = 0;

/**
 * Production {@link ContextCacheFs} backed by `node:fs`, rooted at the absolute
 * off-vault cache directory (see {@link import("./conversionsLocation")}).
 * Unlike the vault adapter, all paths are **cache-root-relative** — absolute
 * paths are resolved only in `conversionsLocation` — and every operation is
 * confined under `root`.
 *
 * `node:fs` / `node:path` are loaded lazily (via `require`) inside the factory,
 * not at module top-level. Reason: this file also exports the node-free
 * {@link ContextCacheFs} interface; a top-level `import "node:fs"` would
 * evaluate Node builtins for *any* importer of this module — including
 * mobile-reachable code that only needs the type — and crash Obsidian mobile at
 * bundle load. The factory is invoked only behind the desktop Agent boundary,
 * so the `require` runs desktop-only.
 *
 * Best-effort policy (deliberately split, per the cache design):
 *  - `writeText` / `mkdirRecursive` **throw** on failure. A swallowed write
 *    would let the store report success while the file is missing, leaving a
 *    manifest entry that points at an empty snapshot. The materializer turns
 *    these throws into a per-source failure (write) or a whole-round cache
 *    degradation (mkdir) — the fs layer must not fake success.
 *  - `list` / `remove` / `clear` tolerate a missing target (`[]` / idempotent).
 */
export function createNodeContextCacheFs(root: string): NodeContextCacheFs {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, import/no-nodejs-modules
  const fs = require("node:fs") as typeof import("node:fs");
  // eslint-disable-next-line @typescript-eslint/no-require-imports, import/no-nodejs-modules
  const nodePath = require("node:path") as typeof import("node:path");

  const rootAbs = nodePath.resolve(root);

  /**
   * Atomic rename with a short retry. Inlined rather than imported from
   * `@/agentMode/skills/renameWithRetry` because the module-boundary rules
   * forbid `src/context` (host layer) from depending on `src/agentMode/skills`.
   * The rationale is identical: a Windows vault watcher / AV can briefly hold
   * the destination handle, and a short wait usually clears it.
   */
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

  /**
   * Resolve a cache-root-relative path to an absolute path, failing loud if it
   * would escape `root`: a `..`, an absolute input, or a resolved path outside
   * `root` is rejected rather than allowed to land somewhere unexpected (e.g.
   * the parent `vaults/<id>/`).
   *
   * Symlink escape is intentionally out of scope: every `cachePath` is
   * plugin-derived (fixed bucket names + md5 snapshot/marker filenames; user
   * input is hashed before it becomes a path segment), so no caller can inject
   * one. Following a pre-seeded symlink would require a local actor with write
   * access to this plugin-owned off-vault directory — already outside this
   * layer's threat model — so we skip the per-op `realpath`/`lstat` cost on the
   * cache hot path.
   */
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
    } catch {
      // Best-effort: the cache is regenerable and deletes are idempotent.
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
      // Atomic write: stage into a same-dir temp then rename over the target,
      // so a concurrent reader never sees a partial snapshot. The rename is
      // retried (renameWithRetry) because Windows watchers/AV can briefly hold
      // a handle. We do NOT fsync — the cache is regenerable.
      const target = resolveWithin(cachePath);
      if (target === rootAbs) {
        // A write target must be a *file under* root. Refusing the root itself
        // keeps the staging temp — created in the target's parent dir — from
        // ever landing in the parent `vaults/<id>/`.
        throw new Error(`refusing to write the cache root itself: ${cachePath}`);
      }
      // Temp name carries a timestamp + random suffix (not just an in-process
      // counter) so two Obsidian instances staging the same target on one vault
      // don't collide on the temp file and corrupt each other's atomic write.
      const temp = nodePath.join(
        nodePath.dirname(target),
        `${ATOMIC_TEMP_PREFIX}${nodePath.basename(target)}-${Date.now()}-${(atomicTempSeq++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`
      );
      try {
        await fs.promises.writeFile(temp, content, "utf-8");
        await renameWithRetry(temp, target);
      } catch (error) {
        // Never leave a half-written temp behind, then propagate so the caller
        // records a per-source failure.
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
