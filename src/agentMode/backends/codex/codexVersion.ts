import { parseSemver } from "@/utils/semver";
import { requireNodeModule } from "@/utils/desktopRuntime";
import { assertBinaryCompatible } from "@/agentMode/backends/shared/binaryCompatibility";

const CURRENT_PACKAGE_NAME = "@agentclientprotocol/codex-acp";
const CURRENT_PACKAGE_ENTRY = "dist/index.js";
// Earlier adapters run Default's read-only mode with workspace writes that skip approval.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/618
export const CODEX_MIN_VERSION = "2.0.0";

export interface CodexAcpInvocation {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

export type CodexAcpKind = "bundle" | "npm";

export interface CodexAcpPackage {
  entryPath: string;
  version: string;
  kind: CodexAcpKind;
}

export interface CodexAcpPackageFs {
  realpathSync(path: string): string;
  readFileSync(path: string, encoding: "utf8"): string;
  resolveFrom(fromFile: string, request: string): string;
}

function defaultPackageFs(): CodexAcpPackageFs {
  const fs = requireNodeModule<typeof import("node:fs")>("fs");
  return {
    realpathSync: (path) => fs.realpathSync(path),
    readFileSync: (path, encoding) => fs.readFileSync(path, encoding),
    resolveFrom: (fromFile, request) =>
      requireNodeModule<typeof import("node:module")>("module")
        .createRequire(fromFile)
        .resolve(request),
  };
}

function unsupportedAdapter(): Error {
  return new Error(
    `The configured Codex adapter is not supported. Install ${CURRENT_PACKAGE_NAME} ${CODEX_MIN_VERSION} or newer, then run Auto-detect again.`
  );
}

// The older Zed adapter is rejected: it shares the `codex-acp` name but uses incompatible mode IDs.
// https://github.com/logancyang/obsidian-copilot/issues/2916
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
          kind: "bundle",
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
  return { entryPath, version, runtimeVersion: version, kind: "npm" };
}

export function resolveSupportedCodexAcpPackage(
  adapterPath: string,
  platform: NodeJS.Platform = process.platform,
  packageFs: CodexAcpPackageFs = defaultPackageFs()
): CodexAcpPackage {
  const { runtimeVersion, ...supported } = inspectCodexAcpPackage(adapterPath, platform, packageFs);
  assertBinaryCompatible(
    { kind: "installed", version: runtimeVersion, source: "custom" },
    CODEX_MIN_VERSION,
    CURRENT_PACKAGE_NAME
  );
  return supported;
}

export function resolveSupportedCodexAcpEntry(
  adapterPath: string,
  platform: NodeJS.Platform = process.platform,
  packageFs: CodexAcpPackageFs = defaultPackageFs()
): string {
  return resolveSupportedCodexAcpPackage(adapterPath, platform, packageFs).entryPath;
}

export function bundledCodexRuntimePath(
  bundleEntryPath: string,
  platform: NodeJS.Platform
): string {
  const node = requireNodeModule<typeof import("node:path")>("path");
  const path = platform === "win32" ? node.win32 : node.posix;
  return path.join(
    path.dirname(bundleEntryPath),
    "codex-runtime",
    "bin",
    platform === "win32" ? "codex.exe" : "codex"
  );
}

export function resolveCodexCommand(
  adapterPath: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
  packageFs: CodexAcpPackageFs = defaultPackageFs()
): string {
  const { entryPath, kind } = resolveSupportedCodexAcpPackage(adapterPath, platform, packageFs);
  // The bundle's entry pins CODEX_PATH to its adjacent runtime, so that runtime is what sessions run.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/686
  if (kind === "bundle") return bundledCodexRuntimePath(entryPath, platform);
  // Run the Codex the npm adapter would (CODEX_PATH, else its own @openai/codex) without
  // `codex-acp cli`, whose Windows shell launch splits paths with spaces.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/686
  return env.CODEX_PATH || packageFs.resolveFrom(entryPath, "@openai/codex/bin/codex.js");
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
