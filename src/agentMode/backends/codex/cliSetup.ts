import { terminalSignInCommand } from "@/agentMode/backends/shared/terminalSignInCommand";
import { requireNodeModule } from "@/utils/desktopRuntime";

export const CODEX_BINARY_NAME = "codex-acp";
export const CODEX_PINNED_VERSION = "2.0.1";

export function codexBinaryPathPlaceholder(platform: NodeJS.Platform): string {
  return platform === "win32"
    ? "C:\\path\\to\\@agentclientprotocol\\codex-acp\\dist\\index.js"
    : "/absolute/path/to/codex-acp";
}

export function managedCodexRuntimePath(adapterPath: string, platform: NodeJS.Platform): string {
  const node = requireNodeModule<typeof import("node:path")>("path");
  const path = platform === "win32" ? node.win32 : node.posix;
  return path.join(
    path.dirname(adapterPath),
    "codex-runtime",
    "bin",
    platform === "win32" ? "codex.exe" : "codex"
  );
}

export function codexSignInCommand(
  binaryPath: string | undefined,
  binarySource: "managed" | "custom" | undefined,
  envOverrides: Record<string, string> | undefined,
  platform: NodeJS.Platform
): string | null {
  // `codex-acp cli` runs the bundled Codex through cmd.exe on Windows, which splits paths with spaces.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/686
  if (binarySource === "managed" && binaryPath)
    return terminalSignInCommand({
      binaryPath: managedCodexRuntimePath(binaryPath, platform),
      args: ["login"],
      profileVariables: ["CODEX_HOME"],
      envOverrides,
      platform,
    });
  return terminalSignInCommand({
    binaryPath,
    args: ["cli", "login"],
    profileVariables: ["CODEX_HOME", "CODEX_PATH"],
    envOverrides,
    platform,
    runtime: platform === "win32" && binaryPath?.endsWith(".js") ? "node" : undefined,
  });
}
