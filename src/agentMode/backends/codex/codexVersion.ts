import { requireNodeModule } from "@/utils/desktopRuntime";
import { compareSemver } from "@/utils/semver";

const CURRENT_PACKAGE_NAME = "@agentclientprotocol/codex-acp";
const CURRENT_PACKAGE_ENTRY = "dist/index.js";
const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

// Bundled CLI authentication requires the passthrough added in version 0.0.45.
// https://github.com/logancyang/obsidian-copilot/issues/2967
export const CODEX_ACP_MIN_VERSION = "0.0.45";

export interface CodexAcpInvocation {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

export interface CodexAcpPackageFs {
  realpathSync(path: string): string;
  readFileSync(path: string, encoding: "utf8"): string;
}

function defaultPackageFs(): CodexAcpPackageFs {
  const fs = requireNodeModule<typeof import("node:fs")>("fs");
  return {
    realpathSync: (path) => fs.realpathSync(path),
    readFileSync: (path, encoding) => fs.readFileSync(path, encoding),
  };
}

function unsupportedAdapter(message?: string): Error {
  return new Error(
    message ??
      `The configured Codex adapter is not supported. Install ${CURRENT_PACKAGE_NAME} ${CODEX_ACP_MIN_VERSION} or newer, then run Auto-detect again.`
  );
}

/**
 * Resolves and validates the configured adapter's npm package entry point.
 * The older Zed adapter shares the `codex-acp` binary name but advertises
 * incompatible mode ids, so package identity is part of the support contract.
 * https://github.com/logancyang/obsidian-copilot/issues/2916
 * @param adapterPath - Configured npm launcher or package entry point.
 * @param platform - Platform whose path rules should resolve the package layout.
 * @param packageFs - Filesystem operations used to inspect package metadata.
 */
export function resolveSupportedCodexAcpEntry(
  adapterPath: string,
  platform: NodeJS.Platform = process.platform,
  packageFs: CodexAcpPackageFs = defaultPackageFs()
): string {
  let entryPath: string;
  try {
    entryPath = packageFs.realpathSync(adapterPath);
  } catch {
    throw unsupportedAdapter();
  }

  const path = requireNodeModule<typeof import("node:path")>("path");
  const pathImpl = platform === "win32" ? path.win32 : path.posix;
  const packageRoot = pathImpl.dirname(pathImpl.dirname(entryPath));
  const relativeEntry = pathImpl.relative(packageRoot, entryPath).replaceAll("\\", "/");
  if (relativeEntry !== CURRENT_PACKAGE_ENTRY) throw unsupportedAdapter();

  let packageMetadata: unknown;
  try {
    packageMetadata = JSON.parse(
      packageFs.readFileSync(pathImpl.join(packageRoot, "package.json"), "utf8")
    );
  } catch {
    throw unsupportedAdapter();
  }
  if (packageMetadata === null || typeof packageMetadata !== "object") {
    throw unsupportedAdapter();
  }

  const record = packageMetadata as Record<string, unknown>;
  const bin = record.bin;
  const binEntry =
    bin !== null && typeof bin === "object"
      ? (bin as Record<string, unknown>)["codex-acp"]
      : undefined;
  if (record.name !== CURRENT_PACKAGE_NAME || binEntry !== CURRENT_PACKAGE_ENTRY) {
    throw unsupportedAdapter();
  }

  const version = record.version;
  if (typeof version !== "string") {
    throw unsupportedAdapter();
  }
  const parsedVersion = SEMVER_PATTERN.exec(version);
  if (!parsedVersion) {
    throw unsupportedAdapter();
  }
  const versionOrder = compareSemver(version, CODEX_ACP_MIN_VERSION);
  if (versionOrder < 0 || (versionOrder === 0 && parsedVersion[4] !== undefined)) {
    throw unsupportedAdapter(
      `${CURRENT_PACKAGE_NAME} ${version} is not supported. Install ${CODEX_ACP_MIN_VERSION} or newer, then run Auto-detect again.`
    );
  }
  return entryPath;
}

export function isSupportedCodexAcpPath(adapterPath: string | undefined): boolean {
  if (!adapterPath) return false;
  try {
    resolveSupportedCodexAcpEntry(adapterPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Launches the supported npm entry point directly on Unix and through the
 * installed Node runtime on Windows, avoiding unspawnable npm command shims.
 * @param entryPath - Validated JavaScript entry point for the supported package.
 * @param args - Arguments to pass to the adapter.
 * @param env - Environment inherited by the adapter process.
 * @param platform - Platform whose launcher rules should apply.
 * @param nodePath - Installed Node executable required on Windows.
 */
export function buildCodexAcpInvocation(
  entryPath: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
  nodePath?: string
): CodexAcpInvocation {
  if (platform === "win32") {
    // Windows cannot spawn npm command shims on the ACP no-shell process path,
    // so the package entry must run through the Node installation that owns it.
    // https://github.com/logancyang/obsidian-copilot/issues/2916
    if (!nodePath) {
      throw new Error(
        "Node.js was not found. Install Node.js, restart Obsidian, then run Codex Auto-detect again."
      );
    }
    return { command: nodePath, args: [entryPath, ...args], env };
  }
  return {
    command: entryPath,
    args,
    env,
  };
}
