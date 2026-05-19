import { logWarn } from "@/logger";
import { errCode } from "@/utils/errorUtils";
import { joinPosix } from "@/utils/pathUtils";
import { renameWithRetry } from "./renameWithRetry";

/**
 * Subset of `node:fs` used by the symlink helpers. Modeled as a small
 * adapter so tests can pass an in-memory FS without touching disk.
 *
 * The Windows EPERM fallback lives at this seam: implementations should
 * throw an Error whose `code` is `"EPERM"` when `fs.symlink()` fails for
 * lack of privilege, and the helpers translate that into the typed
 * `{ ok: false, reason: 'eperm' }` result.
 */
export interface SymlinksFs {
  /** Whether the path exists (any kind). */
  exists(absPath: string): Promise<boolean>;
  /** Whether the path is a directory (real or junction). */
  isDirectory(absPath: string): Promise<boolean>;
  /** Whether the path itself is a symlink/junction. */
  isSymlink(absPath: string): Promise<boolean>;
  /**
   * Create a directory symlink (POSIX) or junction (Windows) at `linkPath`
   * pointing at the **absolute** `target`. May throw with `code: "EPERM"`.
   */
  symlink(target: string, linkPath: string): Promise<void>;
  /** Remove a symlink/junction at `absPath`. No-op if it doesn't exist. */
  unlink(absPath: string): Promise<void>;
  /** Recursively remove a real directory at `absPath`. */
  rmRecursive(absPath: string): Promise<void>;
}

/**
 * Result discriminator for symlink ops. The Windows-EPERM-without-Developer-Mode
 * path is surfaced as a typed value rather than a raw throw so callers can
 * render the one-time banner without try/catch boilerplate.
 */
export type SymlinkResult = { ok: true } | { ok: false; reason: "eperm"; message: string };

/**
 * Create a symlink at `<agentDir>/<name>` pointing at `canonicalAbs` (must
 * be absolute). If the path already exists, the caller wants
 * {@link replaceAgentLink} instead — this helper assumes the slot is empty.
 */
export async function createAgentLink(
  fs: SymlinksFs,
  agentDir: string,
  name: string,
  canonicalAbs: string
): Promise<SymlinkResult> {
  const linkPath = joinPosix(agentDir, name);
  try {
    await fs.symlink(canonicalAbs, linkPath);
    return { ok: true };
  } catch (err) {
    const code = errCode(err);
    if (code === "EPERM" || code === "EACCES") {
      const message = err instanceof Error ? err.message : String(err);
      logWarn(`[skills] symlink EPERM at ${linkPath}: ${message}`);
      return { ok: false, reason: "eperm", message };
    }
    throw err;
  }
}

/**
 * Remove the symlink at `<agentDir>/<name>`. If the entry is a real
 * directory (not a symlink/junction), this is a no-op — we never delete
 * user-owned directories. Missing entry is also a no-op.
 */
export async function removeAgentLink(
  fs: SymlinksFs,
  agentDir: string,
  name: string
): Promise<void> {
  const linkPath = joinPosix(agentDir, name);
  if (!(await fs.exists(linkPath))) return;

  let isLink = false;
  try {
    isLink = await fs.isSymlink(linkPath);
  } catch {
    return;
  }

  if (!isLink) {
    // Real directory — don't touch it.
    logWarn(`[skills] Refusing to remove real directory at ${linkPath}`);
    return;
  }

  try {
    await fs.unlink(linkPath);
  } catch (err) {
    logWarn(
      `[skills] Failed to unlink ${linkPath}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Atomic-replace the entry at `<agentDir>/<name>` with a symlink pointing
 * at `canonicalAbs`.
 *
 * - If nothing sits there, create the link directly.
 * - If a symlink/junction sits there, unlink it and recreate. (Some
 *   platforms allow direct overwrite; doing it in two steps is portable.)
 * - If a **real directory** sits there (e.g. a partial move from an
 *   aborted run), rename it aside to `.<name>.replacing`, create the
 *   link, then delete the aside dir. If link creation fails, the aside
 *   dir is renamed back so the user never loses data.
 *
 * Returns `{ ok: false, reason: 'eperm' }` when symlink creation fails
 * for lack of Windows privilege. In that case the original directory is
 * restored if we'd moved it aside.
 */
export async function replaceAgentLink(
  fs: SymlinksFs,
  agentDir: string,
  name: string,
  canonicalAbs: string
): Promise<SymlinkResult> {
  const linkPath = joinPosix(agentDir, name);

  if (!(await fs.exists(linkPath))) {
    return createAgentLink(fs, agentDir, name, canonicalAbs);
  }

  let isLink = false;
  try {
    isLink = await fs.isSymlink(linkPath);
  } catch {
    isLink = false;
  }

  if (isLink) {
    try {
      await fs.unlink(linkPath);
    } catch (err) {
      logWarn(
        `[skills] Failed to unlink stale entry at ${linkPath}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    return createAgentLink(fs, agentDir, name, canonicalAbs);
  }

  // Real directory case — move aside, link, delete aside.
  const asidePath = joinPosix(agentDir, `.${name}.replacing`);

  // If a previous aborted run left an aside dir behind, clear it first
  // so the rename doesn't EEXIST.
  if (await fs.exists(asidePath)) {
    try {
      await fs.rmRecursive(asidePath);
    } catch (err) {
      logWarn(
        `[skills] Could not remove stale aside ${asidePath}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  try {
    await renameWithRetry(linkPath, asidePath);
  } catch (err) {
    logWarn(
      `[skills] Could not move ${linkPath} aside: ${err instanceof Error ? err.message : String(err)}`
    );
    throw err;
  }

  const linkResult = await createAgentLink(fs, agentDir, name, canonicalAbs);
  if (!linkResult.ok) {
    // Restore the original so we leave no half-finished state behind.
    try {
      await renameWithRetry(asidePath, linkPath);
    } catch (restoreErr) {
      logWarn(
        `[skills] Failed to restore ${linkPath} from aside after EPERM: ${
          restoreErr instanceof Error ? restoreErr.message : String(restoreErr)
        }`
      );
    }
    return linkResult;
  }

  // Link is in place — delete the moved-aside real dir.
  try {
    await fs.rmRecursive(asidePath);
  } catch (err) {
    // The link is live; leftover aside dir is cosmetic. Log and move on.
    logWarn(
      `[skills] Failed to clean aside ${asidePath} after relink: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  return { ok: true };
}
