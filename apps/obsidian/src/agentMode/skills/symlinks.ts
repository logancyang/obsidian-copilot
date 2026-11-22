import { logWarn } from "@/logger";
import { errCode } from "@/utils/errorUtils";
import { joinPosix, normalizeAbsPath } from "@/utils/pathUtils";
import { renameWithRetry } from "./renameWithRetry";

export interface SymlinksFs {
  exists(absPath: string): Promise<boolean>;
  isDirectory(absPath: string): Promise<boolean>;
  isSymlink(absPath: string): Promise<boolean>;
  symlink(target: string, linkPath: string): Promise<void>;
  unlink(absPath: string): Promise<void>;
  rmRecursive(absPath: string): Promise<void>;
}

export interface LinkSweepFs extends SymlinksFs {
  list(absPath: string): Promise<string[]>;
  readlinkAbs(absPath: string): Promise<string | null>;
}

export type SymlinkResult = { ok: true } | { ok: false; reason: "eperm"; message: string };

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

  const asidePath = joinPosix(agentDir, `.${name}.replacing`);

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

  try {
    await fs.rmRecursive(asidePath);
  } catch (err) {
    logWarn(
      `[skills] Failed to clean aside ${asidePath} after relink: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  return { ok: true };
}

export async function removeAgentLinksPointingTo(
  fs: LinkSweepFs,
  agentDirsAbs: Readonly<Record<string, string>>,
  targetAbs: string
): Promise<{ removed: string[]; errors: Array<{ path: string; reason: string }> }> {
  const normalizedTarget = normalizeAbsPath(targetAbs);
  const results = await Promise.all(
    Object.values(agentDirsAbs).map((agentDir) => sweepAgentDir(fs, agentDir, normalizedTarget))
  );
  return {
    removed: results.flatMap((result) => result.removed),
    errors: results.flatMap((result) => result.errors),
  };
}

async function sweepAgentDir(
  fs: LinkSweepFs,
  agentDir: string,
  normalizedTarget: string
): Promise<{ removed: string[]; errors: Array<{ path: string; reason: string }> }> {
  let entries: string[];
  try {
    entries = await fs.list(agentDir);
  } catch {
    return { removed: [], errors: [] };
  }

  const removed: string[] = [];
  const errors: Array<{ path: string; reason: string }> = [];
  await Promise.all(
    entries.map(async (name) => {
      const linkPath = joinPosix(agentDir, name);
      let isLink = false;
      try {
        isLink = await fs.isSymlink(linkPath);
      } catch {
        return;
      }
      if (!isLink) return;

      const target = await fs.readlinkAbs(linkPath);
      if (target === null || normalizeAbsPath(target) !== normalizedTarget) return;

      try {
        await fs.unlink(linkPath);
        removed.push(linkPath);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        errors.push({ path: linkPath, reason });
      }
    })
  );

  return { removed, errors };
}
