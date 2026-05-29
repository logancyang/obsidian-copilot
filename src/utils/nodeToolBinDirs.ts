/**
 * Resolve the bin directories where Node-based CLI tools live under common
 * version managers (nvm, fnm, Volta, asdf, n) and `npm install -g` prefixes.
 *
 * macOS GUI apps (Obsidian launched from Finder/Dock) inherit a sparse
 * `launchd` PATH (`/usr/bin:/bin:/usr/sbin:/sbin`) that omits Homebrew and
 * every version-manager `bin` dir, so neither `which <binary>` (detection) nor
 * a `#!/usr/bin/env node` spawn can see them. This is the single source of
 * truth for the extra directories both paths prepend, so detect-time and
 * spawn-time PATH stay in lockstep.
 *
 * Deliberately a static, deterministic resolver rather than spawning a login
 * shell to import the user's real PATH: no subprocess cost, no shell-choice
 * ambiguity, no executing arbitrary user rc code.
 *
 * Pure leaf: callers inject `homeDir`, `platform`, `env`, and `fs` so tests
 * don't touch real disk.
 */
import * as path from "node:path";

export interface NodeToolFs {
  existsSync: (p: string) => boolean;
  readFileSync: (p: string, encoding: "utf8") => string;
  readdirSync: (p: string) => string[];
}

export interface NodeToolBinDirsInput {
  homeDir: string;
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  fs: NodeToolFs;
}

/**
 * Ordered, deduped list of candidate bin directories — version-manager layouts
 * that may or may not exist on disk. Earlier entries win during `which`/`where`
 * resolution, so a version manager's "active" install is listed before its
 * other versions. Callers that build PATH should use
 * {@link resolveNodeToolBinDirs} (existence-filtered); callers that probe for a
 * specific file under each dir (e.g. the Claude resolver) want this unfiltered
 * list so a present binary is found even when its parent dir wasn't otherwise
 * registered.
 */
export function nodeToolBinDirCandidates(input: NodeToolBinDirsInput): string[] {
  const candidates = input.platform === "win32" ? windowsCandidates(input) : unixCandidates(input);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const dir of candidates) {
    if (!dir || seen.has(dir)) continue;
    seen.add(dir);
    out.push(dir);
  }
  return out;
}

/**
 * {@link nodeToolBinDirCandidates} filtered to directories that exist — the set
 * to prepend to PATH for `which`/`where` and `#!/usr/bin/env node` spawns.
 */
export function resolveNodeToolBinDirs(input: NodeToolBinDirsInput): string[] {
  return nodeToolBinDirCandidates(input).filter((dir) => dirExists(input.fs, dir));
}

function dirExists(fs: NodeToolFs, dir: string): boolean {
  try {
    return fs.existsSync(dir);
  } catch {
    return false;
  }
}

function unixCandidates(input: NodeToolBinDirsInput): Array<string | null> {
  const { homeDir, env, fs, platform } = input;
  const p = path.posix;
  const dirs: Array<string | null> = [];

  // nvm — NVM_BIN (set only inside an interactive shell) plus the default and
  // every installed version's bin dir, so a binary installed under a
  // non-default version (`nvm use 20 && npm i -g ...`) is still found.
  dirs.push(env.NVM_BIN ?? null);
  const nvmDir = env.NVM_DIR ?? p.join(homeDir, ".nvm");
  const nvmVersions = p.join(nvmDir, "versions", "node");
  const nvmDefault = resolveNvmDefaultBin(nvmDir, nvmVersions, fs);
  if (nvmDefault) dirs.push(nvmDefault);
  dirs.push(...enumerateVersionBins(fs, nvmVersions, ["bin"], p));

  // fnm — active shell's symlinked bin, then every installed version.
  if (env.FNM_MULTISHELL_PATH) dirs.push(p.join(env.FNM_MULTISHELL_PATH, "bin"));
  for (const base of fnmBaseDirs(homeDir, env, platform, p)) {
    dirs.push(
      ...enumerateVersionBins(fs, p.join(base, "node-versions"), ["installation", "bin"], p)
    );
  }

  // Volta
  dirs.push(env.VOLTA_HOME ? p.join(env.VOLTA_HOME, "bin") : p.join(homeDir, ".volta", "bin"));

  // asdf — shims wrap every managed tool; bin is the asdf CLI itself. The data
  // dir (where shims live) is NOT the install dir: Homebrew-style setups point
  // ASDF_DIR at the install path while shims stay under the default ~/.asdf
  // data dir. So prefer ASDF_DATA_DIR, then a default ~/.asdf with real shims,
  // and only fall back to ASDF_DIR — otherwise a present ~/.asdf/shims would be
  // missed. Probe the shims dir itself, not the data dir: an empty ~/.asdf with
  // shims under ASDF_DIR must not shadow the real install.
  const defaultAsdfData = p.join(homeDir, ".asdf");
  const asdfRoot =
    env.ASDF_DATA_DIR ??
    (dirExists(fs, p.join(defaultAsdfData, "shims"))
      ? defaultAsdfData
      : (env.ASDF_DIR ?? defaultAsdfData));
  dirs.push(p.join(asdfRoot, "shims"));
  dirs.push(p.join(asdfRoot, "bin"));

  // n — installs to $N_PREFIX (default /usr/local, already a well-known dir).
  if (env.N_PREFIX) dirs.push(p.join(env.N_PREFIX, "bin"));

  // npm global prefixes
  if (env.npm_config_prefix) dirs.push(p.join(env.npm_config_prefix, "bin"));
  dirs.push(p.join(homeDir, ".npm-global", "bin"));
  dirs.push(p.join(homeDir, ".local", "bin"));

  return dirs;
}

function windowsCandidates(input: NodeToolBinDirsInput): Array<string | null> {
  const { homeDir, env } = input;
  const p = path.win32;
  const dirs: Array<string | null> = [];

  // npm global (`npm i -g` drops shims here) — the most common GUI-app gap.
  dirs.push(env.npm_config_prefix ?? null);
  dirs.push(env.APPDATA ? p.join(env.APPDATA, "npm") : null);
  dirs.push(p.join(homeDir, "AppData", "Roaming", "npm"));

  // nvm-windows points the active version at a stable symlink.
  dirs.push(env.NVM_SYMLINK ?? null);
  dirs.push(env.NVM_HOME ?? null);

  // fnm on Windows puts node.exe directly under the multishell dir (no /bin).
  if (env.FNM_MULTISHELL_PATH) dirs.push(env.FNM_MULTISHELL_PATH);

  // Volta
  dirs.push(env.VOLTA_HOME ? p.join(env.VOLTA_HOME, "bin") : p.join(homeDir, ".volta", "bin"));

  return dirs;
}

function fnmBaseDirs(
  homeDir: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  p: path.PlatformPath
): string[] {
  if (env.FNM_DIR) return [env.FNM_DIR];
  if (platform === "darwin") {
    return [
      p.join(homeDir, "Library", "Application Support", "fnm"),
      p.join(homeDir, ".local", "share", "fnm"),
    ];
  }
  return [p.join(homeDir, ".local", "share", "fnm")];
}

/**
 * Read a version manager's `versions` directory and return the per-version bin
 * dirs, newest-first (numeric sort). `subPath` is appended after the version
 * folder (e.g. `["bin"]` for nvm, `["installation", "bin"]` for fnm).
 */
function enumerateVersionBins(
  fs: NodeToolFs,
  versionsDir: string,
  subPath: string[],
  p: path.PlatformPath
): string[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(versionsDir);
  } catch {
    return [];
  }
  return entries
    .filter((e) => /^v?\d/.test(e))
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    .map((e) => p.join(versionsDir, e, ...subPath));
}

const NVM_LATEST_ALIASES = new Set(["node", "stable"]);

/**
 * Resolve nvm's `default` alias to a concrete version's bin dir. nvm doesn't
 * export `NVM_BIN` to GUI children, so the alias file is the most reliable
 * pointer to the user's chosen default. Aliases can chain (`default → lts/* →
 * lts/hydrogen → vX.Y.Z`); unresolvable ones yield null.
 */
function resolveNvmDefaultBin(nvmDir: string, versionsDir: string, fs: NodeToolFs): string | null {
  let alias: string;
  try {
    alias = fs.readFileSync(path.posix.join(nvmDir, "alias", "default"), "utf8").trim();
  } catch {
    return null;
  }
  if (!alias) return null;

  const resolved = resolveNvmAlias(nvmDir, alias, fs, 0);
  if (!resolved) return null;

  let entries: string[];
  try {
    entries = fs
      .readdirSync(versionsDir)
      .filter((e) => e.startsWith("v"))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  } catch {
    return null;
  }

  const matched = matchNvmVersion(entries, resolved);
  return matched ? path.posix.join(versionsDir, matched, "bin") : null;
}

function resolveNvmAlias(
  nvmDir: string,
  alias: string,
  fs: NodeToolFs,
  depth: number
): string | null {
  if (depth > 5) return null;
  if (/^\d/.test(alias) || alias.startsWith("v")) return alias;
  if (NVM_LATEST_ALIASES.has(alias)) return alias;
  try {
    const target = fs
      .readFileSync(path.posix.join(nvmDir, "alias", ...alias.split("/")), "utf8")
      .trim();
    if (!target) return null;
    return resolveNvmAlias(nvmDir, target, fs, depth + 1);
  } catch {
    return null;
  }
}

function matchNvmVersion(entries: string[], resolvedAlias: string): string | undefined {
  if (NVM_LATEST_ALIASES.has(resolvedAlias)) return entries[0];
  const version = resolvedAlias.replace(/^v/, "");
  return entries.find((entry) => {
    const entryVersion = entry.slice(1);
    return entryVersion === version || entryVersion.startsWith(version + ".");
  });
}
