import { parseSemver } from "@/utils/semver";
import { requireNodeModule } from "@/utils/desktopRuntime";
import { assertBinaryCompatible } from "@/agentMode/backends/shared/binaryCompatibility";

const CURRENT_PACKAGE_NAME = "@agentclientprotocol/codex-acp";
const CURRENT_PACKAGE_ENTRY = "dist/index.js";
// Model selection requires config options validated with the bundled adapter.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/550
export const CODEX_MIN_VERSION = "1.13.0";

export interface CodexAcpInvocation {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

export interface CodexAcpPackage {
  entryPath: string;
  version: string;
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

function unsupportedAdapter(): Error {
  return new Error(
    `The configured Codex adapter is not supported. Install ${CURRENT_PACKAGE_NAME} ${CODEX_MIN_VERSION} or newer, then run Auto-detect again.`
  );
}

/**
 * Validates a Codex adapter's package identity and metadata, then returns its
 * executable path and versions. Older versions are returned so callers can
 * distinguish an installation that needs an upgrade from an invalid package.
 * Throws for missing files or invalid packages. The older Zed adapter is rejected
 * because it shares the `codex-acp` name but uses incompatible mode IDs.
 * https://github.com/logancyang/obsidian-copilot/issues/2916
 * @param adapterPath - Configured native executable, npm launcher, or package entry point.
 * @param platform - Platform whose path rules should resolve the package layout.
 * @param packageFs - Filesystem operations used to inspect package metadata.
 * @returns `version` identifies the installed package, including a native packaging
 * revision when present; `runtimeVersion` is the adapter version used for compatibility checks.
 */
export function inspectCodexAcpPackage(
  adapterPath: string,
  platform: NodeJS.Platform = process.platform,
  packageFs: CodexAcpPackageFs = defaultPackageFs()
): CodexAcpPackage & { runtimeVersion: string } {
  let entryPath: string;
  try {
    entryPath = packageFs.realpathSync(adapterPath);
  } catch (error) {
    // Synced paths missing on this device need Install rather than an invalid-package error. https://github.com/Brevilabs/obsidian-copilot-private/issues/535
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw error;
    throw unsupportedAdapter();
  }

  const path = requireNodeModule<typeof import("node:path")>("path");
  const pathImpl = platform === "win32" ? path.win32 : path.posix;
  if (pathImpl.basename(entryPath) === (platform === "win32" ? "codex-acp.exe" : "codex-acp")) {
    try {
      const provenance: { acpVersion?: string; packagingRevision?: number; target?: string } =
        JSON.parse(
          packageFs.readFileSync(
            pathImpl.join(pathImpl.dirname(entryPath), "provenance.json"),
            "utf8"
          )
        );
      const parsedVersion =
        typeof provenance.acpVersion === "string" ? parseSemver(provenance.acpVersion) : null;
      // Valid older bundles must remain detectable so Configure can offer an upgrade.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/535
      if (
        parsedVersion &&
        (provenance.packagingRevision === undefined ||
          (Number.isSafeInteger(provenance.packagingRevision) &&
            provenance.packagingRevision > 0)) &&
        provenance.target === `${platform}-${process.arch}`
      ) {
        // Published bundles use ACP versions; retain revision identities for older installations.
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/379
        return {
          entryPath,
          runtimeVersion: provenance.acpVersion!,
          version:
            provenance.packagingRevision === undefined
              ? provenance.acpVersion!
              : `${provenance.acpVersion}-r${provenance.packagingRevision}`,
        };
      }
    } catch {
      throw unsupportedAdapter();
    }
  }
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
  const parsedVersion = parseSemver(version);
  if (!parsedVersion) {
    throw unsupportedAdapter();
  }
  return { entryPath, version, runtimeVersion: version };
}

/**
 * Returns the Codex adapter's executable path and package version only if its
 * package is valid and its runtime meets CODEX_MIN_VERSION. Throws otherwise.
 *
 * @param adapterPath - Configured native executable, npm launcher, or package entry point.
 * @param platform - Operating system whose path rules and native bundle target to validate.
 * @param packageFs - Filesystem used to inspect package metadata.
 */
export function resolveSupportedCodexAcpPackage(
  adapterPath: string,
  platform: NodeJS.Platform = process.platform,
  packageFs: CodexAcpPackageFs = defaultPackageFs()
): CodexAcpPackage {
  const { entryPath, version, runtimeVersion } = inspectCodexAcpPackage(
    adapterPath,
    platform,
    packageFs
  );
  assertBinaryCompatible(
    { kind: "installed", version: runtimeVersion, source: "custom" },
    CODEX_MIN_VERSION,
    CURRENT_PACKAGE_NAME
  );
  return { entryPath, version };
}

/** Resolve only the package entry for callers that do not need version metadata. */
export function resolveSupportedCodexAcpEntry(
  adapterPath: string,
  platform: NodeJS.Platform = process.platform,
  packageFs: CodexAcpPackageFs = defaultPackageFs()
): string {
  return resolveSupportedCodexAcpPackage(adapterPath, platform, packageFs).entryPath;
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
 * Launches native bundles directly and supported npm entries through the
 * installed Node runtime on Windows, avoiding unspawnable npm command shims.
 * @param entryPath - Validated native executable or npm JavaScript entry point.
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
  if (platform === "win32" && entryPath.endsWith(".js")) {
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
