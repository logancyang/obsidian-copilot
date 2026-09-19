import { requireNodeModule } from "@/utils/desktopRuntime";
import { CODEX_ACP_PINNED_VERSION } from "@/agentMode/backends/codex/cliSetup";
import { versionInstallState } from "@/agentMode/backends/shared/versionInstallState";

const CURRENT_PACKAGE_NAME = "@agentclientprotocol/codex-acp";
const CURRENT_PACKAGE_ENTRY = "dist/index.js";
const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export const CODEX_ACP_MIN_VERSION = CODEX_ACP_PINNED_VERSION;

export interface CodexAcpInvocation {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

export interface CodexAcpPackage {
  entryPath: string;
  version: string;
  /** Semantic release version without the legacy native packaging revision. */
  acpVersion: string;
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
 * Recognizes native bundles and npm package entries without enforcing the release floor.
 * The older Zed adapter shares the `codex-acp` binary name but advertises
 * incompatible mode ids, so package identity is part of the support contract.
 * https://github.com/logancyang/obsidian-copilot/issues/2916
 * @param adapterPath - Configured native executable, npm launcher, or package entry point.
 * @param platform - Platform whose path rules should resolve the package layout.
 * @param packageFs - Filesystem operations used to inspect package metadata.
 */
export function resolveCodexAcpPackage(
  adapterPath: string,
  platform: NodeJS.Platform = process.platform,
  packageFs: CodexAcpPackageFs = defaultPackageFs()
): CodexAcpPackage {
  let entryPath: string;
  try {
    entryPath = packageFs.realpathSync(adapterPath);
  } catch {
    throw unsupportedAdapter();
  }

  const path = requireNodeModule<typeof import("node:path")>("path");
  const pathImpl = platform === "win32" ? path.win32 : path.posix;
  // Retain native bundle revisions so older managed installs can offer Update.
  // User-owned npm selections retain their package contract.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/379
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
        typeof provenance.acpVersion === "string"
          ? SEMVER_PATTERN.exec(provenance.acpVersion)
          : null;
      // Keep valid old adapters identifiable so configuration can offer an upgrade instead of Install.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/480
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
          acpVersion: provenance.acpVersion!,
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
  const parsedVersion = SEMVER_PATTERN.exec(version);
  if (!parsedVersion) {
    throw unsupportedAdapter();
  }
  return { entryPath, version, acpVersion: version };
}

/**
 * Enforces execution support after identity detection, without hiding old installations from setup.
 * @param adapterPath - Configured native executable, npm launcher, or package entry point.
 * @param platform - Platform whose path rules should resolve the package layout.
 * @param packageFs - Filesystem operations used to inspect package metadata.
 */
export function resolveSupportedCodexAcpEntry(
  adapterPath: string,
  platform: NodeJS.Platform = process.platform,
  packageFs: CodexAcpPackageFs = defaultPackageFs()
): string {
  const installed = resolveCodexAcpPackage(adapterPath, platform, packageFs);
  const state = versionInstallState(
    "Codex adapter",
    installed.acpVersion,
    CODEX_ACP_MIN_VERSION,
    "custom",
    installed.version
  );
  // Detection must retain old versions, but execution still requires the supported adapter contract.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/480
  if (state.kind === "incompatible") throw unsupportedAdapter(state.message);
  return installed.entryPath;
}

function recognizes(
  resolve: (adapterPath: string) => unknown
): (adapterPath: string | undefined) => boolean {
  return (adapterPath) => {
    if (!adapterPath) return false;
    try {
      resolve(adapterPath);
      return true;
    } catch {
      return false;
    }
  };
}

/** Whether the path holds a genuine `codex-acp` adapter, at any release. */
export const isCodexAcpPath = recognizes(resolveCodexAcpPackage);

/**
 * Whether the path holds an adapter this Copilot release can actually run, so detection can
 * rank a supported install above a genuine but outdated one found in an earlier location.
 * https://github.com/Brevilabs/obsidian-copilot-private/issues/480
 */
export const isSupportedCodexAcpPath = recognizes(resolveSupportedCodexAcpEntry);

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
