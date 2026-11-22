import { requireNodeModule } from "@/utils/desktopRuntime";

type PathModule = typeof import("node:path");
type PlatformPath = PathModule["posix"];

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

export function nodeToolBinDirCandidates(input: NodeToolBinDirsInput): string[] {
  const path = requireNodeModule<PathModule>("path");
  const candidates =
    input.platform === "win32"
      ? windowsCandidates(input, path.win32)
      : unixCandidates(input, path.posix);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const dir of candidates) {
    if (!dir || seen.has(dir)) continue;
    seen.add(dir);
    out.push(dir);
  }
  return out;
}

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

function unixCandidates(input: NodeToolBinDirsInput, p: PlatformPath): Array<string | null> {
  const { homeDir, env, fs, platform } = input;
  const dirs: Array<string | null> = [];

  dirs.push(env.NVM_BIN ?? null);
  const nvmDir = env.NVM_DIR ?? p.join(homeDir, ".nvm");
  const nvmVersions = p.join(nvmDir, "versions", "node");
  const nvmDefault = resolveNvmDefaultBin(nvmDir, nvmVersions, fs, p);
  if (nvmDefault) dirs.push(nvmDefault);
  dirs.push(...enumerateVersionBins(fs, nvmVersions, ["bin"], p));

  if (env.FNM_MULTISHELL_PATH) dirs.push(p.join(env.FNM_MULTISHELL_PATH, "bin"));
  for (const base of fnmBaseDirs(homeDir, env, platform, p)) {
    dirs.push(
      ...enumerateVersionBins(fs, p.join(base, "node-versions"), ["installation", "bin"], p)
    );
  }

  dirs.push(env.VOLTA_HOME ? p.join(env.VOLTA_HOME, "bin") : p.join(homeDir, ".volta", "bin"));

  const defaultAsdfData = p.join(homeDir, ".asdf");
  const asdfRoot =
    env.ASDF_DATA_DIR ??
    (dirExists(fs, p.join(defaultAsdfData, "shims"))
      ? defaultAsdfData
      : (env.ASDF_DIR ?? defaultAsdfData));
  dirs.push(p.join(asdfRoot, "shims"));
  dirs.push(p.join(asdfRoot, "bin"));

  if (env.N_PREFIX) dirs.push(p.join(env.N_PREFIX, "bin"));

  if (env.npm_config_prefix) dirs.push(p.join(env.npm_config_prefix, "bin"));
  dirs.push(p.join(homeDir, ".npm-global", "bin"));
  dirs.push(p.join(homeDir, ".local", "bin"));

  return dirs;
}

function windowsCandidates(input: NodeToolBinDirsInput, p: PlatformPath): Array<string | null> {
  const { homeDir, env } = input;
  const dirs: Array<string | null> = [];

  dirs.push(env.npm_config_prefix ?? null);
  dirs.push(env.APPDATA ? p.join(env.APPDATA, "npm") : null);
  dirs.push(p.join(homeDir, "AppData", "Roaming", "npm"));

  dirs.push(env.NVM_SYMLINK ?? null);
  dirs.push(env.NVM_HOME ?? null);

  if (env.FNM_MULTISHELL_PATH) dirs.push(env.FNM_MULTISHELL_PATH);

  dirs.push(env.VOLTA_HOME ? p.join(env.VOLTA_HOME, "bin") : p.join(homeDir, ".volta", "bin"));

  return dirs;
}

function fnmBaseDirs(
  homeDir: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  p: PlatformPath
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

function enumerateVersionBins(
  fs: NodeToolFs,
  versionsDir: string,
  subPath: string[],
  p: PlatformPath
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

function resolveNvmDefaultBin(
  nvmDir: string,
  versionsDir: string,
  fs: NodeToolFs,
  p: PlatformPath
): string | null {
  let alias: string;
  try {
    alias = fs.readFileSync(p.join(nvmDir, "alias", "default"), "utf8").trim();
  } catch {
    return null;
  }
  if (!alias) return null;

  const resolved = resolveNvmAlias(nvmDir, alias, fs, p, 0);
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
  return matched ? p.join(versionsDir, matched, "bin") : null;
}

function resolveNvmAlias(
  nvmDir: string,
  alias: string,
  fs: NodeToolFs,
  p: PlatformPath,
  depth: number
): string | null {
  if (depth > 5) return null;
  if (/^\d/.test(alias) || alias.startsWith("v")) return alias;
  if (NVM_LATEST_ALIASES.has(alias)) return alias;
  try {
    const target = fs.readFileSync(p.join(nvmDir, "alias", ...alias.split("/")), "utf8").trim();
    if (!target) return null;
    return resolveNvmAlias(nvmDir, target, fs, p, depth + 1);
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
