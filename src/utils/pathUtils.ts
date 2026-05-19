/**
 * POSIX path helpers for vault-style paths.
 *
 * Why not `node:path` (or `path.posix`)?
 *
 * - `path.posix.*` treats `\` as an ordinary character, so it can't normalize
 *   Windows-style separators that occasionally arrive from agent backends.
 *   These helpers convert `\` → `/` as part of the same call.
 * - `parentDir` uses a "/-for-root, /-for-no-slash" convention that differs
 *   from `path.posix.dirname` (which returns `.` for a bare filename). Six
 *   callsites in `agentMode/skills/` depend on the convention here.
 */

/** Normalize separators + drop trailing slashes for comparison. */
export function normalizeAbsPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "");
}

/** POSIX-only `join` for two path fragments. */
export function joinPosix(a: string, b: string): string {
  const left = a.replace(/\/+$/, "");
  const right = b.replace(/^\/+/, "");
  return left.length === 0 ? right : `${left}/${right}`;
}

/** POSIX-only `dirname`. Returns `/` for the root or a bare filename. */
export function parentDir(p: string): string {
  const stripped = p.replace(/\/+$/, "");
  const idx = stripped.lastIndexOf("/");
  if (idx <= 0) return "/";
  return stripped.slice(0, idx);
}

/** POSIX-only `basename`. Normalizes backslashes before extracting. */
export function basename(p: string): string {
  const stripped = normalizeAbsPath(p);
  const idx = stripped.lastIndexOf("/");
  return idx === -1 ? stripped : stripped.slice(idx + 1);
}

/** Ensure a path ends with `/`. */
export function withTrailingSlash(p: string): string {
  return p.endsWith("/") ? p : `${p}/`;
}

/**
 * Whether an absolute target path resolves inside the given absolute root.
 * Tolerates trailing slashes and mixed separators.
 */
export function resolvesInto(targetAbs: string, rootAbs: string): boolean {
  const t = normalizeAbsPath(targetAbs);
  const r = normalizeAbsPath(rootAbs);
  return t === r || t.startsWith(r + "/");
}
