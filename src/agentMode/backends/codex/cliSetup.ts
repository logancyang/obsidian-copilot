import { terminalSignInCommand } from "@/agentMode/backends/shared/terminalSignInCommand";
import { resolveCodexCommand, type CodexAcpPackageFs } from "./codexVersion";

export const CODEX_BINARY_NAME = "codex-acp";
// Keep inputs.json in Brevilabs/codex-acp-binary on this release so its PR builds test what Copilot ships.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/685
export const CODEX_PINNED_VERSION = "2.2.2";

export function codexBinaryPathPlaceholder(platform: NodeJS.Platform): string {
  return platform === "win32"
    ? "C:\\path\\to\\@agentclientprotocol\\codex-acp\\dist\\index.js"
    : "/absolute/path/to/codex-acp";
}

export function codexSignInCommand(
  binaryPath: string | undefined,
  envOverrides: Record<string, string> | undefined,
  platform: NodeJS.Platform,
  packageFs?: CodexAcpPackageFs
): string | null {
  let codex: string;
  try {
    codex = resolveCodexCommand(
      binaryPath ?? "",
      { ...process.env, ...envOverrides },
      platform,
      packageFs
    );
  } catch {
    // A missing or unsupported adapter cannot sign in, so there is no command to offer.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/686
    return null;
  }
  return terminalSignInCommand({
    binaryPath: codex,
    args: ["login"],
    profileVariables: ["CODEX_HOME"],
    envOverrides,
    platform,
    runtime: platform === "win32" && codex.endsWith(".js") ? "node" : undefined,
  });
}
