import { terminalSignInCommand } from "@/agentMode/backends/shared/terminalSignInCommand";

export const CODEX_BINARY_NAME = "codex-acp";
export const CODEX_ACP_PINNED_VERSION = "1.10.0";
export const CODEX_BUNDLE_VERSION = CODEX_ACP_PINNED_VERSION;

export function codexBinaryPathPlaceholder(platform: NodeJS.Platform): string {
  return platform === "win32"
    ? "C:\\path\\to\\@agentclientprotocol\\codex-acp\\dist\\index.js"
    : "/absolute/path/to/codex-acp";
}

/**
 * Uses the configured adapter's bundled CLI and profile for terminal sign-in.
 * @param binaryPath - Selected native adapter or npm package entry point.
 * @param envOverrides - Configured environment, filtered to non-secret profile settings.
 * @param platform - Platform whose terminal will run the command.
 */
export function codexSignInCommand(
  binaryPath: string | undefined,
  envOverrides: Record<string, string> | undefined,
  platform: NodeJS.Platform
): string | null {
  return terminalSignInCommand({
    binaryPath,
    args: ["cli", "login"],
    profileVariables: ["CODEX_HOME", "CODEX_PATH"],
    envOverrides,
    platform,
    // Windows npm adapters are JavaScript entry points; native bundles launch directly.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/379
    runtime: platform === "win32" && binaryPath?.endsWith(".js") ? "node" : undefined,
  });
}
