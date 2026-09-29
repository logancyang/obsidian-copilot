import { terminalSignInCommand } from "@/agentMode/backends/shared/terminalSignInCommand";

export const CODEX_BINARY_NAME = "codex-acp";
export const CODEX_PINNED_VERSION = "1.13.0";

export function codexBinaryPathPlaceholder(platform: NodeJS.Platform): string {
  return platform === "win32"
    ? "C:\\path\\to\\@agentclientprotocol\\codex-acp\\dist\\index.js"
    : "/absolute/path/to/codex-acp";
}

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
    runtime: platform === "win32" && binaryPath?.endsWith(".js") ? "node" : undefined,
  });
}
