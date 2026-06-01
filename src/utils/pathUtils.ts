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

/**
 * Collapse a leading home-directory prefix to `~` for privacy-preserving
 * display, e.g. `/Users/alice/.local/bin/claude` → `~/.local/bin/claude`.
 *
 * Display-only: the original separator style is preserved in the suffix
 * (so a Windows `C:\Users\alice\bin` renders as `~\bin`), and paths that are
 * not inside the home directory are returned unchanged. Never reuse the result
 * as a real path — it is not resolvable.
 *
 * The home-prefix comparison is done on separator-normalized views of both
 * strings (backslash → forward slash) so that a path stored with forward
 * slashes (`C:/Users/Alice/bin`) still matches an `os.homedir()` that uses
 * backslashes (`C:\Users\Alice`), and vice-versa. The suffix is sliced from
 * the original `absolutePath` so its real separator style is preserved for
 * display.
 *
 * @param absolutePath The path to format.
 * @param homeDir The user's home directory (injected so this stays pure/testable).
 * @param caseInsensitive Match the home prefix case-insensitively (for Windows).
 * @returns The path with the home prefix replaced by `~`, or unchanged.
 */
export function collapseHomeDir(
  absolutePath: string,
  homeDir: string,
  caseInsensitive = false
): string {
  if (!absolutePath || !homeDir) return absolutePath;
  // Strip trailing separators so `/Users/alice/` still matches `/Users/alice`.
  const normHome = homeDir.replace(/[/\\]+$/, "");
  if (!normHome) return absolutePath;

  // Normalize separators to forward slashes for comparison only.
  // Since `\` and `/` are both single characters, normHome.length equals the
  // number of characters in the home-prefix portion of absolutePath, so we can
  // use it as a slice index against the original strings below.
  const normHomeFwd = normHome.replace(/\\/g, "/");
  const headFwd = absolutePath.slice(0, normHome.length).replace(/\\/g, "/");
  const matches = caseInsensitive
    ? headFwd.toLowerCase() === normHomeFwd.toLowerCase()
    : headFwd === normHomeFwd;
  if (!matches) return absolutePath;

  // Slice the suffix from the *original* path to preserve its real separators.
  const rest = absolutePath.slice(normHome.length);
  if (rest === "") return "~";
  // Require a real path boundary so `/Users/alice2/...` doesn't match `/Users/alice`.
  if (rest[0] === "/" || rest[0] === "\\") return "~" + rest;
  return absolutePath;
}
